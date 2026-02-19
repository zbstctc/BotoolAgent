import { NextRequest, NextResponse } from 'next/server';
import { CLIManager, CLIMessage } from '@/lib/cli-manager';
import type { ReviewFinding } from '../review/route';

// ============================================================================
// Prompt builders
// ============================================================================

function buildPrdFixPrompt(content: string, findings: ReviewFinding[]): string {
  const findingsList = findings
    .map(
      (f, i) =>
        `${i + 1}. [${f.severity}] ${f.category}${f.section ? ` (${f.section})` : ''}: ${f.message}\n   Suggestion: ${f.suggestion}`,
    )
    .join('\n');

  return `You are a PRD editor. Fix the following PRD based on the review findings below.

RULES:
- Keep the original PRD structure and section numbering intact
- Only modify sections that address the findings
- Do not add new sections or remove existing ones unless a finding specifically requires it
- Preserve all existing content that is not related to the findings
- Output the complete fixed PRD (not just the changed parts)

=== REVIEW FINDINGS ===
${findingsList}
=== END FINDINGS ===

=== ORIGINAL PRD ===
${content}
=== END PRD ===

Output the complete fixed PRD below. Do not include any commentary, explanation, or markdown code fences — output ONLY the PRD content.`;
}

function buildEnrichFixPrompt(content: string, findings: ReviewFinding[]): string {
  const findingsList = findings
    .map(
      (f, i) =>
        `${i + 1}. [${f.severity}] ${f.category}${f.taskId ? ` (${f.taskId})` : ''}: ${f.message}\n   Suggestion: ${f.suggestion}`,
    )
    .join('\n');

  return `You are an enrichment output editor. Fix the following enrichment result based on the review findings below.

RULES:
- Fix code examples to be syntactically valid TypeScript/JavaScript
- Fix dependency references to be acyclic and consistent
- Fix file paths to match the project structure
- Fix eval commands to be valid shell commands
- Fix session grouping (max 8 DTs per session, respect dependencies)
- Output the complete fixed enrichment result (not just changed parts)
- Preserve all fields and structure not related to the findings

=== REVIEW FINDINGS ===
${findingsList}
=== END FINDINGS ===

=== ORIGINAL ENRICHMENT RESULT ===
${content}
=== END ENRICHMENT RESULT ===

Output the complete fixed enrichment result below. Do not include any commentary, explanation, or markdown code fences — output ONLY the enrichment content.`;
}

// ============================================================================
// SSE progress messages
// ============================================================================

const PRD_FIX_PROGRESS = [
  '正在分析审查结果...',
  '正在启动 Claude 修正...',
  '正在修正 PRD 文档...',
  '正在保持文档结构...',
  '正在验证修正内容...',
];

const ENRICH_FIX_PROGRESS = [
  '正在分析审查结果...',
  '正在启动 Claude 修正...',
  '正在修正代码示例...',
  '正在修正依赖关系...',
  '正在验证修正内容...',
];

// ============================================================================
// API Handler
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { content, findings, target } = body as {
      content: string;
      findings: ReviewFinding[];
      target: 'prd' | 'enrich';
    };

    // Input validation at handler top
    if (!content || typeof content !== 'string') {
      return NextResponse.json(
        { error: 'content is required and must be a string' },
        { status: 400 },
      );
    }

    if (!findings || !Array.isArray(findings) || findings.length === 0) {
      return NextResponse.json(
        { error: 'findings is required and must be a non-empty array' },
        { status: 400 },
      );
    }

    if (!target || (target !== 'prd' && target !== 'enrich')) {
      return NextResponse.json(
        { error: 'target must be "prd" or "enrich"' },
        { status: 400 },
      );
    }

    // Build prompt
    const prompt =
      target === 'prd'
        ? buildPrdFixPrompt(content, findings)
        : buildEnrichFixPrompt(content, findings);

    const progressMessages =
      target === 'prd' ? PRD_FIX_PROGRESS : ENRICH_FIX_PROGRESS;

    const encoder = new TextEncoder();
    let streamClosed = false;
    let cliManager: CLIManager | null = null;

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

          // Start progress ticker
          let progressIndex = 1;
          const progressInterval = setInterval(() => {
            if (progressIndex < progressMessages.length) {
              sendSSE({ type: 'progress', message: progressMessages[progressIndex] });
              progressIndex++;
            }
          }, 5000);

          // Accumulate Claude's response text
          let fixedContent = '';

          cliManager = new CLIManager();

          // Collect text messages from CLI
          const cliDone = new Promise<void>((resolve, reject) => {
            let done = false;

            cliManager!.on('message', (msg: CLIMessage) => {
              if (msg.type === 'text' && msg.content) {
                fixedContent += msg.content;
                // Stream partial content as progress
                sendSSE({ type: 'streaming', chunk: msg.content });
              } else if (msg.type === 'done') {
                if (!done) {
                  done = true;
                  resolve();
                }
              } else if (msg.type === 'error') {
                if (!done) {
                  done = true;
                  reject(new Error(msg.error || 'CLI error'));
                }
              }
            });

            cliManager!.on('exit', () => {
              if (!done) {
                done = true;
                resolve();
              }
            });

            cliManager!.on('error', (err: Error) => {
              if (!done) {
                done = true;
                reject(err);
              }
            });
          });

          // Start CLI and send the fix prompt (120s timeout for fix operations)
          await cliManager.start({ timeout: 120_000 });
          await cliManager.sendMessage(prompt);
          await cliDone;

          clearInterval(progressInterval);

          if (!fixedContent.trim()) {
            sendSSE({
              type: 'error',
              error: 'Claude returned empty content — fix could not be completed',
            });
          } else {
            sendSSE({
              type: 'complete',
              fixedContent: fixedContent.trim(),
              target,
              findingsCount: findings.length,
            });
          }
        } catch (error) {
          console.error('[prd-fix] Error during fix:', error);
          sendSSE({
            type: 'error',
            error: 'Internal server error during fix',
          });
        } finally {
          // Stop CLI manager
          if (cliManager) {
            try {
              await cliManager.stop();
            } catch {
              // Ignore cleanup errors
            }
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
        if (cliManager) {
          cliManager.stop().catch(() => {});
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    console.error('[prd-fix] API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
