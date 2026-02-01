'use client';

import { useState, useCallback } from 'react';
import {
  AskUserQuestionToolInput,
  AskUserQuestion,
  isAskUserQuestionInput,
} from '@/lib/tool-types';
import { OptionCard, Option } from './OptionCard';

export interface ToolUseData {
  toolId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
}

export interface ToolRendererProps {
  tool: ToolUseData;
  onRespond: (toolId: string, response: Record<string, unknown>) => void;
  disabled?: boolean;
}

/**
 * Renders interactive tool UI based on tool type.
 * Currently supports AskUserQuestion tool.
 */
export function ToolRenderer({ tool, onRespond, disabled = false }: ToolRendererProps) {
  if (tool.toolName === 'AskUserQuestion' && isAskUserQuestionInput(tool.toolInput)) {
    return (
      <AskUserQuestionRenderer
        toolId={tool.toolId}
        input={tool.toolInput}
        onRespond={onRespond}
        disabled={disabled}
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
}

/**
 * Renders AskUserQuestion tool with interactive options
 */
function AskUserQuestionRenderer({
  toolId,
  input,
  onRespond,
  disabled = false,
}: AskUserQuestionRendererProps) {
  // Track answers for each question
  const [answers, setAnswers] = useState<Record<string, string[]>>(() => {
    const initial: Record<string, string[]> = {};
    input.questions.forEach((_, idx) => {
      initial[`q${idx}`] = [];
    });
    return initial;
  });

  // Track "other" text input for each question
  const [otherValues, setOtherValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    input.questions.forEach((_, idx) => {
      initial[`q${idx}`] = '';
    });
    return initial;
  });

  // Track submission state
  const [submitted, setSubmitted] = useState(false);

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
    if (disabled || submitted) return;

    // Build response in the expected format
    // Format: { answers: { "question_key": "answer_value" } }
    const responseAnswers: Record<string, string> = {};

    input.questions.forEach((question, idx) => {
      const questionKey = question.header || `q${idx}`;
      const selectedOptions = answers[`q${idx}`];
      const otherValue = otherValues[`q${idx}`];

      if (otherValue) {
        // User provided custom "other" input
        responseAnswers[questionKey] = otherValue;
      } else if (selectedOptions.length > 0) {
        // Map selected option IDs back to labels
        const selectedLabels = selectedOptions
          .map((optId) => {
            const option = question.options.find((_, i) => `opt${i}` === optId);
            return option?.label || optId;
          })
          .join(', ');
        responseAnswers[questionKey] = selectedLabels;
      }
    });

    setSubmitted(true);
    onRespond(toolId, { answers: responseAnswers });
  }, [disabled, submitted, input.questions, answers, otherValues, toolId, onRespond]);

  // Check if we can submit (at least one answer per question)
  const canSubmit = input.questions.every((_, idx) => {
    const questionKey = `q${idx}`;
    return answers[questionKey].length > 0 || otherValues[questionKey].trim() !== '';
  });

  return (
    <div className="space-y-6 rounded-lg border border-blue-200 bg-blue-50 p-4">
      {/* Header */}
      <div className="flex items-center gap-2 text-blue-700">
        <QuestionIcon />
        <span className="font-medium text-sm">Claude 需要你的输入</span>
      </div>

      {/* Questions */}
      {input.questions.map((question, idx) => {
        const questionKey = `q${idx}`;
        const options: Option[] = question.options.map((opt, optIdx) => ({
          id: `opt${optIdx}`,
          label: opt.label,
          description: opt.description,
        }));

        return (
          <div key={questionKey} className="space-y-3">
            {/* Question header badge */}
            {question.header && (
              <span className="inline-block px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded">
                {question.header}
              </span>
            )}

            {/* Question text */}
            <p className="text-sm font-medium text-neutral-900">{question.question}</p>

            {/* Options */}
            <OptionCard
              options={options}
              mode={question.multiSelect ? 'multi' : 'single'}
              selected={answers[questionKey]}
              onChange={(selected) => handleAnswerChange(questionKey, selected)}
              showOther={true}
              otherValue={otherValues[questionKey]}
              onOtherChange={(value) => handleOtherChange(questionKey, value)}
              disabled={disabled || submitted}
            />
          </div>
        );
      })}

      {/* Submit button */}
      {!submitted && (
        <button
          onClick={handleSubmit}
          disabled={!canSubmit || disabled}
          className={`w-full rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
            canSubmit && !disabled
              ? 'bg-blue-600 text-white hover:bg-blue-700'
              : 'bg-neutral-200 text-neutral-400 cursor-not-allowed'
          }`}
        >
          确认并继续
        </button>
      )}

      {/* Submitted state */}
      {submitted && (
        <div className="flex items-center gap-2 text-green-700 bg-green-50 rounded-lg p-3">
          <CheckIcon />
          <span className="text-sm font-medium">已提交答案</span>
        </div>
      )}
    </div>
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
