import { useEffect, useRef } from 'react';

/** Rotating activity messages for terminal feed */
const ACTIVITY_MESSAGES = [
  'analyzing PRD structure...',
  'identifying dev tasks...',
  'generating code examples...',
  'generating test cases...',
  'analyzing file dependencies...',
  'generating eval commands...',
  'analyzing task dependencies...',
  'planning session groups...',
  'organizing output...',
  'processing requirements...',
  'scanning codebase patterns...',
  'mapping component relations...',
  'evaluating complexity...',
  'checking type constraints...',
  'resolving import paths...',
];

interface UseSimulatedProgressOptions {
  /** Whether simulation is active */
  isActive: boolean;
  /** Current real progress from SSE */
  realProgress: number;
  /** Set the displayed progress */
  setProgress: (fn: (prev: number) => number) => void;
  /** Set the displayed message */
  setMessage: (msg: string) => void;
  /** Append a terminal line */
  addTerminalLine: (line: string) => void;
  /** Max simulated progress (won't go beyond this) */
  maxProgress?: number;
}

/**
 * Simulates gradual progress + rotating terminal messages
 * when backend is working but not sending frequent updates.
 *
 * Progress speed slows as it approaches maxProgress:
 * - 0–30%: ~1.5% per tick (fast start)
 * - 30–60%: ~0.8% per tick (medium)
 * - 60–max%: ~0.3% per tick (slow crawl)
 *
 * Terminal lines rotate every ~3 seconds.
 */
export function useSimulatedProgress({
  isActive,
  realProgress,
  setProgress,
  setMessage,
  addTerminalLine,
  maxProgress = 92,
}: UseSimulatedProgressOptions) {
  const msgIndexRef = useRef(0);
  const tickRef = useRef(0);

  useEffect(() => {
    if (!isActive) {
      tickRef.current = 0;
      return;
    }

    const interval = setInterval(() => {
      tickRef.current++;

      // Increment progress with diminishing speed
      setProgress((prev) => {
        if (prev >= maxProgress) return prev;

        let increment: number;
        if (prev < 30) {
          increment = 1.2 + Math.random() * 0.6; // ~1.2–1.8
        } else if (prev < 60) {
          increment = 0.5 + Math.random() * 0.5; // ~0.5–1.0
        } else {
          increment = 0.15 + Math.random() * 0.25; // ~0.15–0.4
        }

        return Math.min(prev + increment, maxProgress);
      });

      // Rotate terminal messages every ~3 ticks (3s)
      if (tickRef.current % 3 === 0) {
        const msg = ACTIVITY_MESSAGES[msgIndexRef.current % ACTIVITY_MESSAGES.length];
        msgIndexRef.current++;
        addTerminalLine(msg);
      }

      // Update displayed message every ~5 ticks
      if (tickRef.current % 5 === 0) {
        const displayMessages = [
          '正在分析 PRD 结构...',
          '正在识别开发任务...',
          '正在生成代码示例...',
          '正在生成测试用例...',
          '正在分析文件依赖...',
          '正在生成验证命令...',
          '正在分析任务依赖关系...',
          '正在规划 Session 分组...',
          '正在整理输出结果...',
        ];
        const idx = Math.floor(tickRef.current / 5) % displayMessages.length;
        setMessage(displayMessages[idx]);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isActive, maxProgress, setProgress, setMessage, addTerminalLine]);

  // When real progress jumps ahead, make sure simulated catches up
  useEffect(() => {
    if (realProgress > 0) {
      setProgress((prev) => Math.max(prev, realProgress));
    }
  }, [realProgress, setProgress]);
}
