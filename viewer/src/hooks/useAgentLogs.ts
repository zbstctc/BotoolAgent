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
  // Track the previous snapshot to compute truly new lines via overlap detection.
  // Content-based Set deduplication would silently drop repeated lines (e.g. the
  // same command run twice), so we instead find the longest suffix of the previous
  // snapshot that matches a prefix of the new snapshot and only append the remainder.
  const lastSnapshotRef = useRef<string[]>([]);
  // Monotonically increasing request id. Each fetch captures its own id; if a newer
  // request has been dispatched by the time this response arrives, discard the stale
  // result to prevent out-of-order snapshot merging.
  const pendingReqIdRef = useRef(0);

  const reset = useCallback(() => {
    setLines([]);
    setAlive(false);
    lastSnapshotRef.current = [];
    pendingReqIdRef.current = 0;
  }, []);

  useEffect(() => {
    if (!enabled || !projectId) {
      return;
    }

    const fetchLogs = async () => {
      const myId = ++pendingReqIdRef.current;
      try {
        const response = await fetch(
          `/api/agent/logs?projectId=${encodeURIComponent(projectId)}`
        );
        if (!response.ok) return;

        const data: AgentLogsResponse = await response.json();

        // Discard if a newer request has already been dispatched
        if (myId < pendingReqIdRef.current) return;

        setAlive(data.alive);

        if (data.lines.length > 0) {
          const newSnapshot = data.lines;
          const prevSnapshot = lastSnapshotRef.current;

          // Find the longest suffix of prevSnapshot that is a prefix of newSnapshot.
          // This tells us how many lines the two snapshots share (i.e. already shown).
          let overlapLen = 0;
          const maxOverlap = Math.min(prevSnapshot.length, newSnapshot.length);
          for (let len = maxOverlap; len > 0; len--) {
            const match = prevSnapshot
              .slice(prevSnapshot.length - len)
              .every((l, i) => l === newSnapshot[i]);
            if (match) {
              overlapLen = len;
              break;
            }
          }

          const newLines = newSnapshot.slice(overlapLen);
          lastSnapshotRef.current = newSnapshot;

          if (newLines.length > 0) {
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
