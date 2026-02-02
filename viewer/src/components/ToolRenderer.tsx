'use client';

import { useState, useCallback, useEffect } from 'react';
import { AskUserQuestionToolInput, isAskUserQuestionInput, isTextInputQuestion } from '@/lib/tool-types';
import { OptionCard, Option } from './OptionCard';
import {
  saveQuestionAnswers,
  getQuestionAnswers,
  QuestionAnswer,
} from '@/lib/prd-session-storage';

export interface ToolUseData {
  toolId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
}

export interface ToolRendererProps {
  tool: ToolUseData;
  onRespond: (toolId: string, response: Record<string, unknown>) => void;
  disabled?: boolean;
  /** Project name for session storage */
  projectName?: string;
}

/**
 * Renders interactive tool UI based on tool type.
 * Currently supports AskUserQuestion tool.
 */
export function ToolRenderer({ tool, onRespond, disabled = false, projectName }: ToolRendererProps) {
  if (tool.toolName === 'AskUserQuestion' && isAskUserQuestionInput(tool.toolInput)) {
    return (
      <AskUserQuestionRenderer
        toolId={tool.toolId}
        input={tool.toolInput}
        onRespond={onRespond}
        disabled={disabled}
        projectName={projectName}
      />
    );
  }

  // Fallback for unsupported tools - show raw JSON
  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
      <div className="flex items-center gap-2 text-sm text-neutral-600 mb-2">
        <ToolIcon />
        <span className="font-medium">{tool.toolName}</span>
      </div>
      <pre className="text-xs text-neutral-500 overflow-x-auto">
        {JSON.stringify(tool.toolInput, null, 2)}
      </pre>
    </div>
  );
}

interface AskUserQuestionRendererProps {
  toolId: string;
  input: AskUserQuestionToolInput;
  onRespond: (toolId: string, response: Record<string, unknown>) => void;
  disabled?: boolean;
  /** Project name for session storage */
  projectName?: string;
}

/**
 * Renders AskUserQuestion tool as a modal dialog
 */
function AskUserQuestionRenderer({
  toolId,
  input,
  onRespond,
  disabled = false,
  projectName,
}: AskUserQuestionRendererProps) {
  // Modal visibility state - initialize based on whether we should auto-open
  const [isModalOpen, setIsModalOpen] = useState(() => !disabled);

  // Track answers for each question - initialize from localStorage if available
  const [answers, setAnswers] = useState<Record<string, string[]>>(() => {
    const savedAnswers = getQuestionAnswers(toolId);
    const initial: Record<string, string[]> = {};
    input.questions.forEach((_, idx) => {
      const key = `q${idx}`;
      initial[key] = savedAnswers?.[key]?.selected || [];
    });
    return initial;
  });

  // Track "other" text input for each question - initialize from localStorage if available
  const [otherValues, setOtherValues] = useState<Record<string, string>>(() => {
    const savedAnswers = getQuestionAnswers(toolId);
    const initial: Record<string, string> = {};
    input.questions.forEach((_, idx) => {
      const key = `q${idx}`;
      initial[key] = savedAnswers?.[key]?.otherValue || '';
    });
    return initial;
  });

  // Track submission state
  const [submitted, setSubmitted] = useState(false);

  // Save answers to localStorage whenever they change
  useEffect(() => {
    if (submitted) return; // Don't save after submission

    const combinedAnswers: Record<string, QuestionAnswer> = {};
    input.questions.forEach((_, idx) => {
      const key = `q${idx}`;
      combinedAnswers[key] = {
        selected: answers[key] || [],
        otherValue: otherValues[key] || '',
      };
    });

    saveQuestionAnswers(
      toolId,
      combinedAnswers,
      input.questions.length,
      projectName
    );
  }, [answers, otherValues, toolId, input.questions, projectName, submitted]);

  const handleAnswerChange = useCallback((questionKey: string, selected: string[]) => {
    setAnswers((prev) => ({
      ...prev,
      [questionKey]: selected,
    }));
  }, []);

  const handleOtherChange = useCallback((questionKey: string, value: string) => {
    setOtherValues((prev) => ({
      ...prev,
      [questionKey]: value,
    }));
  }, []);

  const handleSubmit = useCallback(() => {
    if (submitted) return;

    // Build response in the expected format
    const responseAnswers: Record<string, string> = {};

    input.questions.forEach((question, idx) => {
      const questionKey = question.header || `q${idx}`;
      const selectedOptions = answers[`q${idx}`];
      const otherValue = otherValues[`q${idx}`];

      if (otherValue) {
        responseAnswers[questionKey] = otherValue;
      } else if (selectedOptions.length > 0 && question.options) {
        const selectedLabels = selectedOptions
          .map((optId) => {
            const option = question.options!.find((_, i) => `opt${i}` === optId);
            return option?.label || optId;
          })
          .join(', ');
        responseAnswers[questionKey] = selectedLabels;
      }
    });

    setSubmitted(true);
    setIsModalOpen(false);
    onRespond(toolId, { answers: responseAnswers });
  }, [submitted, input.questions, answers, otherValues, toolId, onRespond]);

  // Check if we can submit (at least one answer per question)
  const canSubmit = input.questions.every((_, idx) => {
    const questionKey = `q${idx}`;
    return answers[questionKey].length > 0 || otherValues[questionKey].trim() !== '';
  });

  // Count answered questions
  const answeredCount = input.questions.filter((_, idx) => {
    const questionKey = `q${idx}`;
    return answers[questionKey].length > 0 || otherValues[questionKey].trim() !== '';
  }).length;

  // Get question count and all unique headers for the trigger button
  const questionCount = input.questions.length;
  const questionHeaders = input.questions
    .map((q) => q.header)
    .filter((h): h is string => Boolean(h));

  // If submitted, show completion message
  if (submitted) {
    return (
      <div className="flex items-center gap-2 text-green-700 bg-green-50 rounded-lg p-3 border border-green-200">
        <CheckIcon />
        <span className="text-sm font-medium">已提交答案</span>
      </div>
    );
  }

  return (
    <>
      {/* Trigger Button in Chat */}
      <button
        onClick={() => setIsModalOpen(true)}
        className="flex items-center gap-2 text-blue-700 bg-blue-50 rounded-lg px-4 py-3 border border-blue-200 hover:bg-blue-100 transition-colors w-full"
      >
        <QuestionIcon />
        <span className="font-medium text-sm">请回答 {questionCount} 个问题</span>
        <div className="flex items-center gap-1.5 ml-auto">
          {questionHeaders.map((header, idx) => (
            <span
              key={idx}
              className="text-xs bg-blue-200 text-blue-800 px-2 py-0.5 rounded"
            >
              {header}
            </span>
          ))}
        </div>
        <svg className="w-4 h-4 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>

      {/* Modal Overlay */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setIsModalOpen(false)}
          />

          {/* Modal Content */}
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-100">
              <div className="flex items-center gap-2 text-blue-700">
                <QuestionIcon />
                <span className="font-semibold">请回答 {questionCount} 个问题</span>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-neutral-400 hover:text-neutral-600 transition-colors p-1 rounded-lg hover:bg-neutral-100"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Questions - Scrollable */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
              {input.questions.map((question, idx) => {
                const questionKey = `q${idx}`;
                const isTextOnly = isTextInputQuestion(question);
                const options: Option[] = isTextOnly
                  ? []
                  : (question.options || []).map((opt, optIdx) => ({
                      id: `opt${optIdx}`,
                      label: opt.label,
                      description: opt.description,
                    }));

                // Check if this question has been answered
                const isAnswered =
                  answers[questionKey].length > 0 || otherValues[questionKey].trim() !== '';

                return (
                  <div key={questionKey} className="space-y-3">
                    {/* Question number and header */}
                    <div className="flex items-center gap-2">
                      {/* Question number with answered indicator */}
                      <span
                        className={`inline-flex items-center justify-center w-6 h-6 text-sm font-semibold rounded-full ${
                          isAnswered
                            ? 'bg-green-100 text-green-700'
                            : 'bg-neutral-100 text-neutral-600'
                        }`}
                      >
                        {isAnswered ? (
                          <svg
                            className="w-4 h-4"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                        ) : (
                          idx + 1
                        )}
                      </span>
                      {/* Question header badge */}
                      {question.header && (
                        <span className="inline-block px-2.5 py-1 text-xs font-semibold bg-blue-100 text-blue-700 rounded-full">
                          {question.header}
                        </span>
                      )}
                    </div>

                    {/* Question text */}
                    <p className="text-base font-medium text-neutral-900">{question.question}</p>

                    {/* Options or Text Input */}
                    <OptionCard
                      options={options}
                      mode={question.multiSelect ? 'multi' : 'single'}
                      selected={answers[questionKey]}
                      onChange={(selected) => handleAnswerChange(questionKey, selected)}
                      showOther={!isTextOnly}
                      otherValue={otherValues[questionKey]}
                      onOtherChange={(value) => handleOtherChange(questionKey, value)}
                      disabled={false}
                      textInputOnly={isTextOnly}
                      inputType={question.inputType || 'text'}
                      placeholder={question.placeholder}
                    />
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-neutral-100 bg-neutral-50 space-y-3">
              {/* Progress indicator */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-neutral-500">
                  已回答 {answeredCount}/{questionCount}
                </span>
                {canSubmit && (
                  <span className="text-green-600 font-medium flex items-center gap-1">
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                    全部完成
                  </span>
                )}
              </div>
              <button
                onClick={handleSubmit}
                disabled={!canSubmit}
                className={`w-full rounded-xl px-4 py-3 text-sm font-semibold transition-all ${
                  canSubmit
                    ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-200'
                    : 'bg-neutral-200 text-neutral-400 cursor-not-allowed'
                }`}
              >
                确认并继续
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Icon components
function ToolIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

function QuestionIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}
