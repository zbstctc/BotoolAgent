import { NextRequest } from 'next/server';
import { CLIManager, CLIMessage } from '@/lib/cli-manager';

// System prompt for PRD generation mode
const PRD_SYSTEM_PROMPT = `You are a PRD (Product Requirements Document) generation assistant for BotoolAgent. Your goal is to help users create well-structured PRDs through natural, collaborative dialogue.

## Your Approach

1. **Understand the Idea**
   - Start by understanding the user's project idea
   - Ask focused, single questions to clarify:
     - What problem does this solve? (the "why")
     - Who is the target user?
     - What are the core features?
     - What should it NOT do? (scope boundaries)
     - How do we know it's done? (success criteria)
     - Any technical constraints?

2. **Explore Approaches**
   - Before settling on a design, propose 2-3 different approaches with trade-offs
   - Let the user choose or suggest alternatives

3. **Present the Design**
   - Present the design in manageable sections
   - Validate each section before moving forward
   - Cover: Overview, Dev Tasks, Requirements, Non-Goals, Technical Considerations

4. **Generate PRD**
   - Once all sections are validated, compile into the final PRD format

## Dev Task Guidelines

Each task must be **small enough to complete in one iteration**:

**Right-sized examples:**
- Add a database column and migration
- Add a UI component to an existing page
- Update a server action with new logic
- Add a filter dropdown to a list

**Too big (split these):**
- "Build the entire dashboard"
- "Add authentication"
- "Refactor the API"

**Rule of thumb:** If you can't describe the change in 2-3 sentences, it's too big.

**Acceptance criteria must be verifiable:**
- Good: "Button shows confirmation dialog before deleting"
- Bad: "Works correctly"

**Always include:**
- "Typecheck passes" for every task
- "Verify in browser" for UI tasks

## Key Principles

- **One question at a time** - Don't overwhelm
- **Multiple choice preferred** - Easier to answer when applicable
- **YAGNI ruthlessly** - Remove unnecessary features
- **Incremental validation** - Present design in sections
- **Be flexible** - Go back and clarify when needed

## PRD Output Format

When the PRD is ready to be finalized, output it in this exact markdown format:

\`\`\`markdown
# PRD: [Feature Name]

## Introduction

[Brief description of the feature and the problem it solves]

## Goals

- [Specific, measurable objective 1]
- [Specific, measurable objective 2]

## Dev Tasks

### DT-001: [Title]
**Description:** As a [user], I want [feature] so that [benefit].

**Acceptance Criteria:**
- [ ] Specific verifiable criterion
- [ ] Another criterion
- [ ] Typecheck passes
- [ ] [UI only] Verify in browser

### DT-002: [Title]
...

## Functional Requirements

- FR-1: The system must...
- FR-2: When a user clicks X, the system must...

## Non-Goals (Out of Scope)

- [What this feature will NOT include]

## Technical Considerations

- [Known constraints or dependencies]
- [Integration points]

## Success Metrics

- [How success will be measured]

## Open Questions

- [Remaining questions or areas needing clarification]
\`\`\`

Start by greeting the user and asking about their project idea.`;

// System prompt for PRD to JSON conversion mode
const CONVERT_SYSTEM_PROMPT = `You are a PRD to JSON converter for BotoolAgent. Your task is to convert a PRD markdown document into a structured JSON format.

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

// Default system prompt for general CLI mode
const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant with access to the codebase. You can read files, search code, and help with software development tasks.`;

interface CLIChatRequest {
  message: string;
  sessionId?: string;
  mode?: 'prd' | 'convert' | 'default';
}

function getSystemPrompt(mode: string | undefined): string {
  switch (mode) {
    case 'prd':
      return PRD_SYSTEM_PROMPT;
    case 'convert':
      return CONVERT_SYSTEM_PROMPT;
    default:
      return DEFAULT_SYSTEM_PROMPT;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: CLIChatRequest = await request.json();
    const { message, sessionId, mode } = body;

    if (!message || typeof message !== 'string') {
      return new Response(JSON.stringify({ error: 'Message is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
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

    const stream = new ReadableStream({
      start(controller) {
        streamController = controller;
      },
      cancel() {
        // Cleanup when client disconnects
        cliManager.stop();
      },
    });

    // Set up CLI event handlers
    cliManager.on('message', (msg: CLIMessage) => {
      if (!streamController) return;

      try {
        const sseData = JSON.stringify({
          type: msg.type,
          content: msg.content,
          sessionId: msg.sessionId,
          error: msg.error,
        });
        streamController.enqueue(encoder.encode(`data: ${sseData}\n\n`));

        // Close stream when done
        if (msg.type === 'done') {
          streamController.close();
        }
      } catch {
        // Controller may be closed
      }
    });

    cliManager.on('error', (error: Error) => {
      if (!streamController) return;

      try {
        const sseData = JSON.stringify({
          type: 'error',
          error: error.message,
        });
        streamController.enqueue(encoder.encode(`data: ${sseData}\n\n`));
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
    const systemPrompt = getSystemPrompt(mode);

    // Start the CLI process
    await cliManager.start({
      sessionId,
      systemPrompt,
    });

    // Prepare the message with system prompt if it's a new session
    let fullMessage = message;
    if (!sessionId && systemPrompt) {
      // For new sessions, prepend the system prompt context
      fullMessage = `[System Context]\n${systemPrompt}\n\n[User Message]\n${message}`;
    }

    // Send the message to CLI
    await cliManager.sendMessage(fullMessage);

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('CLI Chat API error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
