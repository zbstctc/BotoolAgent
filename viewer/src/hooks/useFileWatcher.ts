'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

interface WatchEvent {
  type: 'initial' | 'prd-update' | 'progress-update';
  data: string | { prd: string | null; progress: string | null } | null;
  timestamp: number;
}

interface FileWatcherState {
  prd: string | null;
  progress: string | null;
  isConnected: boolean;
  lastUpdated: number | null;
  error: string | null;
}

interface UseFileWatcherOptions {
  projectId?: string | null;
  enabled?: boolean;
  onPrdUpdate?: (content: string | null) => void;
  onProgressUpdate?: (content: string | null) => void;
}

export function useFileWatcher(options: UseFileWatcherOptions = {}) {
  const { projectId, enabled = true, onPrdUpdate, onProgressUpdate } = options;

  const [state, setState] = useState<FileWatcherState>({
    prd: null,
    progress: null,
    isConnected: false,
    lastUpdated: null,
    error: null,
  });

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const shouldReconnectRef = useRef(true);

  // Store callbacks in refs to avoid dependency issues
  const onPrdUpdateRef = useRef(onPrdUpdate);
  const onProgressUpdateRef = useRef(onProgressUpdate);

  useEffect(() => {
    onPrdUpdateRef.current = onPrdUpdate;
    onProgressUpdateRef.current = onProgressUpdate;
  }, [onPrdUpdate, onProgressUpdate]);

  const scheduleReconnect = useCallback(() => {
    if (!shouldReconnectRef.current) return;

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    // Schedule reconnect - will trigger via state change
    reconnectTimeoutRef.current = setTimeout(() => {
      setState(prev => ({ ...prev, error: 'reconnecting' }));
    }, 5000);
  }, []);

  const disconnect = useCallback(() => {
    shouldReconnectRef.current = false;
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    setState(prev => ({ ...prev, isConnected: false }));
  }, []);

  // Main connection effect
  useEffect(() => {
    if (!enabled) return;

    shouldReconnectRef.current = true;

    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const watchUrl = projectId ? `/api/watch?projectId=${encodeURIComponent(projectId)}` : '/api/watch';
    const eventSource = new EventSource(watchUrl);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setState(prev => ({ ...prev, isConnected: true, error: null }));
    };

    eventSource.onmessage = (event) => {
      try {
        const parsed: WatchEvent = JSON.parse(event.data);

        switch (parsed.type) {
          case 'initial': {
            const data = parsed.data as { prd: string | null; progress: string | null };
            setState(prev => ({
              ...prev,
              prd: data.prd,
              progress: data.progress,
              lastUpdated: parsed.timestamp,
            }));
            break;
          }
          case 'prd-update': {
            const content = parsed.data as string | null;
            setState(prev => ({
              ...prev,
              prd: content,
              lastUpdated: parsed.timestamp,
            }));
            onPrdUpdateRef.current?.(content);
            break;
          }
          case 'progress-update': {
            const content = parsed.data as string | null;
            setState(prev => ({
              ...prev,
              progress: content,
              lastUpdated: parsed.timestamp,
            }));
            onProgressUpdateRef.current?.(content);
            break;
          }
        }
      } catch {
        // Ignore parse errors (e.g., heartbeat comments)
      }
    };

    eventSource.onerror = () => {
      setState(prev => ({ ...prev, isConnected: false }));
      eventSource.close();
      scheduleReconnect();
    };

    return () => {
      eventSource.close();
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [enabled, projectId, scheduleReconnect, state.error]); // state.error triggers reconnect

  const reconnect = useCallback(() => {
    shouldReconnectRef.current = true;
    setState(prev => ({ ...prev, error: 'manual-reconnect' }));
  }, []);

  return {
    ...state,
    reconnect,
    disconnect,
  };
}

// Typed JSON parsing utilities
export function parsePrdJson(content: string | null): PrdData | null {
  if (!content) return null;
  try {
    return JSON.parse(content) as PrdData;
  } catch {
    return null;
  }
}

export interface TestCase {
  type: 'typecheck' | 'lint' | 'unit' | 'e2e' | 'manual';
  desc?: string;
  tdd?: boolean;
}

export interface DevTask {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  priority: number;
  passes: boolean;
  notes: string;
  testCases?: TestCase[];
}

export interface PrdData {
  project: string;
  branchName: string;
  description: string;
  devTasks: DevTask[];
}
