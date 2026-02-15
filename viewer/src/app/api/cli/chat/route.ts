import { NextRequest } from 'next/server';
import { CLIManager, CLIMessage } from '@/lib/cli-manager';
import { getProjectRoot } from '@/lib/project-root';

interface CLIChatRequest {
  message: string;
  sessionId?: string;
  mode?: 'prd' | 'convert' | 'default';
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

    // Get working directory (user's project root)
    const workingDir = getProjectRoot();

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
          // Include tool_use fields
          toolId: msg.toolId,
          toolName: msg.toolName,
          toolInput: msg.toolInput,
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

    // Start the CLI process
    await cliManager.start({
      sessionId,
    });

    // Prepare message - trigger skill for first message in prd mode
    let messageToSend = message;
    if (mode === 'prd' && !sessionId) {
      // First message in PRD mode - trigger the pyramidprd skill
      messageToSend = `/botoolagent-pyramidprd ${message}`;
    }

    // Send the message to CLI
    await cliManager.sendMessage(messageToSend);

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
