import { NextResponse } from 'next/server';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface AuthStatus {
  loggedIn: boolean;
  authMethod?: string;
  apiProvider?: string;
  email?: string;
  orgId?: string;
  orgName?: string | null;
  subscriptionType?: string;
}

interface WindowUsage {
  outputTokens: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
}

interface RateLimitWindow {
  label: string;
  used: number;      // output tokens used
  limit: number;     // estimated output token limit
  percent: number;   // 0-100
  resetInfo: string;  // human-readable reset description
}

interface CredentialData {
  claudeAiOauth?: {
    accessToken?: string;
    rateLimitTier?: string;
    subscriptionType?: string;
  };
}

// Approximate output token limits per plan per window.
// These are community-estimated values — Anthropic does not publish exact numbers.
// The /status percentages from Anthropic's internal API would be more accurate.
const RATE_LIMITS: Record<string, { fiveHour: number; sevenDay: number; sevenDaySonnet: number }> = {
  // Max 20x ($200/month)
  default_claude_max_20x: {
    fiveHour: 4_000_000,
    sevenDay: 80_000_000,
    sevenDaySonnet: 160_000_000,
  },
  // Max 5x ($100/month)
  default_claude_max_5x: {
    fiveHour: 1_000_000,
    sevenDay: 20_000_000,
    sevenDaySonnet: 40_000_000,
  },
  // Pro ($20/month)
  default_claude_pro: {
    fiveHour: 200_000,
    sevenDay: 4_000_000,
    sevenDaySonnet: 8_000_000,
  },
};

function getRateLimitTier(): string | null {
  try {
    const raw = execSync(
      'security find-generic-password -s "Claude Code-credentials" -w',
      { timeout: 3000, stdio: 'pipe' }
    ).toString().trim();
    const data: CredentialData = JSON.parse(raw);
    return data.claudeAiOauth?.rateLimitTier ?? null;
  } catch {
    return null;
  }
}

/**
 * Scan ALL project JSONL files for usage within a time window.
 * Returns output tokens used in the window.
 */
function getWindowUsage(windowMs: number): WindowUsage {
  const result: WindowUsage = {
    outputTokens: 0,
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheCreateTokens: 0,
  };

  const cutoff = Date.now() - windowMs;

  try {
    const projectsDir = path.join(os.homedir(), '.claude', 'projects');
    if (!fs.existsSync(projectsDir)) return result;

    const projectDirs = fs.readdirSync(projectsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory());

    for (const dir of projectDirs) {
      const dirPath = path.join(projectsDir, dir.name);
      const files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.jsonl'));

      for (const file of files) {
        const fp = path.join(dirPath, file);
        const stat = fs.statSync(fp);
        // Skip files not modified within the window
        if (stat.mtimeMs < cutoff) continue;

        const content = fs.readFileSync(fp, 'utf-8');
        for (const line of content.split('\n')) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line);
            if (obj.type !== 'assistant' || !obj.message?.usage) continue;

            // Check timestamp — use obj.timestamp if available, otherwise include all
            // (JSONL lines don't always have timestamps, but the file mtime filter helps)
            const ts = obj.timestamp ?? obj.message?.created_at;
            if (ts && typeof ts === 'number' && ts < cutoff) continue;

            const u = obj.message.usage;
            result.outputTokens += u.output_tokens ?? 0;
            result.inputTokens += u.input_tokens ?? 0;
            result.cacheReadTokens += u.cache_read_input_tokens ?? 0;
            result.cacheCreateTokens += u.cache_creation_input_tokens ?? 0;
          } catch {
            // skip malformed lines
          }
        }
      }
    }
  } catch {
    // ignore
  }

  return result;
}

/**
 * Get Sonnet-only output tokens from the 7-day window
 */
function getSevenDaySonnetUsage(): number {
  let total = 0;
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;

  try {
    const projectsDir = path.join(os.homedir(), '.claude', 'projects');
    if (!fs.existsSync(projectsDir)) return 0;

    const projectDirs = fs.readdirSync(projectsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory());

    for (const dir of projectDirs) {
      const dirPath = path.join(projectsDir, dir.name);
      const files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.jsonl'));

      for (const file of files) {
        const fp = path.join(dirPath, file);
        const stat = fs.statSync(fp);
        if (stat.mtimeMs < cutoff) continue;

        const content = fs.readFileSync(fp, 'utf-8');
        for (const line of content.split('\n')) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line);
            if (obj.type !== 'assistant' || !obj.message?.usage) continue;
            const model: string = obj.message?.model ?? '';
            if (!model.includes('sonnet')) continue;

            const u = obj.message.usage;
            total += u.output_tokens ?? 0;
          } catch {
            // skip
          }
        }
      }
    }
  } catch {
    // ignore
  }

  return total;
}

function getTodaySessionCount(): number {
  let count = 0;
  try {
    const claudeDir = path.join(os.homedir(), '.claude', 'projects');
    const cwd = process.cwd();
    const projectRoot = path.resolve(cwd, '..');
    const projectDir = path.join(claudeDir, projectRoot.replace(/\//g, '-'));

    if (!fs.existsSync(projectDir)) return 0;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const files = fs.readdirSync(projectDir).filter((f) => f.endsWith('.jsonl'));
    for (const file of files) {
      const fp = path.join(projectDir, file);
      const stat = fs.statSync(fp);
      if (stat.mtimeMs >= todayStart.getTime()) count++;
    }
  } catch {
    // ignore
  }
  return count;
}

export async function GET() {
  const env = { ...process.env };
  delete env.CLAUDECODE;

  let version = 'unknown';
  try {
    version = execSync('claude --version', {
      timeout: 5000,
      stdio: 'pipe',
      env,
    })
      .toString()
      .trim()
      .replace(' (Claude Code)', '');
  } catch {
    // ignore
  }

  let auth: AuthStatus = { loggedIn: false };
  try {
    const raw = execSync('claude auth status', {
      timeout: 10000,
      stdio: 'pipe',
      env,
    }).toString();
    auth = JSON.parse(raw);
  } catch {
    // ignore
  }

  const planLabels: Record<string, string> = {
    max: 'Max',
    pro: 'Pro',
    team: 'Team',
    enterprise: 'Enterprise',
    free: 'Free',
  };

  // Get rate limit tier from keychain
  const tier = getRateLimitTier();
  const limits = (tier ? RATE_LIMITS[tier] : null) ?? RATE_LIMITS.default_claude_max_20x;

  // Calculate rolling window usage
  const FIVE_HOURS = 5 * 60 * 60 * 1000;
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

  const fiveHourUsage = getWindowUsage(FIVE_HOURS);
  const sevenDayUsage = getWindowUsage(SEVEN_DAYS);
  const sonnetUsage = getSevenDaySonnetUsage();

  const fiveHourPct = Math.min(100, Math.round((fiveHourUsage.outputTokens / limits.fiveHour) * 100));
  const sevenDayPct = Math.min(100, Math.round((sevenDayUsage.outputTokens / limits.sevenDay) * 100));
  const sonnetPct = Math.min(100, Math.round((sonnetUsage / limits.sevenDaySonnet) * 100));

  const windows: RateLimitWindow[] = [
    {
      label: 'Current session',
      used: fiveHourUsage.outputTokens,
      limit: limits.fiveHour,
      percent: fiveHourPct,
      resetInfo: 'Rolling 5-hour window',
    },
    {
      label: 'Current week (all models)',
      used: sevenDayUsage.outputTokens,
      limit: limits.sevenDay,
      percent: sevenDayPct,
      resetInfo: 'Rolling 7-day window',
    },
    {
      label: 'Current week (Sonnet only)',
      used: sonnetUsage,
      limit: limits.sevenDaySonnet,
      percent: sonnetPct,
      resetInfo: 'Rolling 7-day window',
    },
  ];

  return NextResponse.json({
    ok: auth.loggedIn,
    version,
    email: auth.email ?? null,
    plan: auth.subscriptionType
      ? planLabels[auth.subscriptionType] ?? auth.subscriptionType
      : null,
    orgName: auth.orgName ?? null,
    authMethod: auth.authMethod ?? null,
    tier: tier ?? 'unknown',
    windows,
    sessionCount: getTodaySessionCount(),
    timestamp: Date.now(),
  });
}
