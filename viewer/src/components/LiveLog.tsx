'use client';

import { useEffect, useRef } from 'react';

interface LiveLogProps {
  progressLog: string;
  maxLines?: number;
}

export default function LiveLog({ progressLog, maxLines = 5 }: LiveLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const lines = progressLog
    .split('\n')
    .filter((line) => line.trim() !== '')
    .slice(-maxLines);

  // Auto-scroll to bottom when lines change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines.length, progressLog]);

  return (
    <div>
      <span className="text-xs text-neutral-400">实时活动</span>
      <div
        ref={scrollRef}
        className="mt-1.5 rounded-lg bg-neutral-900 p-3 font-mono text-xs text-neutral-300 overflow-y-auto"
        style={{ height: 120 }}
      >
        {lines.length > 0 ? (
          lines.map((line, i) => (
            <div key={`${i}-${line.slice(0, 20)}`} className="leading-5">
              <span className="text-neutral-500 select-none">{'> '}</span>
              {line}
            </div>
          ))
        ) : (
          <div className="text-neutral-600 leading-5">等待日志输出...</div>
        )}
      </div>
    </div>
  );
}
