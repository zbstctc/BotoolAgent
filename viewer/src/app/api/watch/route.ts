import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import { getProjectPrdJsonPath, getProjectProgressPath, getProjectTeammatesPath, normalizeProjectId } from '@/lib/project-root';

interface FileContent {
  prd: string | null;
  progress: string | null;
  teammates: string | null;
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

function getWatchedFiles(projectId?: string | null) {
  return {
    prd: getProjectPrdJsonPath(projectId),
    progress: getProjectProgressPath(projectId),
    teammates: getProjectTeammatesPath(projectId),
  };
}

function getFileContents(projectId?: string | null): FileContent {
  const files = getWatchedFiles(projectId);
  return {
    prd: readFileContent(files.prd),
    progress: readFileContent(files.progress),
    teammates: readFileContent(files.teammates),
  };
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const rawProjectId = url.searchParams.get('projectId') || undefined;

  // Validate projectId to prevent path traversal
  let projectId: string | undefined;
  if (rawProjectId) {
    const safeProjectId = normalizeProjectId(rawProjectId);
    if (!safeProjectId) {
      return NextResponse.json({ error: 'Invalid projectId' }, { status: 400 });
    }
    projectId = safeProjectId;
  }

  const encoder = new TextEncoder();

  // Get the abort signal from the request
  const { signal } = request;

  const stream = new ReadableStream({
    start(controller) {
      let lastContents = getFileContents(projectId);

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
          const currentContents = getFileContents(projectId);

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

          // Check for changes in teammates.json
          if (currentContents.teammates !== lastContents.teammates) {
            const event = {
              type: 'teammates-update',
              data: currentContents.teammates,
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
