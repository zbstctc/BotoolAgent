import { NextRequest, NextResponse } from 'next/server';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getRulesDir } from '@/lib/project-root';

// ============================================================================
// Types
// ============================================================================

export interface ReviewFinding {
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  category:
    | 'completeness'
    | 'consistency'
    | 'implementability'
    | 'security'
    | 'ux'
    | 'rule-violation'
    | 'syntax'
    | 'dependency'
    | 'filepath'
    | 'eval'
    | 'session';
  message: string;
  suggestion: string;
  section?: string;
  ruleId?: string;
  ruleName?: string;
  taskId?: string;
  resolution?: 'fixed' | 'rejected' | 'unresolved';
  rejectionReason?: string;
  codexAccepted?: boolean;
  fixCommit?: string;
}

interface ParseResult {
  success: boolean;
  findings: ReviewFinding[];
}

// ============================================================================
// Rule ID → file path mapping (server-side only, never accept paths from client)
// ============================================================================

const RULE_ID_MAP: Record<string, { filePath: string; name: string }> = {
  'frontend/样式规范': { filePath: 'frontend/样式规范.md', name: '样式规范' },
  'frontend/命名规范': { filePath: 'frontend/命名规范.md', name: '命名规范' },
  'frontend/测试': { filePath: 'frontend/测试.md', name: '测试' },
  'backend/API设计规范': { filePath: 'backend/API设计规范.md', name: 'API设计规范' },
  'testing/测试用例规范': { filePath: 'testing/测试用例规范.md', name: '测试用例规范' },
  'application/状态管理规范': { filePath: 'application/状态管理规范.md', name: '状态管理规范' },
  'application/项目结构规范': { filePath: 'application/项目结构规范.md', name: '项目结构规范' },
};

// ============================================================================
// Codex prompt builders
// ============================================================================

const PRD_REVIEW_DIMENSIONS = [
  'completeness — Are all requirements, acceptance criteria, and edge cases covered? Are there missing sections?',
  'consistency — Are there any contradictions between sections? Do numbers, names, and references align?',
  'implementability — Can a developer implement every DT without ambiguity? Are technical details sufficient?',
  'security — Are there security risks not addressed (injection, auth, data leaks, path traversal)?',
  'ux — Are user flows clear? Are error states and loading states described?',
];

const ENRICH_REVIEW_DIMENSIONS = [
  'syntax — Are code examples syntactically valid TypeScript/JavaScript? Are imports correct?',
  'dependency — Are task dependencies acyclic? Is the dependency graph consistent (no missing refs)?',
  'filepath — Do filesToModify reference paths that plausibly exist in the project structure?',
  'eval — Are eval commands valid shell commands? Would blocking evals actually work (no typos)?',
  'session — Are sessions properly sized (max 8 DTs each)? Are dependent tasks in the same session?',
];

function buildPrdReviewPrompt(tempFilePath: string, rulesContext: string): string {
  const dimensionsList = PRD_REVIEW_DIMENSIONS.map((d, i) => `${i + 1}. ${d}`).join('\n');

  let prompt = `You are a red-team PRD reviewer. Your job is to find real problems, not rubber-stamp.

Read the PRD file at: ${tempFilePath}

Review it across these 5 dimensions:
${dimensionsList}

For each finding, output a block in this exact format:
---
SEVERITY: HIGH | MEDIUM | LOW
CATEGORY: completeness | consistency | implementability | security | ux
SECTION: (which PRD section, e.g. "3.1 API Design")
MESSAGE: (what is wrong)
SUGGESTION: (how to fix it)
---

If there are no issues, output exactly: NO_ISSUES_FOUND

Be thorough but precise. Only flag real problems with concrete evidence.`;

  if (rulesContext) {
    prompt += `

ADDITIONAL REVIEW: The PRD must also comply with the following project coding rules. For each DT (Development Task) in the PRD, check if its description/acceptance criteria would lead to code that violates these rules. For rule violations, use this format:
---
SEVERITY: HIGH | MEDIUM | LOW
CATEGORY: rule-violation
RULE_ID: (the rule identifier)
RULE_NAME: (the rule name)
TASK_ID: (which DT, e.g. "DT-001")
SECTION: (which PRD section)
MESSAGE: (what rule is violated and how)
SUGGESTION: (how to fix the PRD to comply)
---

=== PROJECT RULES ===
${rulesContext.replace(/^---$/gm, '- - -')}
=== END PROJECT RULES ===`;
  }

  return prompt;
}

function buildEnrichReviewPrompt(tempFilePath: string): string {
  const dimensionsList = ENRICH_REVIEW_DIMENSIONS.map((d, i) => `${i + 1}. ${d}`).join('\n');

  return `You are a red-team reviewer for auto-enrichment output. Your job is to find structural/technical problems.

Read the enrichment result file at: ${tempFilePath}

Review it across these 5 dimensions:
${dimensionsList}

For each finding, output a block in this exact format:
---
SEVERITY: HIGH | MEDIUM | LOW
CATEGORY: syntax | dependency | filepath | eval | session
TASK_ID: (which DT if applicable, e.g. "DT-001")
MESSAGE: (what is wrong)
SUGGESTION: (how to fix it)
---

If there are no issues, output exactly: NO_ISSUES_FOUND

Be thorough but precise. Only flag real problems with concrete evidence.`;
}

// ============================================================================
// Parse Codex free-text output into ReviewFinding[] (fail-closed: BR-009)
// ============================================================================

function parseCodexOutput(rawOutput: string): ParseResult {
  const trimmed = rawOutput.trim();

  // Fail-closed: empty or garbage output = failure
  if (!trimmed || trimmed.length < 10) {
    return { success: false, findings: [] };
  }

  // Check for explicit "no issues" signal — exact match only to prevent false positives
  // when Codex echoes the marker while also outputting findings
  if (trimmed === 'NO_ISSUES_FOUND') {
    return { success: true, findings: [] };
  }

  // Try to extract structured finding blocks delimited by ---
  const findings: ReviewFinding[] = [];
  const blocks = trimmed.split(/^---$/m);

  for (const block of blocks) {
    const lines = block.trim();
    if (!lines) continue;

    const severityMatch = lines.match(/SEVERITY:\s*(HIGH|MEDIUM|LOW)/i);
    const categoryMatch = lines.match(
      /CATEGORY:\s*(completeness|consistency|implementability|security|ux|rule-violation|syntax|dependency|filepath|eval|session)/i,
    );
    const messageMatch = lines.match(/MESSAGE:\s*(.+)/i);
    const suggestionMatch = lines.match(/SUGGESTION:\s*(.+)/i);
    const sectionMatch = lines.match(/SECTION:\s*(.+)/i);
    const ruleIdMatch = lines.match(/RULE_ID:\s*(.+)/i);
    const ruleNameMatch = lines.match(/RULE_NAME:\s*(.+)/i);
    const taskIdMatch = lines.match(/TASK_ID:\s*(.+)/i);

    if (severityMatch && categoryMatch && messageMatch) {
      const finding: ReviewFinding = {
        severity: severityMatch[1].toUpperCase() as ReviewFinding['severity'],
        category: categoryMatch[1].toLowerCase() as ReviewFinding['category'],
        message: messageMatch[1].trim(),
        suggestion: suggestionMatch ? suggestionMatch[1].trim() : '',
      };

      if (sectionMatch) finding.section = sectionMatch[1].trim();
      if (ruleIdMatch) finding.ruleId = ruleIdMatch[1].trim();
      if (ruleNameMatch) finding.ruleName = ruleNameMatch[1].trim();
      if (taskIdMatch) finding.taskId = taskIdMatch[1].trim();

      findings.push(finding);
    }
  }

  // If we got no structured findings from non-trivial output, try a lenient
  // paragraph-based extraction as fallback
  if (findings.length === 0) {
    const paragraphFindings = parseParagraphFallback(trimmed);
    if (paragraphFindings.length > 0) {
      return { success: true, findings: paragraphFindings };
    }
    // Non-trivial output but zero extractable findings = parse failure (fail-closed)
    return { success: false, findings: [] };
  }

  return { success: true, findings };
}

/**
 * Fallback parser: extract findings from numbered paragraphs (e.g. "1. **HIGH** ...")
 * This handles cases where Codex doesn't follow the --- delimited format exactly.
 */
function parseParagraphFallback(text: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  // Match numbered items with severity markers
  // Note: using [\s\S] instead of . with s flag for ES2017 compat
  const pattern = /\d+\.\s*\*?\*?(HIGH|MEDIUM|LOW)\*?\*?\s*[-–:]\s*([\s\S]*?)(?=\n\d+\.\s*\*?\*?(?:HIGH|MEDIUM|LOW)|$)/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const severity = match[1].toUpperCase() as ReviewFinding['severity'];
    const content = match[2].trim();

    if (content.length > 10) {
      // Try to extract category from content
      const catMatch = content.match(
        /\b(completeness|consistency|implementability|security|ux|rule-violation|syntax|dependency|filepath|eval|session)\b/i,
      );

      findings.push({
        severity,
        category: catMatch
          ? (catMatch[1].toLowerCase() as ReviewFinding['category'])
          : 'completeness',
        message: content.substring(0, 500),
        suggestion: '',
      });
    }
  }

  return findings;
}

// ============================================================================
// Load rule files (with path traversal protection)
// ============================================================================

function loadRulesContent(ruleIds: string[]): string {
  const rulesDir = getRulesDir();
  const parts: string[] = [];

  for (const ruleId of ruleIds) {
    const ruleEntry = RULE_ID_MAP[ruleId];
    // Fall back to treating ruleId as a relative file path within the rules directory
    const filePath = ruleEntry?.filePath ?? (ruleId.endsWith('.md') ? ruleId : `${ruleId}.md`);
    const ruleName = ruleEntry?.name ?? ruleId;

    const fullPath = path.join(rulesDir, filePath);

    // Path traversal protection: ensure resolved path is under rules directory
    try {
      const realPath = fs.realpathSync(fullPath);
      const realRulesDir = fs.realpathSync(rulesDir);
      if (!realPath.startsWith(realRulesDir + path.sep) && realPath !== realRulesDir) {
        console.warn(`[prd-review] Path traversal blocked for ruleId: ${ruleId}`);
        continue;
      }
    } catch {
      console.warn(`[prd-review] Rule file not found for ruleId: ${ruleId}`);
      continue;
    }

    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      parts.push(`### Rule: ${ruleName} (${ruleId})\n\n${content}`);
    } catch {
      console.warn(`[prd-review] Failed to read rule file for ruleId: ${ruleId}`);
    }
  }

  return parts.join('\n\n---\n\n');
}

// ============================================================================
// SSE progress messages
// ============================================================================

const PROGRESS_MESSAGES = [
  '正在准备审查环境...',
  '正在启动 Codex 审查...',
  '正在分析文档结构...',
  '正在检查完整性...',
  '正在检查一致性...',
  '正在评估可实现性...',
  '正在检查安全问题...',
  '正在评估用户体验...',
  '正在解析审查结果...',
];

const ENRICH_PROGRESS_MESSAGES = [
  '正在准备审查环境...',
  '正在启动 Codex 审查...',
  '正在检查代码语法...',
  '正在验证依赖关系...',
  '正在检查文件路径...',
  '正在验证 eval 命令...',
  '正在检查 session 分组...',
  '正在解析审查结果...',
];

// ============================================================================
// Spawn Codex with sanitized environment
// ============================================================================

function getCleanEnv(): NodeJS.ProcessEnv {
  // Remove CLAUDECODE-related environment variables (same pattern as cli-manager.ts)
  const { CLAUDECODE: _, ...cleanEnv } = process.env;
  return cleanEnv;
}

function spawnCodex(
  prompt: string,
  timeoutMs: number,
  onProcess?: (proc: ChildProcess) => void,
): Promise<{ stdout: string; exitCode: number }> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let resolved = false;

    // shell: false — use fixed argv array, never concatenate user input
    const proc: ChildProcess = spawn('codex', ['exec', '--full-auto', prompt], {
      shell: false,
      env: getCleanEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Expose process reference so caller can kill it on stream cancel
    onProcess?.(proc);

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        proc.kill('SIGTERM');
        resolve({ stdout, exitCode: -1 });
      }
    }, timeoutMs);

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('close', (code: number | null) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        if (stderr) {
          console.error('[prd-review] Codex stderr:', stderr.substring(0, 1000));
        }
        resolve({ stdout, exitCode: code ?? 1 });
      }
    });

    proc.on('error', (err: Error) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        console.error('[prd-review] Codex spawn error:', err.message);
        resolve({ stdout: '', exitCode: -1 });
      }
    });
  });
}

// ============================================================================
// API Handler
// ============================================================================

export async function POST(request: NextRequest) {
  let tempFilePath: string | null = null;

  try {
    const body = await request.json();
    const { content, reviewTarget, rules } = body as {
      content: string;
      reviewTarget: 'prd' | 'enrich';
      rules?: string[];
    };

    // Input validation
    if (!content || typeof content !== 'string') {
      return NextResponse.json({ error: 'content is required and must be a string' }, { status: 400 });
    }

    if (!reviewTarget || (reviewTarget !== 'prd' && reviewTarget !== 'enrich')) {
      return NextResponse.json(
        { error: 'reviewTarget must be "prd" or "enrich"' },
        { status: 400 },
      );
    }

    if (rules !== undefined && !Array.isArray(rules)) {
      return NextResponse.json({ error: 'rules must be an array of ruleId strings' }, { status: 400 });
    }

    // Write content to temporary file
    const prefix = reviewTarget === 'prd' ? 'prd-review-' : 'enrich-review-';
    tempFilePath = path.join(os.tmpdir(), `${prefix}${Date.now()}-${Math.random().toString(36).slice(2)}.md`);
    fs.writeFileSync(tempFilePath, content, 'utf-8');

    // Build prompt based on review target
    let prompt: string;
    if (reviewTarget === 'prd') {
      const rulesContext =
        rules && rules.length > 0 ? loadRulesContent(rules) : '';
      prompt = buildPrdReviewPrompt(tempFilePath, rulesContext);
    } else {
      prompt = buildEnrichReviewPrompt(tempFilePath);
    }

    const progressMessages =
      reviewTarget === 'prd' ? PROGRESS_MESSAGES : ENRICH_PROGRESS_MESSAGES;

    // Capture tempFilePath for cleanup in stream
    const tempFileToClean = tempFilePath;

    const encoder = new TextEncoder();
    let streamClosed = false;
    let activeCodexProcess: ChildProcess | null = null;

    const stream = new ReadableStream({
      async start(controller) {
        const sendSSE = (data: Record<string, unknown>) => {
          if (streamClosed) return;
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          } catch {
            // Controller may be closed
          }
        };

        try {
          // Send initial progress
          sendSSE({ type: 'progress', message: progressMessages[0] });

          // Start a progress ticker
          let progressIndex = 1;
          const progressInterval = setInterval(() => {
            if (progressIndex < progressMessages.length) {
              sendSSE({ type: 'progress', message: progressMessages[progressIndex] });
              progressIndex++;
            }
          }, 5000);

          // Spawn Codex (60s timeout); track process for cancel cleanup
          const { stdout, exitCode } = await spawnCodex(prompt, 60_000, (proc) => {
            activeCodexProcess = proc;
          });
          activeCodexProcess = null;

          clearInterval(progressInterval);

          if (exitCode === -1) {
            sendSSE({
              type: 'error',
              error: 'Codex review timed out after 60 seconds',
            });
          } else {
            // Parse Codex output (fail-closed: BR-009)
            sendSSE({
              type: 'progress',
              message: progressMessages[progressMessages.length - 1],
            });

            const result = parseCodexOutput(stdout);

            if (!result.success) {
              sendSSE({
                type: 'error',
                error: 'Failed to parse Codex output — review could not be completed',
                rawOutput: stdout.substring(0, 2000),
              });
            } else {
              sendSSE({
                type: 'complete',
                findings: result.findings,
                reviewTarget,
              });
            }
          }
        } catch (error) {
          console.error('[prd-review] Error during review:', error);
          sendSSE({
            type: 'error',
            error: error instanceof Error ? error.message : 'Unknown error during review',
          });
        } finally {
          // Clean up temp file
          try {
            if (tempFileToClean) {
              fs.unlinkSync(tempFileToClean);
            }
          } catch {
            // Ignore cleanup errors
          }

          // Close stream
          streamClosed = true;
          try {
            controller.close();
          } catch {
            // Controller may already be closed
          }
        }
      },
      cancel() {
        streamClosed = true;
        // Kill in-flight Codex subprocess to avoid resource leak
        if (activeCodexProcess) {
          try {
            activeCodexProcess.kill('SIGTERM');
          } catch {
            // Ignore kill errors
          }
          activeCodexProcess = null;
        }
        // Clean up temp file on cancel
        try {
          if (tempFileToClean) {
            fs.unlinkSync(tempFileToClean);
          }
        } catch {
          // Ignore cleanup errors
        }
      },
    });

    // Null out tempFilePath since the stream now owns cleanup
    tempFilePath = null;

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    console.error('[prd-review] API error:', error);

    // Clean up temp file on outer error
    if (tempFilePath) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch {
        // Ignore cleanup errors
      }
    }

    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
