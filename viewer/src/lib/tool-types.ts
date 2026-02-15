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
  /** Transform mode: current phase */
  transformPhase?: 'source-input' | 'extraction' | 'gap-analysis' | 'targeted-qa' | 'dt-decomposition';
  /** Transform mode: gap analysis result */
  gapAnalysis?: {
    dimensions: Array<{
      section: string;      // "§ 1", "§ 3", etc.
      name: string;         // "项目概述", "架构设计", etc.
      coverage: 'full' | 'high' | 'partial' | 'sparse';
      note: string;
    }>;
  };
  /** Transform mode: source PRD file path */
  sourcePrdPath?: string;
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

// TestCase type for prd.json devTask.testCases field
export interface TestCase {
  type: 'typecheck' | 'lint' | 'unit' | 'e2e' | 'manual';
  desc?: string;
  tdd?: boolean;
}

// Session grouping for batch execution
export interface SessionGroup {
  id: string;           // "S1", "S2", ...
  tasks: string[];      // ["DT-001", "DT-002", ...]
  reason?: string;      // 分组原因
}

// Enriched PrdJson (new schema — slim index + backward compat)
export interface EnrichedDevTask {
  id: string;
  title: string;
  prdSection?: string;          // PRD section with line range (e.g., "7.1 (L519-528)")
  description?: string;         // Optional: stays in PRD.md for new format
  acceptanceCriteria?: string[]; // Optional: stays in PRD.md for new format
  priority: number;
  passes: boolean;
  dependsOn?: string[];
  contextHint?: string;         // Deprecated: replaced by prdSection
  notes?: string;               // Optional: stays in progress.txt
  spec?: DevTaskSpec;           // Optional: stays in PRD.md §3-6
  evals?: DevTaskEval[];
  testCases?: TestCase[];
}

export interface EnrichedPrdJson {
  project: string;
  branchName: string;
  description: string;
  prdFile?: string;             // NEW: path to PRD markdown file
  constitution?: Constitution;
  devTasks: EnrichedDevTask[];
  sessions?: SessionGroup[];
}

// Pipeline mode type
export type PipelineMode = 'quick' | 'feature' | 'full' | 'transform';
