import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { normalizeProjectId } from '@/lib/project-root';
import { formatTerminalLine } from '@/components/TerminalActivityFeed';

const execFileAsync = promisify(execFile);

/** Strip ANSI escape codes from terminal output */
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*[mGKHF]/g, '');
}

/**
 * Try to detect and format known tool-call patterns in raw terminal lines.
 * Falls back to returning the original line for unknown formats.
 */
function formatLine(line: string): string {
  // Detect patterns like "⏳ Read file_path" or "Tool: Read { file_path: ... }"
  const toolMatch = line.match(/^[⏳✅❌\s]*(\w+)\s+(.+)/);
  if (toolMatch) {
    const [, toolName, rest] = toolMatch;
    const knownTools = ['Read', 'Glob', 'Grep', 'Bash', 'Write', 'Task', 'Skill', 'TodoWrite', 'Edit'];
    if (knownTools.includes(toolName)) {
      return formatTerminalLine(toolName, { file_path: rest, command: rest, pattern: rest, skill: rest });
    }
  }
  return line;
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const rawProjectId = url.searchParams.get('projectId');

    if (!rawProjectId) {
      return NextResponse.json(
        { error: 'Missing projectId parameter' },
        { status: 400 }
      );
    }

    const projectId = normalizeProjectId(rawProjectId);
    if (!projectId) {
      return NextResponse.json(
        { error: 'Invalid projectId parameter' },
        { status: 400 }
      );
    }

    const sessionName = `botool-teams-${projectId}`;

    // Check if tmux session exists
    let alive = false;
    try {
      await execFileAsync('tmux', ['has-session', '-t', sessionName]);
      alive = true;
    } catch {
      // Session does not exist
      return NextResponse.json({ lines: [], sessionName, alive: false });
    }

    // Capture tmux pane output
    let lines: string[] = [];
    try {
      const { stdout } = await execFileAsync('tmux', [
        'capture-pane', '-t', sessionName, '-p', '-S', '-40',
      ]);

      lines = stdout
        .split('\n')
        .map(line => stripAnsi(line))
        .filter(line => line.trim() !== '')
        .map(line => formatLine(line));
    } catch {
      // capture-pane failed, return empty
      return NextResponse.json({ lines: [], sessionName, alive });
    }

    return NextResponse.json({ lines, sessionName, alive });
  } catch (error) {
    console.error('Failed to fetch agent logs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch agent logs' },
      { status: 500 }
    );
  }
}
