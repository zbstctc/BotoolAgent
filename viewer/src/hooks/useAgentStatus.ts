'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

export type AgentStatusType =
  | 'idle'
  | 'running'
  | 'starting'
  | 'waiting_network'
  | 'timeout'
  | 'error'
  | 'failed'
  | 'stopped'
  | 'complete'
  | 'iteration_complete'
  | 'session_done'
  | 'max_iterations'
  | 'max_rounds';

export interface RateLimitInfo {
  enabled: boolean;
  calls: number;
  maxCalls: number;
  windowRemaining: number;
}

export interface CircuitBreakerInfo {
  enabled: boolean;
  noProgressCount: number;
  threshold: number;
  lastCompletedCount: number;
}

export interface ApiRateLimitInfo {
  waiting: boolean;
  resetAt: number;
  remainingSeconds: number;
}

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
  rateLimit?: RateLimitInfo;
  circuitBreaker?: CircuitBreakerInfo;
  apiRateLimit?: ApiRateLimitInfo;
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
  projectId?: string | null;
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
    projectId,
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
      const statusUrl = projectId ? `/api/agent/status?projectId=${encodeURIComponent(projectId)}` : '/api/agent/status';
      const response = await fetch(statusUrl);
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
  }, [projectId]);

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

    const streamUrl = projectId
      ? `/api/agent/status?stream=true&projectId=${encodeURIComponent(projectId)}`
      : '/api/agent/status?stream=true';
    const eventSource = new EventSource(streamUrl);
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
  }, [enabled, stream, projectId, scheduleReconnect, state.error]);

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
  }, [enabled, stream, projectId, pollInterval, fetchStatus]);

  // Reconnect function
  const reconnect = useCallback(() => {
    shouldReconnectRef.current = true;
    setState(prev => ({ ...prev, error: 'manual-reconnect' }));
  }, []);

  // Start agent
  const startAgent = useCallback(async (maxIterations?: number, mode: 'teams' | 'testing' = 'teams') => {
    try {
      const response = await fetch('/api/agent/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, projectId, maxIterations }),
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
  }, [projectId]);

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
    state.status?.status === 'starting' ||
    state.status?.status === 'waiting_network' ||
    state.status?.status === 'iteration_complete' ||
    state.status?.status === 'session_done';

  // Helper to check if agent completed
  const isComplete = state.status?.status === 'complete';

  // Helper to check if agent has errors
  const hasError = state.status?.status === 'error' ||
    state.status?.status === 'failed' ||
    state.status?.status === 'stopped' ||
    state.status?.status === 'timeout' ||
    state.status?.status === 'max_iterations' ||
    state.status?.status === 'max_rounds';

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
