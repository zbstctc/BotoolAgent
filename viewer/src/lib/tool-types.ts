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

export interface ConfirmationSummary {
  requirementsSummary: string;
  features: string[];
  technicalApproach: string;
  risks: {
    high: string[];
    medium: string[];
    low: string[];
  };
  complexityEstimate: string;
}

export interface PyramidMetadata {
  source: 'pyramidprd';
  level: 1 | 2 | 3 | 4 | 5;
  levelName: string;
  progress: string;
  totalLevels: number;
  activeDimensions?: string[];
  /** Phase identifier - 'confirmation' for L5 confirmation gate */
  phase?: 'questioning' | 'confirmation' | 'generating';
  /** Whether codebase scan was performed */
  codebaseScanned?: boolean;
  /** Summary of codebase scan results */
  codebaseSummary?: string;
  /** Structured confirmation summary for L5 */
  confirmationSummary?: ConfirmationSummary;
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

// === SDD Enhancement Types (DT-002) ===

// Constitution layer - project-level coding standards
export interface ConstitutionRule {
  id: string;
  name: string;
  category: string;
  content?: string;
}

export interface Constitution {
  rules: ConstitutionRule[];
  ruleAuditSummary?: string;
}

// Task Spec layer - per-task implementation details
export interface SpecCodeExample {
  language: string;
  description: string;
  code: string;
}

export interface SpecTestCase {
  type: 'unit' | 'e2e';
  description: string;
  steps: string[];
}

export interface DevTaskSpec {
  codeExamples: SpecCodeExample[];
  testCases: SpecTestCase[];
  filesToModify: string[];
  relatedFiles: string[];
}

// Eval types
export interface DevTaskEval {
  type: 'code-based' | 'model-based';
  blocking: boolean;
  description: string;
  command?: string;
  expect?: string;
  files?: string[];
  criteria?: string;
}

// Enriched PrdJson (new schema)
export interface EnrichedDevTask {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  priority: number;
  passes: boolean;
  dependsOn?: string[];
  contextHint?: string;
  notes: string;
  spec?: DevTaskSpec;
  evals?: DevTaskEval[];
}

export interface EnrichedPrdJson {
  project: string;
  branchName: string;
  description: string;
  constitution?: Constitution;
  devTasks: EnrichedDevTask[];
}

// Pipeline mode type
export type PipelineMode = 'quick' | 'feature' | 'full';
