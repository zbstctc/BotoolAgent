import { NextRequest } from 'next/server';
import * as fs from 'fs';
import { getPrdJsonPath, getProgressPath } from '@/lib/project-root';

// File paths to watch
const WATCHED_FILES = {
  prd: getPrdJsonPath(),
  progress: getProgressPath(),
};

interface FileContent {
  prd: string | null;
  progress: string | null;
}

function readFileContent(filePath: string): string | null {
  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf-8');
    }
  } catch {
    // File doesn't exist or can't be read
  }
  return null;
}

function getFileContents(): FileContent {
  return {
    prd: readFileContent(WATCHED_FILES.prd),
    progress: readFileContent(WATCHED_FILES.progress),
  };
}

export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();

  // Get the abort signal from the request
  const { signal } = request;

  const stream = new ReadableStream({
    start(controller) {
      let lastContents = getFileContents();

      // Send initial data
      const initialData = {
        type: 'initial',
        data: lastContents,
        timestamp: Date.now(),
      };
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(initialData)}\n\n`));

      // Set up file watching with polling (more reliable than fs.watch for cross-platform)
      const pollInterval = setInterval(() => {
        try {
          const currentContents = getFileContents();

          // Check for changes in prd.json
          if (currentContents.prd !== lastContents.prd) {
            const event = {
              type: 'prd-update',
              data: currentContents.prd,
              timestamp: Date.now(),
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          }

          // Check for changes in progress.txt
          if (currentContents.progress !== lastContents.progress) {
            const event = {
              type: 'progress-update',
              data: currentContents.progress,
              timestamp: Date.now(),
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          }

          lastContents = currentContents;
        } catch {
          // Ignore errors during polling
        }
      }, 1000); // Poll every second

      // Send heartbeat to keep connection alive
      const heartbeatInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          // Connection closed
        }
      }, 15000); // Every 15 seconds

      // Clean up on abort
      signal.addEventListener('abort', () => {
        clearInterval(pollInterval);
        clearInterval(heartbeatInterval);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
