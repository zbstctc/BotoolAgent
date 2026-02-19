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
  costWeightedTokens: number; // cost-weighted "output token equivalents"
  outputTokens: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
}

interface RateLimitWindow {
  label: string;
  used: number;      // cost-weighted token equivalents
  limit: number;     // estimated cost-weighted limit
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

// Cost-weighted "output token equivalent" (OTE) limits per plan per window.
// Rate limits are cost-based: each token type is weighted by its relative price.
// Weight formula (same ratio for all Claude models):
//   OTE = output_tokens + input_tokens * 0.2 + cache_read * 0.02 + cache_create * 0.25
// These limits are community-estimated — Anthropic does not publish exact numbers.
const RATE_LIMITS: Record<string, { fiveHour: number; sevenDay: number; sevenDaySonnet: number }> = {
  // Max 20x ($200/month)
  default_claude_max_20x: {
    fiveHour: 11_000_000,
    sevenDay: 220_000_000,
    sevenDaySonnet: 440_000_000,
  },
  // Max 5x ($100/month)
  default_claude_max_5x: {
    fiveHour: 2_750_000,
    sevenDay: 55_000_000,
    sevenDaySonnet: 110_000_000,
  },
  // Pro ($20/month)
  default_claude_pro: {
    fiveHour: 550_000,
    sevenDay: 11_000_000,
    sevenDaySonnet: 22_000_000,
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
 * Parse a timestamp from JSONL entries.
 * Handles: ISO 8601 strings, epoch seconds, epoch milliseconds.
 * Returns milliseconds or null.
 */
function parseTimestampMs(ts: unknown): number | null {
  if (typeof ts === 'number') {
    return ts < 1e12 ? ts * 1000 : ts;
  }
  if (typeof ts === 'string') {
    const ms = new Date(ts).getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

/**
 * Compute cost-weighted "output token equivalents" (OTE).
 * Weight ratios are identical across Claude model families:
 *   output: 1.0, input: 0.2, cache_read: 0.02, cache_create: 0.25
 */
function costWeightedOTE(
  output: number, input: number, cacheRead: number, cacheCreate: number
): number {
  return output + input * 0.2 + cacheRead * 0.02 + cacheCreate * 0.25;
}

/**
 * Scan ALL project JSONL files for usage within a time window.
 * Returns cost-weighted token usage within the window.
 */
function getWindowUsage(windowMs: number): WindowUsage {
  const result: WindowUsage = {
    costWeightedTokens: 0,
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

            // Parse timestamp — supports ISO strings, epoch seconds/ms
            const ts = obj.timestamp ?? obj.message?.created_at;
            const tsMs = parseTimestampMs(ts);
            if (tsMs !== null && tsMs < cutoff) continue;

            const u = obj.message.usage;
            const out = u.output_tokens ?? 0;
            const inp = u.input_tokens ?? 0;
            const cacheRead = u.cache_read_input_tokens ?? 0;
            const cacheCreate = u.cache_creation_input_tokens ?? 0;

            result.outputTokens += out;
            result.inputTokens += inp;
            result.cacheReadTokens += cacheRead;
            result.cacheCreateTokens += cacheCreate;
            result.costWeightedTokens += costWeightedOTE(out, inp, cacheRead, cacheCreate);
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
 * Get Sonnet-only cost-weighted OTE from the 7-day window.
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

            const ts = obj.timestamp ?? obj.message?.created_at;
            const tsMs = parseTimestampMs(ts);
            if (tsMs !== null && tsMs < cutoff) continue;

            const u = obj.message.usage;
            total += costWeightedOTE(
              u.output_tokens ?? 0,
              u.input_tokens ?? 0,
              u.cache_read_input_tokens ?? 0,
              u.cache_creation_input_tokens ?? 0,
            );
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

  const fiveHourPct = Math.min(100, Math.round((fiveHourUsage.costWeightedTokens / limits.fiveHour) * 100));
  const sevenDayPct = Math.min(100, Math.round((sevenDayUsage.costWeightedTokens / limits.sevenDay) * 100));
  const sonnetPct = Math.min(100, Math.round((sonnetUsage / limits.sevenDaySonnet) * 100));

  const windows: RateLimitWindow[] = [
    {
      label: 'Current session',
      used: Math.round(fiveHourUsage.costWeightedTokens),
      limit: limits.fiveHour,
      percent: fiveHourPct,
      resetInfo: 'Rolling 5-hour window',
    },
    {
      label: 'Current week (all models)',
      used: Math.round(sevenDayUsage.costWeightedTokens),
      limit: limits.sevenDay,
      percent: sevenDayPct,
      resetInfo: 'Rolling 7-day window',
    },
    {
      label: 'Current week (Sonnet only)',
      used: Math.round(sonnetUsage),
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
