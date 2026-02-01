'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

export type AgentStatusType =
  | 'idle'
  | 'running'
  | 'waiting_network'
  | 'timeout'
  | 'error'
  | 'failed'
  | 'complete'
  | 'iteration_complete'
  | 'max_iterations';

export interface AgentStatus {
  status: AgentStatusType;
  message: string;
  timestamp: string;
  iteration: number;
  maxIterations: number;
  completed: number;
  total: number;
  currentTask: string;
  retryCount: number;
}

interface StatusEvent {
  type: 'status';
  data: AgentStatus;
  timestamp: number;
}

interface UseAgentStatusState {
  status: AgentStatus | null;
  isConnected: boolean;
  lastUpdated: number | null;
  error: string | null;
}

interface UseAgentStatusOptions {
  enabled?: boolean;
  stream?: boolean;
  pollInterval?: number;
  onStatusChange?: (status: AgentStatus) => void;
}

const DEFAULT_STATUS: AgentStatus = {
  status: 'idle',
  message: 'Agent not running',
  timestamp: new Date().toISOString(),
  iteration: 0,
  maxIterations: 0,
  completed: 0,
  total: 0,
  currentTask: 'none',
  retryCount: 0,
};

export function useAgentStatus(options: UseAgentStatusOptions = {}) {
  const {
    enabled = true,
    stream = true,
    pollInterval = 2000,
    onStatusChange,
  } = options;

  const [state, setState] = useState<UseAgentStatusState>({
    status: null,
    isConnected: false,
    lastUpdated: null,
    error: null,
  });

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const shouldReconnectRef = useRef(true);
  const onStatusChangeRef = useRef(onStatusChange);

  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

  // Fetch status via polling (non-streaming mode)
  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/agent/status');
      if (!response.ok) throw new Error('Failed to fetch status');

      const data: AgentStatus = await response.json();
      setState(prev => {
        if (JSON.stringify(prev.status) !== JSON.stringify(data)) {
          onStatusChangeRef.current?.(data);
        }
        return {
          ...prev,
          status: data,
          lastUpdated: Date.now(),
          error: null,
        };
      });
    } catch (err) {
      setState(prev => ({
        ...prev,
        error: err instanceof Error ? err.message : 'Failed to fetch status',
      }));
    }
  }, []);

  // Schedule reconnect for streaming mode
  const scheduleReconnect = useCallback(() => {
    if (!shouldReconnectRef.current) return;

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    reconnectTimeoutRef.current = setTimeout(() => {
      setState(prev => ({ ...prev, error: 'reconnecting' }));
    }, 5000);
  }, []);

  // Disconnect function
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
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
    setState(prev => ({ ...prev, isConnected: false }));
  }, []);

  // Streaming mode effect
  useEffect(() => {
    if (!enabled || !stream) return;

    shouldReconnectRef.current = true;

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const eventSource = new EventSource('/api/agent/status?stream=true');
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setState(prev => ({ ...prev, isConnected: true, error: null }));
    };

    eventSource.onmessage = (event) => {
      try {
        const parsed: StatusEvent = JSON.parse(event.data);

        if (parsed.type === 'status') {
          setState(prev => {
            if (JSON.stringify(prev.status) !== JSON.stringify(parsed.data)) {
              onStatusChangeRef.current?.(parsed.data);
            }
            return {
              ...prev,
              status: parsed.data,
              lastUpdated: parsed.timestamp,
            };
          });
        }
      } catch {
        // Ignore parse errors (heartbeat comments)
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
  }, [enabled, stream, scheduleReconnect, state.error]);

  // Polling mode effect
  useEffect(() => {
    if (!enabled || stream) return;

    const poll = async () => {
      await fetchStatus();
      if (shouldReconnectRef.current) {
        pollTimeoutRef.current = setTimeout(poll, pollInterval);
      }
    };

    shouldReconnectRef.current = true;
    poll();

    return () => {
      shouldReconnectRef.current = false;
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current);
      }
    };
  }, [enabled, stream, pollInterval, fetchStatus]);

  // Reconnect function
  const reconnect = useCallback(() => {
    shouldReconnectRef.current = true;
    setState(prev => ({ ...prev, error: 'manual-reconnect' }));
  }, []);

  // Start agent
  const startAgent = useCallback(async (maxIterations: number = 10) => {
    try {
      const response = await fetch('/api/agent/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxIterations }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to start agent');
      }

      return await response.json();
    } catch (err) {
      setState(prev => ({
        ...prev,
        error: err instanceof Error ? err.message : 'Failed to start agent',
      }));
      throw err;
    }
  }, []);

  // Stop agent
  const stopAgent = useCallback(async () => {
    try {
      const response = await fetch('/api/agent/status', {
        method: 'DELETE',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to stop agent');
      }

      const result = await response.json();

      // Refresh status
      await fetchStatus();

      return result;
    } catch (err) {
      setState(prev => ({
        ...prev,
        error: err instanceof Error ? err.message : 'Failed to stop agent',
      }));
      throw err;
    }
  }, [fetchStatus]);

  // Helper to check if agent is actively running
  const isRunning = state.status?.status === 'running' ||
    state.status?.status === 'waiting_network' ||
    state.status?.status === 'iteration_complete';

  // Helper to check if agent completed
  const isComplete = state.status?.status === 'complete';

  // Helper to check if agent has errors
  const hasError = state.status?.status === 'error' ||
    state.status?.status === 'failed' ||
    state.status?.status === 'timeout' ||
    state.status?.status === 'max_iterations';

  // Progress percentage
  const progressPercent = state.status?.total
    ? Math.round((state.status.completed / state.status.total) * 100)
    : 0;

  return {
    ...state,
    status: state.status || DEFAULT_STATUS,
    isRunning,
    isComplete,
    hasError,
    progressPercent,
    reconnect,
    disconnect,
    startAgent,
    stopAgent,
    refresh: fetchStatus,
  };
}
