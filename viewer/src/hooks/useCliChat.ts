import { useState, useCallback, useRef } from 'react';

export interface CliChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export type CliChatMode = 'prd' | 'convert' | 'default';

interface UseCliChatOptions {
  initialMessages?: CliChatMessage[];
  initialSessionId?: string;
  mode?: CliChatMode;
  onError?: (error: string) => void;
  onSessionIdChange?: (sessionId: string) => void;
}

export function useCliChat(options: UseCliChatOptions = {}) {
  const {
    initialMessages = [],
    initialSessionId,
    mode = 'default',
    onError,
    onSessionIdChange,
  } = options;

  const [messages, setMessages] = useState<CliChatMessage[]>(initialMessages);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | undefined>(initialSessionId);

  // Use ref to track abort controller for cancellation
  const abortControllerRef = useRef<AbortController | null>(null);

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
                } else if (parsed.type === 'error') {
                  throw new Error(parsed.error);
                } else if (parsed.type === 'done') {
                  // Stream finished
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
    [isLoading, sessionId, mode, onError, onSessionIdChange]
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
    }
  }, []);

  return {
    messages,
    isLoading,
    error,
    sessionId,
    sendMessage,
    clearMessages,
    resetSession,
    setMessages,
    setSessionId,
    cancel,
  };
}
