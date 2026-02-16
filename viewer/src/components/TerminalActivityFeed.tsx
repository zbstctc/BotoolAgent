'use client';

/** Terminal activity feed with 5-line scrolling fade effect */
export function TerminalActivityFeed({ lines }: { lines: string[] }) {
  // Always show 5 lines; take the last 5 from the log
  const display = lines.length >= 5
    ? lines.slice(-5)
    : [...Array(5 - lines.length).fill(''), ...lines];

  // Symmetric opacity: edges faded, center brightest
  const opacities = [0.15, 0.35, 0.7, 0.35, 0.15];

  if (lines.length === 0) return null;

  return (
    <div className="mt-5 w-72 font-mono text-xs leading-6 select-none overflow-hidden">
      {display.map((line, i) => (
        <div
          key={`${lines.length}-${i}`}
          className="truncate text-neutral-500 h-6 transition-opacity duration-300"
          style={{ opacity: line ? opacities[i] : 0 }}
        >
          {line && (
            <>
              <span className="text-neutral-400 mr-1.5">$</span>
              {line}
            </>
          )}
        </div>
      ))}
    </div>
  );
}

/** Generate a terminal-like log line from a tool call */
export function formatTerminalLine(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case 'Read': {
      const fp = typeof input?.file_path === 'string' ? input.file_path : '';
      const short = fp.split('/').slice(-2).join('/');
      return short ? `cat ${short}` : 'reading file...';
    }
    case 'Glob': {
      const pattern = typeof input?.pattern === 'string' ? input.pattern : '*';
      return `find . -name "${pattern}"`;
    }
    case 'Grep': {
      const pat = typeof input?.pattern === 'string' ? input.pattern : '...';
      return `grep -r "${pat.slice(0, 30)}" ./`;
    }
    case 'Bash': {
      const cmd = typeof input?.command === 'string' ? input.command : '';
      return cmd.slice(0, 60) || 'exec shell...';
    }
    case 'Write': {
      const fp = typeof input?.file_path === 'string' ? input.file_path : '';
      const short = fp.split('/').slice(-2).join('/');
      return short ? `write > ${short}` : 'writing file...';
    }
    case 'Task':
      return 'spawning sub-agent...';
    case 'Skill': {
      const name = typeof input?.skill === 'string' ? input.skill : '';
      return name ? `loading skill: ${name}` : 'loading skill...';
    }
    case 'TodoWrite':
      return 'updating progress tracker...';
    case 'Edit': {
      const fp = typeof input?.file_path === 'string' ? input.file_path : '';
      const short = fp.split('/').slice(-2).join('/');
      return short ? `patch ${short}` : 'editing file...';
    }
    default:
      return `${toolName.toLowerCase()}...`;
  }
}
