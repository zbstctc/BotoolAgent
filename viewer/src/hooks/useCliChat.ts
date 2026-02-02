import { useState, useCallback, useRef } from 'react';

export interface CliChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export type CliChatMode = 'prd' | 'convert' | 'default';

// Tool use types for tracking pending tool calls
export interface ToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface UseCliChatOptions {
  initialMessages?: CliChatMessage[];
  initialSessionId?: string;
  mode?: CliChatMode;
  onError?: (error: string) => void;
  onSessionIdChange?: (sessionId: string) => void;
  onToolUse?: (toolUse: ToolUse) => void;
}

export function useCliChat(options: UseCliChatOptions = {}) {
  const {
    initialMessages = [],
    initialSessionId,
    mode = 'default',
    onError,
    onSessionIdChange,
    onToolUse,
  } = options;

  const [messages, setMessages] = useState<CliChatMessage[]>(initialMessages);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | undefined>(initialSessionId);
  const [pendingToolUse, setPendingToolUse] = useState<ToolUse | null>(null);

  // Use ref to track abort controller for cancellation
  const abortControllerRef = useRef<AbortController | null>(null);
  // Track current assistant message ID for tool responses
  const currentAssistantMessageIdRef = useRef<string | null>(null);
  // Track if we received a tool_use in current stream (to prevent done from clearing it)
  const hasToolUseInStreamRef = useRef<boolean>(false);

  const sendMessage = useCallback(
    async (content: string) => {
      if (isLoading) return;

      const userMessage: CliChatMessage = {
        id: Date.now().toString(),
        role: 'user',
        content,
      };

      // Add user message to state
      setMessages((prev) => [...prev, userMessage]);
      setIsLoading(true);
      setError(null);

      // Create a placeholder for assistant message
      const assistantMessageId = (Date.now() + 1).toString();
      const assistantMessage: CliChatMessage = {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
      };
      setMessages((prev) => [...prev, assistantMessage]);

      // Create abort controller for this request
      abortControllerRef.current = new AbortController();
      // Reset tool use tracking for new stream
      hasToolUseInStreamRef.current = false;

      try {
        const response = await fetch('/api/cli/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: content,
            sessionId,
            mode,
          }),
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to send message');
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('No response stream');
        }

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');

          // Keep the last incomplete line in the buffer
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6).trim();
              if (!data) continue;

              try {
                const parsed = JSON.parse(data);

                if (parsed.type === 'text') {
                  // Append text to assistant message
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === assistantMessageId
                        ? { ...msg, content: msg.content + parsed.content }
                        : msg
                    )
                  );
                } else if (parsed.type === 'session') {
                  // Update session ID when received
                  if (parsed.sessionId) {
                    setSessionId(parsed.sessionId);
                    onSessionIdChange?.(parsed.sessionId);
                  }
                } else if (parsed.type === 'tool_use') {
                  // Handle tool use - set pending tool and notify callback
                  const toolUse: ToolUse = {
                    id: parsed.toolId,
                    name: parsed.toolName,
                    input: parsed.toolInput || {},
                  };
                  setPendingToolUse(toolUse);
                  hasToolUseInStreamRef.current = true;
                  currentAssistantMessageIdRef.current = assistantMessageId;
                  onToolUse?.(toolUse);
                } else if (parsed.type === 'error') {
                  throw new Error(parsed.error);
                } else if (parsed.type === 'done') {
                  // Stream finished
                  // DON'T clear pendingToolUse if we received a tool_use in this stream
                  // User needs to respond to the tool first
                  if (!hasToolUseInStreamRef.current) {
                    setPendingToolUse(null);
                    currentAssistantMessageIdRef.current = null;
                  }
                  break;
                }
              } catch (parseError) {
                if (
                  parseError instanceof Error &&
                  parseError.message !== 'Unexpected end of JSON input'
                ) {
                  // Re-throw actual errors (not JSON parse errors)
                  if (parseError.message !== 'Unexpected end of JSON input') {
                    throw parseError;
                  }
                }
              }
            }
          }
        }
      } catch (err) {
        // Handle abort separately
        if (err instanceof Error && err.name === 'AbortError') {
          // Request was cancelled, don't treat as error
          return;
        }

        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        setError(errorMessage);
        onError?.(errorMessage);

        // Remove the empty assistant message on error
        setMessages((prev) => prev.filter((msg) => msg.id !== assistantMessageId));
      } finally {
        setIsLoading(false);
        abortControllerRef.current = null;
      }
    },
    [isLoading, sessionId, mode, onError, onSessionIdChange, onToolUse]
  );

  const clearMessages = useCallback(() => {
    setMessages(initialMessages);
    setError(null);
  }, [initialMessages]);

  const resetSession = useCallback(() => {
    setMessages(initialMessages);
    setSessionId(undefined);
    setError(null);
  }, [initialMessages]);

  const cancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsLoading(false);
      setPendingToolUse(null);
    }
  }, []);

  /**
   * Respond to a pending tool call
   * @param toolId - The ID of the tool call to respond to
   * @param response - The response data (will be JSON stringified)
   */
  const respondToTool = useCallback(
    async (toolId: string, response: Record<string, unknown>) => {
      if (!sessionId) {
        const errorMessage = 'Cannot respond to tool: no active session';
        setError(errorMessage);
        onError?.(errorMessage);
        return;
      }

      if (!pendingToolUse || pendingToolUse.id !== toolId) {
        const errorMessage = 'Cannot respond to tool: tool ID mismatch or no pending tool';
        setError(errorMessage);
        onError?.(errorMessage);
        return;
      }

      // Clear the pending tool use
      setPendingToolUse(null);
      setError(null);

      // Get the current assistant message ID to continue appending
      const assistantMessageId =
        currentAssistantMessageIdRef.current || (Date.now() + 1).toString();

      // Create abort controller for this request
      abortControllerRef.current = new AbortController();

      try {
        const responseData = await fetch('/api/cli/respond', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sessionId,
            toolResponse: response,
            mode,
          }),
          signal: abortControllerRef.current.signal,
        });

        if (!responseData.ok) {
          const errorData = await responseData.json();
          throw new Error(errorData.error || 'Failed to send tool response');
        }

        const reader = responseData.body?.getReader();
        if (!reader) {
          throw new Error('No response stream');
        }

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');

          // Keep the last incomplete line in the buffer
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6).trim();
              if (!data) continue;

              try {
                const parsed = JSON.parse(data);

                if (parsed.type === 'text') {
                  // Append text to assistant message
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === assistantMessageId
                        ? { ...msg, content: msg.content + parsed.content }
                        : msg
                    )
                  );
                } else if (parsed.type === 'tool_use') {
                  // Another tool use - set pending tool and notify callback
                  const toolUse: ToolUse = {
                    id: parsed.toolId,
                    name: parsed.toolName,
                    input: parsed.toolInput || {},
                  };
                  setPendingToolUse(toolUse);
                  currentAssistantMessageIdRef.current = assistantMessageId;
                  onToolUse?.(toolUse);
                } else if (parsed.type === 'error') {
                  throw new Error(parsed.error);
                } else if (parsed.type === 'done') {
                  // Stream finished
                  setPendingToolUse(null);
                  currentAssistantMessageIdRef.current = null;
                  break;
                }
              } catch (parseError) {
                if (
                  parseError instanceof Error &&
                  parseError.message !== 'Unexpected end of JSON input'
                ) {
                  throw parseError;
                }
              }
            }
          }
        }
      } catch (err) {
        // Handle abort separately
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }

        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        setError(errorMessage);
        onError?.(errorMessage);
      } finally {
        setIsLoading(false);
        abortControllerRef.current = null;
      }
    },
    [sessionId, pendingToolUse, mode, onError, onToolUse]
  );

  return {
    messages,
    isLoading,
    error,
    sessionId,
    pendingToolUse,
    sendMessage,
    clearMessages,
    resetSession,
    setMessages,
    setSessionId,
    cancel,
    respondToTool,
  };
}
