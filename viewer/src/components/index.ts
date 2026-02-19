// Header and Main are server components — import them directly, not via barrel
// e.g. import { Header } from "@/components/Header"
export { Main } from "./Main";
export { StageIndicator } from "./StageIndicator";
export { OptionCard } from "./OptionCard";
export type { Option, OptionCardProps } from "./OptionCard";
export { PRDPreview } from "./PRDPreview";
export type { PRDPreviewProps } from "./PRDPreview";
export { TaskEditor } from "./TaskEditor";
export { TestResults } from "./TestResults";
export type { TestResult, TestSummary, TestResultsProps, TestType } from "./TestResults";
export { ManualChecklist, extractChecklistFromPRD } from "./ManualChecklist";
export type { ChecklistItem, ManualChecklistProps } from "./ManualChecklist";
export { ChangeSummary } from "./ChangeSummary";
export type { FileDiff, DiffHunk, DiffLine, DiffSummary, ChangeSummaryProps } from "./ChangeSummary";
export { CompletionSummary, parseProgressContent } from "./CompletionSummary";
export type { CompletedTask, CodebasePattern, ProgressSummary, CompletionSummaryProps } from "./CompletionSummary";
export { StageTransitionModal } from "./StageTransitionModal";
export type { StageTransitionModalProps } from "./StageTransitionModal";
export { ProjectSwitcher } from "./ProjectSwitcher";

// Pyramid components
export { PyramidNavigation } from "./pyramid/PyramidNavigation";
export type { LevelInfo, CollectedSummaryItem } from "./pyramid/PyramidNavigation";
export { DimensionCard } from "./pyramid/DimensionCard";
export type { Question, Answer } from "./pyramid/DimensionCard";
export { QuestionItem } from "./pyramid/QuestionItem";
export type { QuestionData, AnswerData } from "./pyramid/QuestionItem";
export { LevelPanel } from "./pyramid/LevelPanel";
export type { Dimension } from "./pyramid/LevelPanel";
export { ConfirmationCard } from "./pyramid/ConfirmationCard";
export { ModeSelector } from "./pyramid/ModeSelector";
export { ReviewSummary } from "./ReviewSummary";
export type { ReviewSummaryProps } from "./ReviewSummary";
export { ErrorRecovery } from "./ErrorRecovery";
export type { ErrorRecoveryProps, ErrorAction } from "./ErrorRecovery";
export { TabBar } from "./TabBar";
export { LayerProgressBar } from "./LayerProgressBar";
export type { LayerResult, LayerStatus, LayerProgressBarProps } from "./LayerProgressBar";
export { CodexReviewPanel } from "./CodexReviewPanel";
export type { CodexReviewPanelProps } from "./CodexReviewPanel";
