import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { CLIManager, CLIMessage } from '@/lib/cli-manager';

// Path to project root (parent of viewer)
const PROJECT_ROOT = path.join(process.cwd(), '..');

// System prompt for PRD to JSON conversion
const SYSTEM_PROMPT = `You are a PRD to JSON converter for BotoolAgent. Your task is to convert a PRD markdown document into a structured JSON format.

## Output Format

You must output ONLY valid JSON, no explanations or markdown. The format is:

{
  "project": "[Project Name - extract from PRD title]",
  "branchName": "botool/[feature-name-kebab-case]",
  "description": "[Feature description from PRD introduction]",
  "devTasks": [
    {
      "id": "DT-001",
      "title": "[Task title]",
      "description": "As a [user], I want [feature] so that [benefit]",
      "acceptanceCriteria": [
        "Criterion 1",
        "Criterion 2",
        "Typecheck passes"
      ],
      "priority": 1,
      "passes": false,
      "notes": ""
    }
  ]
}

## Conversion Rules

1. **Project Name**: Extract from the PRD title (after "PRD:")
2. **Branch Name**: Derive from feature name, kebab-case, prefixed with "botool/"
3. **Description**: Use the introduction/overview text
4. **Dev Tasks**: Convert each DT-xxx section from the PRD
   - Keep the task ID format (DT-001, DT-002, etc.)
   - Extract title, description, and acceptance criteria
   - Priority follows document order (first task = 1, second = 2, etc.)
   - All tasks start with passes: false and empty notes
5. **Acceptance Criteria**:
   - Convert checkbox items to array strings (remove "- [ ]" prefix)
   - Always ensure "Typecheck passes" is included
   - UI tasks should have "Verify in browser"

## Task Size Validation

Each task should be completable in ONE iteration. If a task seems too large, keep it as-is but note it - the user can split it later.

Output ONLY the JSON object, nothing else.`;

interface ConvertRequest {
  prdContent: string;
  prdId: string;
}

/**
 * PRD to JSON conversion endpoint - now uses CLI instead of direct Anthropic API calls.
 * This endpoint converts a PRD markdown document to structured JSON and saves it to prd.json.
 */
export async function POST(request: NextRequest) {
  try {
    const body: ConvertRequest = await request.json();
    const { prdContent, prdId } = body;

    if (!prdContent) {
      return NextResponse.json({ error: 'PRD content is required' }, { status: 400 });
    }

    // Get working directory (project root, parent of viewer)
    const workingDir = process.cwd().replace(/\/viewer$/, '');

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

            // Archive existing prd.json if it has a different branch
            await archiveIfNeeded(prdJson);

            // Write prd.json to project root
            const prdJsonPath = path.join(PROJECT_ROOT, 'prd.json');
            fs.writeFileSync(prdJsonPath, JSON.stringify(prdJson, null, 2));

            // Reset progress.txt with fresh header
            const progressPath = path.join(PROJECT_ROOT, 'progress.txt');
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
    await cliManager.start({
      systemPrompt: SYSTEM_PROMPT,
    });

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
  const prdJsonPath = path.join(PROJECT_ROOT, 'prd.json');
  const progressPath = path.join(PROJECT_ROOT, 'progress.txt');

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
      const archiveDir = path.join(PROJECT_ROOT, 'archive', `${date}-${featureName}`);

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
