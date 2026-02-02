import { NextRequest } from 'next/server';
import { CLIManager, CLIMessage } from '@/lib/cli-manager';

interface CLIRespondRequest {
  sessionId: string;
  toolResponse: Record<string, unknown>;
  mode?: 'prd' | 'convert' | 'default';
}

export async function POST(request: NextRequest) {
  try {
    const body: CLIRespondRequest = await request.json();
    const { sessionId, toolResponse } = body;

    if (!sessionId || typeof sessionId !== 'string') {
      return new Response(JSON.stringify({ error: 'Session ID is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!toolResponse || typeof toolResponse !== 'object') {
      return new Response(JSON.stringify({ error: 'Tool response is required' }), {
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

    // Resume the existing session
    await cliManager.start({
      sessionId,
    });

    // Convert tool response to JSON string and send as user input
    // The CLI expects user input as plain text - for tool responses, we send the JSON
    const responseMessage = JSON.stringify(toolResponse);
    await cliManager.sendMessage(responseMessage);

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('CLI Respond API error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
