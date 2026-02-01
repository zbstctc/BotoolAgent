import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

export interface CLIMessage {
  type: 'text' | 'done' | 'error' | 'session' | 'tool_use' | 'tool_result';
  content?: string;
  sessionId?: string;
  error?: string;
  toolId?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
}

// AskUserQuestion tool specific types
export interface AskUserQuestionOption {
  label: string;
  description?: string;
}

export interface AskUserQuestion {
  question: string;
  header?: string;
  options: AskUserQuestionOption[];
  multiSelect?: boolean;
}

export interface AskUserQuestionToolInput {
  questions: AskUserQuestion[];
  [key: string]: unknown; // Index signature for compatibility with Record<string, unknown>
}

// Type guard to check if tool input is AskUserQuestion
export function isAskUserQuestionInput(
  input: Record<string, unknown>
): input is AskUserQuestionToolInput {
  return (
    Array.isArray(input.questions) &&
    input.questions.length > 0 &&
    input.questions.every(
      (q: unknown) =>
        typeof q === 'object' &&
        q !== null &&
        'question' in q &&
        'options' in q &&
        Array.isArray((q as AskUserQuestion).options)
    )
  );
}

export interface CLISession {
  process: ChildProcess;
  sessionId: string | null;
  isActive: boolean;
}

interface StreamJSONEvent {
  type: string;
  session_id?: string;
  index?: number;
  message?: {
    content?: Array<{
      type: string;
      text?: string;
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
    }>;
  };
  content_block?: {
    type: string;
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
  };
  delta?: {
    type: string;
    text?: string;
    partial_json?: string;
  };
  error?: {
    message?: string;
  };
  result?: {
    content?: Array<{
      type: string;
      text?: string;
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
    }>;
  };
}

// Track pending tool_use blocks during streaming
interface PendingToolUse {
  id: string;
  name: string;
  inputJson: string;
}

export class CLIManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private sessionId: string | null = null;
  private isActive: boolean = false;
  private outputBuffer: string = '';
  private readonly cliPath: string;
  private readonly workingDir: string;
  private timeoutId: NodeJS.Timeout | null = null;
  private readonly defaultTimeout: number = 300000; // 5 minutes default
  // Track pending tool_use blocks by index during streaming
  private pendingToolUses: Map<number, PendingToolUse> = new Map();

  constructor(options: { cliPath?: string; workingDir?: string } = {}) {
    super();
    this.cliPath = options.cliPath || 'claude';
    this.workingDir = options.workingDir || process.cwd();
  }

  /**
   * Start a new CLI session or resume an existing one
   */
  async start(options: {
    sessionId?: string;
    systemPrompt?: string;
    timeout?: number;
  } = {}): Promise<void> {
    if (this.isActive) {
      throw new Error('CLI session is already active');
    }

    const args = ['--print', '--verbose', '--output-format', 'stream-json'];

    // Resume existing session if sessionId provided
    if (options.sessionId) {
      args.push('--resume', options.sessionId);
      this.sessionId = options.sessionId;
    }

    this.process = spawn(this.cliPath, args, {
      cwd: this.workingDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // Disable interactive prompts
        CLAUDE_CODE_NON_INTERACTIVE: '1',
      },
    });

    this.isActive = true;
    this.outputBuffer = '';

    // Set up timeout
    const timeout = options.timeout ?? this.defaultTimeout;
    this.resetTimeout(timeout);

    // Handle stdout
    this.process.stdout?.on('data', (data: Buffer) => {
      this.handleOutput(data.toString());
    });

    // Handle stderr
    this.process.stderr?.on('data', (data: Buffer) => {
      console.error('[CLI stderr]:', data.toString());
    });

    // Handle process exit
    this.process.on('exit', (code, signal) => {
      this.clearTimeout();
      this.isActive = false;
      if (code !== 0 && code !== null) {
        this.emit('message', {
          type: 'error',
          error: `CLI process exited with code ${code}`,
        } as CLIMessage);
      }
      this.emit('exit', { code, signal });
    });

    // Handle process error
    this.process.on('error', (error) => {
      this.clearTimeout();
      this.isActive = false;
      this.emit('message', {
        type: 'error',
        error: error.message,
      } as CLIMessage);
      this.emit('error', error);
    });
  }

  /**
   * Send a message to the CLI process
   */
  async sendMessage(content: string): Promise<void> {
    if (!this.process || !this.isActive) {
      throw new Error('CLI session is not active');
    }

    if (!this.process.stdin?.writable) {
      throw new Error('CLI stdin is not writable');
    }

    // Reset timeout on each message
    this.resetTimeout(this.defaultTimeout);

    // Write message to stdin and close it to signal end of input
    this.process.stdin.write(content);
    this.process.stdin.end();
  }

  /**
   * Stop the CLI process
   */
  async stop(): Promise<void> {
    this.clearTimeout();

    if (this.process) {
      this.process.kill('SIGTERM');

      // Force kill after 5 seconds if still running
      setTimeout(() => {
        if (this.process && this.isActive) {
          this.process.kill('SIGKILL');
        }
      }, 5000);
    }

    this.isActive = false;
    this.process = null;
  }

  /**
   * Get the current session ID
   */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Check if the session is active
   */
  isSessionActive(): boolean {
    return this.isActive;
  }

  /**
   * Handle output from the CLI process
   */
  private handleOutput(data: string): void {
    this.outputBuffer += data;

    // Process complete JSON lines
    const lines = this.outputBuffer.split('\n');
    this.outputBuffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const event = JSON.parse(line) as StreamJSONEvent;
        this.processEvent(event);
      } catch {
        // Not valid JSON, might be plain text output
        this.emit('message', {
          type: 'text',
          content: line,
        } as CLIMessage);
      }
    }
  }

  /**
   * Process a stream-json event from the CLI
   */
  private processEvent(event: StreamJSONEvent): void {
    switch (event.type) {
      case 'system':
        // System event, may contain session_id
        if (event.session_id) {
          this.sessionId = event.session_id;
          this.emit('message', {
            type: 'session',
            sessionId: event.session_id,
          } as CLIMessage);
        }
        break;

      case 'assistant':
        // Complete assistant message
        if (event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === 'text' && block.text) {
              this.emit('message', {
                type: 'text',
                content: block.text,
              } as CLIMessage);
            } else if (block.type === 'tool_use') {
              this.emit('message', {
                type: 'tool_use',
                toolId: block.id,
                toolName: block.name,
                toolInput: block.input,
              } as CLIMessage);
            }
          }
        }
        break;

      case 'content_block_start':
        // Start of a content block
        if (event.content_block?.type === 'text' && event.content_block.text) {
          this.emit('message', {
            type: 'text',
            content: event.content_block.text,
          } as CLIMessage);
        } else if (event.content_block?.type === 'tool_use') {
          // Start tracking this tool_use block
          const index = event.index ?? 0;
          this.pendingToolUses.set(index, {
            id: event.content_block.id || '',
            name: event.content_block.name || '',
            inputJson: '',
          });
        }
        break;

      case 'content_block_delta':
        // Streaming text delta
        if (event.delta?.type === 'text_delta' && event.delta.text) {
          this.emit('message', {
            type: 'text',
            content: event.delta.text,
          } as CLIMessage);
        } else if (event.delta?.type === 'input_json_delta' && event.delta.partial_json) {
          // Accumulate JSON for tool_use input
          const index = event.index ?? 0;
          const pending = this.pendingToolUses.get(index);
          if (pending) {
            pending.inputJson += event.delta.partial_json;
          }
        }
        break;

      case 'content_block_stop':
        // End of content block - emit completed tool_use if any
        {
          const index = event.index ?? 0;
          const pending = this.pendingToolUses.get(index);
          if (pending) {
            let toolInput: Record<string, unknown> = {};
            try {
              if (pending.inputJson) {
                toolInput = JSON.parse(pending.inputJson);
              }
            } catch (e) {
              console.error('[CLI] Failed to parse tool input JSON:', e);
            }

            this.emit('message', {
              type: 'tool_use',
              toolId: pending.id,
              toolName: pending.name,
              toolInput,
            } as CLIMessage);

            // Clean up
            this.pendingToolUses.delete(index);
          }
        }
        break;

      case 'message_start':
        // Message starting - no action needed
        break;

      case 'message_delta':
        // Message delta - no action needed for now
        break;

      case 'message_stop':
        // Message complete
        this.emit('message', {
          type: 'done',
        } as CLIMessage);
        break;

      case 'result':
        // Final result from CLI
        if (event.result?.content) {
          for (const block of event.result.content) {
            if (block.type === 'text' && block.text) {
              this.emit('message', {
                type: 'text',
                content: block.text,
              } as CLIMessage);
            } else if (block.type === 'tool_use') {
              this.emit('message', {
                type: 'tool_use',
                toolId: block.id,
                toolName: block.name,
                toolInput: block.input,
              } as CLIMessage);
            }
          }
        }
        // Also emit done after result
        this.emit('message', {
          type: 'done',
        } as CLIMessage);
        break;

      case 'error':
        this.emit('message', {
          type: 'error',
          error: event.error?.message || 'Unknown CLI error',
        } as CLIMessage);
        break;

      default:
        // Unknown event type, log for debugging
        console.log('[CLI] Unknown event type:', event.type, event);
    }
  }

  /**
   * Reset the timeout timer
   */
  private resetTimeout(timeout: number): void {
    this.clearTimeout();
    this.timeoutId = setTimeout(() => {
      this.emit('message', {
        type: 'error',
        error: 'CLI process timed out',
      } as CLIMessage);
      this.stop();
    }, timeout);
  }

  /**
   * Clear the timeout timer
   */
  private clearTimeout(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }
}

/**
 * Create a one-shot CLI interaction
 * Useful for simple request-response patterns
 */
export async function runCLI(options: {
  message: string;
  sessionId?: string;
  systemPrompt?: string;
  workingDir?: string;
  timeout?: number;
  onMessage?: (msg: CLIMessage) => void;
}): Promise<{ messages: CLIMessage[]; sessionId: string | null }> {
  return new Promise((resolve, reject) => {
    const manager = new CLIManager({
      workingDir: options.workingDir,
    });

    const messages: CLIMessage[] = [];
    let sessionId: string | null = null;

    manager.on('message', (msg: CLIMessage) => {
      messages.push(msg);
      options.onMessage?.(msg);

      if (msg.type === 'session' && msg.sessionId) {
        sessionId = msg.sessionId;
      }
    });

    manager.on('exit', () => {
      resolve({ messages, sessionId });
    });

    manager.on('error', (error: Error) => {
      reject(error);
    });

    // Start and send message
    manager
      .start({
        sessionId: options.sessionId,
        systemPrompt: options.systemPrompt,
        timeout: options.timeout,
      })
      .then(() => manager.sendMessage(options.message))
      .catch(reject);
  });
}
