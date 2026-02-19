import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { getTasksDir, normalizeProjectId } from '@/lib/project-root';

/**
 * Parse a single stream-json line into human-readable text.
 * Returns null if the line should be skipped.
 */
function parseStreamJsonLine(line: string): string | null {
  if (!line.trim()) return null;
  try {
    const evt = JSON.parse(line);
    if (evt.type === 'assistant' && evt.message?.content) {
      const parts: string[] = [];
      for (const block of evt.message.content) {
        if (block.type === 'text' && block.text) {
          parts.push(block.text);
        } else if (block.type === 'tool_use') {
          parts.push(`[tool] ${block.name}: ${JSON.stringify(block.input).slice(0, 200)}`);
        }
      }
      return parts.length > 0 ? parts.join('\n') : null;
    }
    if (evt.type === 'result') {
      return `\n[result] cost: $${evt.cost_usd?.toFixed(4) || '?'}, duration: ${evt.duration_ms || '?'}ms`;
    }
    // Skip other event types (system, content_block_start, etc.)
    return null;
  } catch {
    // Not valid JSON — return raw line (stderr output, etc.)
    return line;
  }
}

/**
 * GET /api/agent/log?projectId=xxx&offset=0
 *
 * Reads the stream-json testing log, parses it into human-readable lines,
 * and returns them with the current byte offset for efficient polling.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const rawProjectId = url.searchParams.get('projectId');
  const projectId = normalizeProjectId(rawProjectId);
  const byteOffset = parseInt(url.searchParams.get('offset') || '0', 10);

  if (!projectId) {
    return NextResponse.json({ error: 'projectId required' }, { status: 400 });
  }

  const tasksDir = getTasksDir();
  const logFile = path.join(tasksDir, projectId, 'agent-testing.log');

  if (!fs.existsSync(logFile)) {
    return NextResponse.json({ lines: [], offset: 0 });
  }

  try {
    const stat = fs.statSync(logFile);
    const fileSize = stat.size;

    // No new data since last poll
    if (byteOffset >= fileSize) {
      return NextResponse.json({ lines: [], offset: byteOffset });
    }

    // Read only the new bytes
    const fd = fs.openSync(logFile, 'r');
    const bufSize = Math.min(fileSize - byteOffset, 256 * 1024); // max 256KB per poll
    const buf = Buffer.alloc(bufSize);
    fs.readSync(fd, buf, 0, bufSize, byteOffset);
    fs.closeSync(fd);

    const chunk = buf.toString('utf-8');
    const rawLines = chunk.split('\n');

    // Parse each line from stream-json to human-readable
    const parsed: string[] = [];
    for (const raw of rawLines) {
      const result = parseStreamJsonLine(raw);
      if (result) {
        parsed.push(result);
      }
    }

    return NextResponse.json({
      lines: parsed,
      offset: byteOffset + bufSize,
    });
  } catch (error) {
    console.error('[/api/agent/log] Error:', error);
    return NextResponse.json({ error: 'Failed to read log' }, { status: 500 });
  }
}
