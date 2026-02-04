/**
 * Shared types for CLI tool interactions.
 * These types can be used in both client and server components.
 */

// AskUserQuestion tool specific types
export interface AskUserQuestionOption {
  label: string;
  description?: string;
}

export interface AskUserQuestion {
  question: string;
  header?: string;
  options?: AskUserQuestionOption[];
  multiSelect?: boolean;
  /** For text input questions without predefined options */
  inputType?: 'text' | 'textarea';
  /** Placeholder text for text input */
  placeholder?: string;
}

export interface PyramidMetadata {
  source: 'pyramidprd';
  level: 1 | 2 | 3 | 4;
  levelName: string;
  progress: string;
  totalLevels: number;
  activeDimensions?: string[];
}

export interface AskUserQuestionToolInput {
  questions: AskUserQuestion[];
  /** Metadata for pyramid mode - contains level information */
  metadata?: PyramidMetadata;
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
        // options can be optional for text input questions
        (('options' in q && Array.isArray((q as AskUserQuestion).options)) ||
          !('options' in q) ||
          (q as AskUserQuestion).options === undefined)
    )
  );
}

// Helper to check if a question is text-input only (no options)
export function isTextInputQuestion(question: AskUserQuestion): boolean {
  return !question.options || question.options.length === 0;
}
