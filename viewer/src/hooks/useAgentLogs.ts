'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface UseAgentLogsOptions {
  projectId: string;
  enabled: boolean;
}

interface AgentLogsResponse {
  lines: string[];
  sessionName: string;
  alive: boolean;
}

export function useAgentLogs({ projectId, enabled }: UseAgentLogsOptions) {
  const [lines, setLines] = useState<string[]>([]);
  const [alive, setAlive] = useState(false);
  const isPolling = enabled && !!projectId;
  const seenRef = useRef<Set<string>>(new Set());

  const reset = useCallback(() => {
    setLines([]);
    setAlive(false);
    seenRef.current = new Set();
  }, []);

  useEffect(() => {
    if (!enabled || !projectId) {
      return;
    }

    const fetchLogs = async () => {
      try {
        const response = await fetch(
          `/api/agent/logs?projectId=${encodeURIComponent(projectId)}`
        );
        if (!response.ok) return;

        const data: AgentLogsResponse = await response.json();
        setAlive(data.alive);

        if (data.lines.length > 0) {
          const newLines = data.lines.filter(
            (line) => !seenRef.current.has(line)
          );
          if (newLines.length > 0) {
            for (const line of newLines) {
              seenRef.current.add(line);
            }
            setLines((prev) => [...prev, ...newLines].slice(-50));
          }
        }
      } catch {
        // Silently ignore fetch errors
      }
    };

    fetchLogs();
    const intervalId = setInterval(fetchLogs, 3000);

    return () => {
      clearInterval(intervalId);
    };
  }, [enabled, projectId]);

  return { lines, alive, isPolling, reset };
}
