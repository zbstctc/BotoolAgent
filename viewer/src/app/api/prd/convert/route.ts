import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { CLIManager, CLIMessage } from '@/lib/cli-manager';
import { getProjectRoot, getPrdJsonPath, getProgressPath, getProjectPrdJsonPath, getProjectPrdMdPath, getProjectProgressPath, getSnapshotsDir, getRegistryPath, getTasksDir, isPortableMode } from '@/lib/project-root';

// System prompt for PRD to JSON conversion (slim index format)
const SYSTEM_PROMPT = `You are a PRD to JSON converter for BotoolAgent. Convert a PRD markdown document into a **slim prd.json** — an automation index. The PRD.md is the Single Source of Truth; prd.json only contains automation fields.

## Output Format

You must output ONLY valid JSON, no explanations or markdown. The format is:

{
  "project": "[Project Name - extract from PRD title]",
  "branchName": "botool/[feature-name-kebab-case]",
  "description": "[Feature description from PRD § 1 or introduction]",
  "devTasks": [
    {
      "id": "DT-001",
      "title": "[Task title]",
      "prdSection": "7.1 (L15-32)",
      "priority": 1,
      "passes": false,
      "dependsOn": [],
      "evals": [
        { "type": "code-based", "blocking": true, "description": "Typecheck passes", "command": "npx tsc --noEmit", "expect": "exit-0" }
      ],
      "testCases": [
        { "type": "typecheck", "desc": "TypeScript 编译通过" }
      ]
    }
  ],
  "sessions": [
    { "id": "S1", "tasks": ["DT-001", "DT-002"], "reason": "Phase 1 基础任务" }
  ]
}

## Conversion Rules

1. **Project Name**: Extract from the PRD title (after "PRD:")
2. **Branch Name**: Derive from feature name, kebab-case, prefixed with "botool/"
3. **Description**: Use the introduction/overview text from PRD § 1
4. **prdSection Mapping**: Map each task to its PRD Phase section **with line number range**
   - Count line numbers in the PRD content provided
   - Tasks under "## 7.1 Phase 1" starting at line 15, next heading at line 33 → prdSection: "7.1 (L15-32)"
   - Tasks under "## 7.2 Phase 2" starting at line 33, next heading at line 50 → prdSection: "7.2 (L33-49)"
   - If PRD uses flat DT list (no Phases) → prdSection: "7"
   - The line range lets the coding agent jump-read the exact section with Read tool offset/limit
5. **Dev Tasks**: Extract from PRD § 7 (开发计划)
   - Keep the task ID format (DT-001, DT-002, etc.)
   - Extract: id, title, prdSection (with line range), priority, passes, dependsOn, evals, testCases
   - Do NOT include description or acceptanceCriteria (these stay in PRD.md)
   - Priority follows document order (first task = 1, second = 2, etc.)
   - All tasks start with passes: false
6. **Dependencies**: If Phase N depends on Phase M, all tasks in N depend on tasks in M
   - Also check explicit dependency markers in the PRD
7. **Evals**: Every task must have at least one eval:
   - Always include: { "type": "code-based", "blocking": true, "description": "Typecheck passes", "command": "npx tsc --noEmit", "expect": "exit-0" }
   - Database tasks: add { "type": "code-based", "blocking": true, "description": "Migration file exists", "command": "test -f [migration-file]", "expect": "exit-0" }
   - Component tasks: add file existence check for the component
8. **testCases**: Every task gets { "type": "typecheck", "desc": "TypeScript 编译通过" }. Additionally:
   - Tasks with transformation/parsing/filtering logic → add { "type": "unit", "desc": "核心逻辑单元测试", "tdd": true }
   - UI/page/rendering tasks → add { "type": "e2e", "desc": "页面功能端到端测试" }
   - Visual/animation tasks → add { "type": "manual", "desc": "视觉和交互手动验证" }
9. **Sessions**: Group tasks into sessions (max 8 tasks per session):
   - Tasks with dependencies go in the same session
   - Tasks modifying the same files go in the same session
   - Each session has a "reason" explaining the grouping

## Task Size Validation

Each task should be completable in ONE iteration. If a task seems too large, keep it as-is.

Output ONLY the JSON object, nothing else.`;

interface ConvertRequest {
  prdContent: string;
  prdId: string;
  projectId?: string;
}

/**
 * PRD to JSON conversion endpoint - now uses CLI instead of direct Anthropic API calls.
 * This endpoint converts a PRD markdown document to structured JSON and saves it to prd.json.
 */
export async function POST(request: NextRequest) {
  try {
    const body: ConvertRequest = await request.json();
    const { prdContent, prdId, projectId } = body;

    if (!prdContent) {
      return NextResponse.json({ error: 'PRD content is required' }, { status: 400 });
    }

    // Get working directory (user's project root)
    const workingDir = getProjectRoot();

    // Create CLI manager instance
    const cliManager = new CLIManager({
      workingDir,
    });

    // Create a readable stream for SSE
    const encoder = new TextEncoder();
    let streamController: ReadableStreamDefaultController | null = null;
    let fullContent = '';

    const stream = new ReadableStream({
      start(controller) {
        streamController = controller;
      },
      cancel() {
        cliManager.stop();
      },
    });

    // Set up CLI event handlers
    cliManager.on('message', async (msg: CLIMessage) => {
      if (!streamController) return;

      try {
        if (msg.type === 'text' && msg.content) {
          fullContent += msg.content;
          // Emit progress event
          streamController.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'progress', content: msg.content })}\n\n`)
          );
        } else if (msg.type === 'done') {
          // Conversion complete - try to parse and save JSON
          try {
            // Extract JSON from response (in case there's any surrounding text)
            const jsonMatch = fullContent.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
              throw new Error('No valid JSON found in response');
            }

            const prdJson = JSON.parse(jsonMatch[0]);

            // Inject prdFile if not present (points to the source PRD)
            // New format: tasks/{id}/prd.md; portable mode: BotoolAgent/tasks/{id}/prd.md
            if (!prdJson.prdFile && prdId) {
              const tasksPrefix = isPortableMode() ? 'BotoolAgent/tasks' : 'tasks';
              prdJson.prdFile = `${tasksPrefix}/${prdId}/prd.md`;
            }

            // Archive existing prd.json if it has a different branch
            await archiveIfNeeded(prdJson);

            // Write prd.json to per-project path
            const prdJsonPath = getProjectPrdJsonPath(projectId);
            // Ensure project directory exists (in case prd.md was not saved via save route)
            if (projectId) {
              const prdMdPath = getProjectPrdMdPath(projectId);
              if (!fs.existsSync(prdMdPath) && prdId) {
                // Legacy: check for flat prd-{id}.md and copy to per-project location
                const legacyPath = path.join(getTasksDir(), `prd-${prdId}.md`);
                if (fs.existsSync(legacyPath)) {
                  fs.mkdirSync(path.dirname(prdMdPath), { recursive: true });
                  fs.copyFileSync(legacyPath, prdMdPath);
                }
              }
            }
            fs.writeFileSync(prdJsonPath, JSON.stringify(prdJson, null, 2));

            if (projectId) {
              // Update registry (no root prd.json double-write)
              updateRegistry(projectId, prdJson.project || prdId, prdJson.branchName, 'coding');
            }

            // Reset progress.txt with fresh header
            const progressPath = getProjectProgressPath(projectId);
            const header = `# Botool Dev Agent Progress Log\nStarted: ${new Date().toLocaleString()}\n---\n\n## Codebase Patterns\n- (patterns will be added here as discovered)\n\n---\n`;
            fs.writeFileSync(progressPath, header);

            streamController.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: 'complete',
                  prdJson,
                  savedTo: prdJsonPath,
                })}\n\n`
              )
            );
          } catch (parseError) {
            const errorMsg = parseError instanceof Error ? parseError.message : 'Unknown error';
            streamController.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: 'error',
                  error: `Failed to parse JSON: ${errorMsg}`,
                  rawContent: fullContent,
                })}\n\n`
              )
            );
          }
          streamController.close();
        } else if (msg.type === 'error') {
          streamController.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: 'error',
                error: msg.error || 'Unknown error',
              })}\n\n`
            )
          );
          streamController.close();
        }
        // Ignore 'session' type messages
      } catch {
        // Controller may be closed
      }
    });

    cliManager.on('error', (error: Error) => {
      if (!streamController) return;

      try {
        streamController.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: 'error',
              error: error.message,
            })}\n\n`
          )
        );
        streamController.close();
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

    // Start CLI and send message
    await cliManager.start({});

    // Prepare the conversion request
    const fullMessage = `[System Context]\n${SYSTEM_PROMPT}\n\n[User Message]\nConvert this PRD to JSON:\n\n${prdContent}`;

    // Send the message to CLI
    await cliManager.sendMessage(fullMessage);

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Convert API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function archiveIfNeeded(newPrdJson: { branchName: string }) {
  const prdJsonPath = getPrdJsonPath();
  const progressPath = getProgressPath();

  // Check if existing prd.json exists
  if (!fs.existsSync(prdJsonPath)) {
    return;
  }

  try {
    const existingPrd = JSON.parse(fs.readFileSync(prdJsonPath, 'utf-8'));

    // If same branch, no need to archive
    if (existingPrd.branchName === newPrdJson.branchName) {
      return;
    }

    // Check if progress.txt has meaningful content
    const hasProgress =
      fs.existsSync(progressPath) && fs.readFileSync(progressPath, 'utf-8').includes('## 20');

    if (hasProgress) {
      // Create archive directory
      const date = new Date().toISOString().split('T')[0];
      const featureName = existingPrd.branchName?.replace('botool/', '') || 'unknown';
      const archiveDir = path.join(getSnapshotsDir(), `${date}-${featureName}`);

      fs.mkdirSync(archiveDir, { recursive: true });

      // Copy files to archive
      fs.copyFileSync(prdJsonPath, path.join(archiveDir, 'prd.json'));
      fs.copyFileSync(progressPath, path.join(archiveDir, 'progress.txt'));

      console.log(`Archived previous run to ${archiveDir}`);
    }
  } catch (error) {
    console.error('Archive error:', error);
    // Continue even if archiving fails
  }
}

interface RegistryProject {
  name: string;
  prdMd: string;
  prdJson: string;
  progress: string;
  branch: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface Registry {
  version: number;
  projects: Record<string, RegistryProject>;
  activeProject: string | null;
}

function updateRegistry(projectId: string, name: string, branch?: string, status?: string): void {
  try {
    const registryPath = getRegistryPath();
    let registry: Registry = { version: 1, projects: {}, activeProject: null };

    if (fs.existsSync(registryPath)) {
      registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
    }

    const now = new Date().toISOString();
    const existing = registry.projects[projectId];

    registry.projects[projectId] = {
      name: name || existing?.name || projectId,
      prdMd: `${projectId}/prd.md`,
      prdJson: `${projectId}/prd.json`,
      progress: `${projectId}/progress.txt`,
      branch: branch || existing?.branch || `botool/${projectId}`,
      status: status || existing?.status || 'draft',
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    registry.activeProject = projectId;

    fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
  } catch (error) {
    console.error('Registry update error:', error);
  }
}
