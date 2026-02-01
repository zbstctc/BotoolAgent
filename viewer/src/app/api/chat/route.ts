import { NextRequest } from 'next/server';
import { CLIManager, CLIMessage } from '@/lib/cli-manager';

// System prompt for PRD generation (used when called via legacy /api/chat endpoint)
const SYSTEM_PROMPT = `You are a PRD (Product Requirements Document) generation assistant for BotoolAgent. Your goal is to help users create well-structured PRDs through natural, collaborative dialogue.

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

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatRequest {
  messages: ChatMessage[];
}

/**
 * Legacy /api/chat endpoint - now uses CLI instead of direct Anthropic API calls.
 * This endpoint maintains backward compatibility with the original useChat hook.
 * New code should use /api/cli/chat instead.
 */
export async function POST(request: NextRequest) {
  try {
    const body: ChatRequest = await request.json();
    const { messages } = body;

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: 'Messages array is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Get the last user message (CLI mode works with single messages, not full history)
    const lastUserMessage = messages.filter((m) => m.role === 'user').pop();
    if (!lastUserMessage) {
      return new Response(JSON.stringify({ error: 'No user message found' }), {
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
        cliManager.stop();
      },
    });

    // Set up CLI event handlers
    cliManager.on('message', (msg: CLIMessage) => {
      if (!streamController) return;

      try {
        // Convert CLI message format to legacy format
        if (msg.type === 'text') {
          streamController.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'text', content: msg.content })}\n\n`)
          );
        } else if (msg.type === 'done') {
          streamController.enqueue(encoder.encode(`data: {"type": "done"}\n\n`));
          streamController.close();
        } else if (msg.type === 'error') {
          streamController.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'error', error: msg.error })}\n\n`)
          );
          streamController.close();
        }
        // Ignore 'session' type messages in legacy format
      } catch {
        // Controller may be closed
      }
    });

    cliManager.on('error', (error: Error) => {
      if (!streamController) return;

      try {
        streamController.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`)
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

    // Build context from conversation history for the CLI
    const conversationContext = messages
      .slice(0, -1) // Exclude the last user message (we'll send it separately)
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n\n');

    // Prepare message with conversation context
    let fullMessage = lastUserMessage.content;
    if (conversationContext) {
      fullMessage = `[Conversation History]\n${conversationContext}\n\n[Current Message]\n${lastUserMessage.content}`;
    }

    // Prepend system prompt for new conversations
    if (messages.length === 1) {
      fullMessage = `[System Context]\n${SYSTEM_PROMPT}\n\n[User Message]\n${lastUserMessage.content}`;
    }

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
    console.error('Chat API error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
