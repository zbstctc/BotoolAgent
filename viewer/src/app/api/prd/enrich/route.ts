import { NextRequest, NextResponse } from 'next/server';
import { CLIManager, CLIMessage } from '@/lib/cli-manager';
import { getProjectRoot } from '@/lib/project-root';
import type { SpecCodeExample, SpecTestCase, DevTaskEval } from '@/lib/tool-types';

// ============================================================================
// Types
// ============================================================================

interface AutoEnrichEval extends DevTaskEval {
  taskId?: string;
}

interface AutoEnrichResult {
  codeExamples: SpecCodeExample[];
  testCases: SpecTestCase[];
  filesToModify: string[];
  evals: AutoEnrichEval[];
  dependencies: { taskId: string; dependsOn: string[] }[];
  sessions: { id: string; tasks: string[]; reason?: string }[];
}

// ============================================================================
// Enrichment prompt (moved from AutoEnrichStep.tsx)
// ============================================================================

function buildEnrichmentPrompt(prdContent: string): string {
  return `请分析以下 PRD 内容，同时生成代码示例和测试用例。

## PRD 内容

${prdContent}

## 要求

1. 识别 PRD 中的所有开发任务
2. 为每个涉及数据结构的任务生成 TypeScript 代码示例（接口定义、数据结构等），每个 codeExample 必须包含 taskId 字段标明该示例属于哪个任务（如 "DT-001"）
3. 为每个任务生成测试用例（单元测试和端到端测试）
4. 列出需要修改的文件路径
5. 为每个任务生成可执行的验证命令（evals）
   - code-based eval: shell 命令验证（如 typecheck、grep 检查）
   - 每个任务至少生成一个 "npx tsc --noEmit" 的 typecheck eval
6. 分析任务间的依赖关系
   - 如果任务 B 依赖任务 A 创建的类型、组件或 API → B dependsOn A
   - 如果任务修改同一个文件且有顺序要求 → 标记依赖
   - 没有依赖的任务 dependsOn 为空数组
7. 将任务分成 sessions（每 session 最多 8 个 DT）
   - 有依赖关系的任务放同一 session
   - 修改同一批文件的任务放同一 session
   - 独立的任务按 priority 填充
   - 每个 session 附带分组原因

## 输出格式

请以 JSON 格式输出，格式如下：
\`\`\`json
{
  "codeExamples": [
    {
      "language": "typescript",
      "description": "代码描述",
      "code": "代码内容",
      "taskId": "DT-001"
    }
  ],
  "testCases": [
    {
      "type": "unit",
      "description": "测试描述",
      "steps": ["步骤1", "步骤2"]
    }
  ],
  "filesToModify": ["src/..."],
  "evals": [
    {
      "taskId": "DT-001",
      "type": "code-based",
      "blocking": true,
      "description": "Typecheck 通过",
      "command": "npx tsc --noEmit",
      "expect": "exit-0"
    }
  ],
  "dependencies": [
    { "taskId": "DT-005", "dependsOn": ["DT-003"] }
  ],
  "sessions": [
    { "id": "S1", "tasks": ["DT-001", "DT-002", "DT-003"], "reason": "分组原因" }
  ]
}
\`\`\`

如果 PRD 中没有涉及数据结构或可测试的任务，请输出空数组：
\`\`\`json
{ "codeExamples": [], "testCases": [], "filesToModify": [], "evals": [], "dependencies": [], "sessions": [] }
\`\`\``;
}

// ============================================================================
// Parse/normalize (moved from AutoEnrichStep.tsx)
// ============================================================================

function parseAutoEnrichResult(content: string): AutoEnrichResult {
  const emptyResult: AutoEnrichResult = {
    codeExamples: [],
    testCases: [],
    filesToModify: [],
    evals: [],
    dependencies: [],
    sessions: [],
  };

  try {
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch && jsonMatch[1]) {
      const parsed = JSON.parse(jsonMatch[1]);
      return normalizeEnrichResult(parsed);
    }

    const rawParsed = JSON.parse(content);
    return normalizeEnrichResult(rawParsed);
  } catch {
    console.error('Failed to parse auto-enrich result');
  }

  return emptyResult;
}

function normalizeEnrichResult(parsed: Record<string, unknown>): AutoEnrichResult {
  const codeExamples: SpecCodeExample[] = Array.isArray(parsed.codeExamples)
    ? (parsed.codeExamples as Record<string, unknown>[]).map((ex) => ({
        language: (ex.language as string) || 'typescript',
        description: (ex.description as string) || '',
        code: (ex.code as string) || '',
        taskId: (ex.taskId as string) || undefined,
      }))
    : [];

  const testCases: SpecTestCase[] = Array.isArray(parsed.testCases)
    ? (parsed.testCases as Record<string, unknown>[]).map((tc) => ({
        type:
          (tc.type as string) === 'unit' || (tc.type as string) === 'e2e'
            ? (tc.type as 'unit' | 'e2e')
            : 'unit',
        description: (tc.description as string) || '',
        steps: Array.isArray(tc.steps) ? (tc.steps as string[]) : [],
      }))
    : [];

  const filesToModify: string[] = Array.isArray(parsed.filesToModify)
    ? (parsed.filesToModify as string[])
    : [];

  const evals: AutoEnrichEval[] = Array.isArray(parsed.evals)
    ? (parsed.evals as Record<string, unknown>[]).map((ev) => ({
        type:
          (ev.type as string) === 'code-based' || (ev.type as string) === 'model-based'
            ? (ev.type as 'code-based' | 'model-based')
            : 'code-based',
        blocking: (ev.blocking as boolean) ?? true,
        description: (ev.description as string) || '',
        command: (ev.command as string) || undefined,
        expect: (ev.expect as string) || undefined,
        files: Array.isArray(ev.files) ? (ev.files as string[]) : undefined,
        criteria: (ev.criteria as string) || undefined,
        taskId: (ev.taskId as string) || undefined,
      }))
    : [];

  const dependencies: { taskId: string; dependsOn: string[] }[] = Array.isArray(
    parsed.dependencies,
  )
    ? (parsed.dependencies as Record<string, unknown>[]).map((dep) => ({
        taskId: (dep.taskId as string) || '',
        dependsOn: Array.isArray(dep.dependsOn) ? (dep.dependsOn as string[]) : [],
      }))
    : [];

  const sessions: { id: string; tasks: string[]; reason?: string }[] = Array.isArray(
    parsed.sessions,
  )
    ? (parsed.sessions as Record<string, unknown>[]).map((s) => ({
        id: (s.id as string) || '',
        tasks: Array.isArray(s.tasks) ? (s.tasks as string[]) : [],
        reason: (s.reason as string) || undefined,
      }))
    : [];

  return { codeExamples, testCases, filesToModify, evals, dependencies, sessions };
}

// ============================================================================
// SSE progress messages (rotated for user feedback)
// ============================================================================

const PROGRESS_MESSAGES = [
  '正在分析 PRD 结构...',
  '正在识别开发任务...',
  '正在生成代码示例...',
  '正在生成测试用例...',
  '正在分析文件依赖...',
  '正在生成验证命令...',
  '正在分析任务依赖关系...',
  '正在规划 Session 分组...',
  '正在整理输出结果...',
];

// ============================================================================
// API Handler
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { prdContent } = body as { prdContent: string };

    if (!prdContent) {
      return NextResponse.json({ error: 'prdContent is required' }, { status: 400 });
    }

    const workingDir = getProjectRoot();
    const cliManager = new CLIManager({ workingDir });

    const encoder = new TextEncoder();
    let streamController: ReadableStreamDefaultController | null = null;
    let fullContent = '';
    let messageCount = 0;

    const stream = new ReadableStream({
      start(controller) {
        streamController = controller;
      },
      cancel() {
        cliManager.stop();
      },
    });

    cliManager.on('message', (msg: CLIMessage) => {
      if (!streamController) return;

      try {
        if (msg.type === 'text' && msg.content) {
          fullContent += msg.content;
          const progressMsg = PROGRESS_MESSAGES[messageCount % PROGRESS_MESSAGES.length];
          messageCount++;
          streamController.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: 'progress', message: progressMsg })}\n\n`,
            ),
          );
        } else if (msg.type === 'done') {
          // Parse the enrichment result
          const enrichResult = parseAutoEnrichResult(fullContent);

          streamController.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: 'complete', result: enrichResult })}\n\n`,
            ),
          );
          streamController.close();
          cliManager.stop();
        } else if (msg.type === 'error') {
          streamController.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: 'error', error: msg.error || 'Unknown error' })}\n\n`,
            ),
          );
          streamController.close();
          cliManager.stop();
        }
      } catch {
        // Controller may be closed
      }
    });

    cliManager.on('error', (error: Error) => {
      if (!streamController) return;

      try {
        streamController.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`,
          ),
        );
        streamController.close();
        cliManager.stop();
      } catch {
        // Controller may be closed
      }
    });

    cliManager.on('exit', () => {
      if (!streamController) return;

      try {
        streamController.close();
      } catch {
        // Controller may be closed
      }
    });

    await cliManager.start({});
    await cliManager.sendMessage(buildEnrichmentPrompt(prdContent));

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Enrich API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
