'use client';

import { useEffect, useRef } from 'react';

export interface AgentActivityFeedProps {
  lines: string[];
  alive: boolean;
}

export function AgentActivityFeed({ lines, alive }: AgentActivityFeedProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  const displayLines = lines.slice(-15);

  return (
    <div className="bg-neutral-900 rounded-lg overflow-hidden flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-neutral-800">
        {alive && (
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
        )}
        <span className="text-neutral-300 text-xs font-medium">
          代理活动 · 实时
        </span>
      </div>

      {/* Content */}
      <div className="font-mono text-xs overflow-y-auto flex-1 p-3 space-y-0.5">
        {displayLines.length > 0 ? (
          <>
            {displayLines.map((line, i) => (
              <div key={`${lines.length}-${i}`} className="leading-5">
                <span className="text-neutral-500">$ </span>
                <span className="text-neutral-200">{line}</span>
              </div>
            ))}
            <div ref={bottomRef} />
          </>
        ) : alive ? (
          <div className="text-neutral-500 text-xs">等待代理输出...</div>
        ) : (
          <div className="text-neutral-600 text-xs">代理未运行</div>
        )}
      </div>
    </div>
  );
}
