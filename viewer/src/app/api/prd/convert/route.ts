import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

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

export async function POST(request: NextRequest) {
  try {
    const body: ConvertRequest = await request.json();
    const { prdContent, prdId } = body;

    if (!prdContent) {
      return NextResponse.json(
        { error: 'PRD content is required' },
        { status: 400 }
      );
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'ANTHROPIC_API_KEY is not configured' },
        { status: 500 }
      );
    }

    // Call Anthropic API for conversion
    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `Convert this PRD to JSON:\n\n${prdContent}`,
          },
        ],
        stream: true,
      }),
    });

    if (!anthropicResponse.ok) {
      const errorText = await anthropicResponse.text();
      console.error('Anthropic API error:', errorText);
      return NextResponse.json(
        { error: 'Failed to connect to AI service' },
        { status: anthropicResponse.status }
      );
    }

    // Create a transform stream to collect the response and emit progress
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    let fullContent = '';

    const transformStream = new TransformStream({
      async transform(chunk, controller) {
        const text = decoder.decode(chunk, { stream: true });
        const lines = text.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              continue;
            }

            try {
              const parsed = JSON.parse(data);

              if (parsed.type === 'content_block_delta') {
                const delta = parsed.delta;
                if (delta?.type === 'text_delta' && delta.text) {
                  fullContent += delta.text;
                  // Emit progress event
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({ type: 'progress', content: delta.text })}\n\n`
                    )
                  );
                }
              } else if (parsed.type === 'message_stop') {
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

                  controller.enqueue(
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
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({
                        type: 'error',
                        error: `Failed to parse JSON: ${errorMsg}`,
                        rawContent: fullContent,
                      })}\n\n`
                    )
                  );
                }
              } else if (parsed.type === 'error') {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: 'error',
                      error: parsed.error?.message || 'Unknown error',
                    })}\n\n`
                  )
                );
              }
            } catch {
              // Skip invalid JSON lines
            }
          }
        }
      },
    });

    const responseBody = anthropicResponse.body;
    if (!responseBody) {
      return NextResponse.json(
        { error: 'No response body' },
        { status: 500 }
      );
    }

    const stream = responseBody.pipeThrough(transformStream);

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Convert API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
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
    const hasProgress = fs.existsSync(progressPath) && fs.readFileSync(progressPath, 'utf-8').includes('## 20');

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
