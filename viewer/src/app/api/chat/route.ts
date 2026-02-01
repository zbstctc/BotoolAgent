import { NextRequest } from 'next/server';

// System prompt for PRD generation based on the BotoolAgent skill
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

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY is not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Convert messages to Anthropic format
    const anthropicMessages = messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    // Create streaming response from Anthropic
    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: anthropicMessages,
        stream: true,
      }),
    });

    if (!anthropicResponse.ok) {
      const errorText = await anthropicResponse.text();
      console.error('Anthropic API error:', errorText);
      return new Response(JSON.stringify({ error: 'Failed to connect to AI service' }), {
        status: anthropicResponse.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Create a transform stream to convert Anthropic's streaming format to our SSE format
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const transformStream = new TransformStream({
      async transform(chunk, controller) {
        const text = decoder.decode(chunk, { stream: true });
        const lines = text.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              controller.enqueue(encoder.encode(`data: {"type": "done"}\n\n`));
              continue;
            }

            try {
              const parsed = JSON.parse(data);

              // Handle different event types from Anthropic
              if (parsed.type === 'content_block_delta') {
                const delta = parsed.delta;
                if (delta?.type === 'text_delta' && delta.text) {
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ type: 'text', content: delta.text })}\n\n`)
                  );
                }
              } else if (parsed.type === 'message_stop') {
                controller.enqueue(encoder.encode(`data: {"type": "done"}\n\n`));
              } else if (parsed.type === 'error') {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ type: 'error', error: parsed.error?.message || 'Unknown error' })}\n\n`)
                );
              }
            } catch {
              // Skip invalid JSON lines
            }
          }
        }
      },
    });

    // Pipe Anthropic's response through our transform stream
    const responseBody = anthropicResponse.body;
    if (!responseBody) {
      return new Response(JSON.stringify({ error: 'No response body' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
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
    console.error('Chat API error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
