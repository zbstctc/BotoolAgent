'use client';

import { useState } from 'react';

export interface Question {
  id: string;
  text: string;
  type: 'single' | 'multiple' | 'text';
  options?: { value: string; label: string }[];
  required?: boolean;
}

export interface Answer {
  questionId: string;
  value: string | string[];
}

interface DimensionCardProps {
  dimension: string;
  questions: Question[];
  answers: Record<string, Answer>;
  isLocked: boolean;
  onAnswer: (questionId: string, value: string | string[]) => void;
}

export function DimensionCard({
  dimension,
  questions,
  answers,
  isLocked,
  onAnswer,
}: DimensionCardProps) {
  const [isExpanded, setIsExpanded] = useState(!isLocked);

  const answeredCount = questions.filter(q => answers[q.id]).length;
  const progress = questions.length > 0 ? (answeredCount / questions.length) * 100 : 0;
  const isComplete = answeredCount === questions.length;

  return (
    <div className={`rounded-lg border ${
      isLocked
        ? 'border-neutral-200 bg-neutral-50'
        : isComplete
        ? 'border-green-200 bg-green-50/50'
        : 'border-neutral-200 bg-white'
    }`}>
      {/* Header */}
      <button
        onClick={() => !isLocked && setIsExpanded(!isExpanded)}
        disabled={isLocked}
        className={`w-full flex items-center justify-between p-4 text-left ${
          isLocked ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-neutral-50'
        }`}
      >
        <div className="flex items-center gap-3">
          <span className={`text-lg ${
            isComplete ? 'text-green-600' : isLocked ? 'text-neutral-300' : 'text-neutral-600'
          }`}>
            {isComplete ? '✓' : isLocked ? '🔒' : isExpanded ? '▼' : '▶'}
          </span>
          <div>
            <h3 className={`text-sm font-medium ${
              isLocked ? 'text-neutral-400' : 'text-neutral-900'
            }`}>
              {dimension}
              {isLocked && <span className="ml-2 text-xs text-neutral-400">(待解锁)</span>}
            </h3>
            <p className={`text-xs ${isLocked ? 'text-neutral-300' : 'text-neutral-500'}`}>
              {answeredCount}/{questions.length} 问题已回答
            </p>
          </div>
        </div>

        {/* Progress */}
        {!isLocked && (
          <div className="w-24">
            <div className="h-1.5 bg-neutral-200 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  isComplete ? 'bg-green-500' : 'bg-blue-500'
                }`}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}
      </button>

      {/* Questions */}
      {isExpanded && !isLocked && (
        <div className="border-t border-neutral-200 p-4 space-y-4">
          {questions.map((question) => (
            <QuestionItem
              key={question.id}
              question={question}
              answer={answers[question.id]}
              onAnswer={(value) => onAnswer(question.id, value)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function QuestionItem({
  question,
  answer,
  onAnswer,
}: {
  question: Question;
  answer?: Answer;
  onAnswer: (value: string | string[]) => void;
}) {
  const isAnswered = !!answer;

  if (question.type === 'text') {
    return (
      <div className="space-y-2">
        <label className="block text-sm font-medium text-neutral-700">
          {question.text}
          {question.required && <span className="text-red-500 ml-1">*</span>}
        </label>
        <textarea
          value={typeof answer?.value === 'string' ? answer.value : ''}
          onChange={(e) => onAnswer(e.target.value)}
          placeholder="请输入..."
          rows={3}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all resize-none"
        />
      </div>
    );
  }

  if (question.type === 'multiple') {
    const selectedValues = Array.isArray(answer?.value) ? answer.value : [];
    return (
      <div className="space-y-2">
        <label className="block text-sm font-medium text-neutral-700">
          {question.text}
          {question.required && <span className="text-red-500 ml-1">*</span>}
          <span className="text-xs text-neutral-400 ml-2">(可多选)</span>
        </label>
        <div className="flex flex-wrap gap-2">
          {question.options?.map((option) => {
            const isSelected = selectedValues.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  const newValues = isSelected
                    ? selectedValues.filter(v => v !== option.value)
                    : [...selectedValues, option.value];
                  onAnswer(newValues);
                }}
                className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                  isSelected
                    ? 'bg-blue-100 text-blue-700 ring-2 ring-blue-500'
                    : 'bg-white border border-neutral-300 text-neutral-600 hover:bg-neutral-50'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // Single select (default)
  const selectedValue = typeof answer?.value === 'string' ? answer.value : '';
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-neutral-700">
        {question.text}
        {question.required && <span className="text-red-500 ml-1">*</span>}
      </label>
      <div className="flex flex-wrap gap-2">
        {question.options?.map((option) => {
          const isSelected = selectedValue === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onAnswer(option.value)}
              className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                isSelected
                  ? 'bg-blue-100 text-blue-700 ring-2 ring-blue-500'
                  : 'bg-white border border-neutral-300 text-neutral-600 hover:bg-neutral-50'
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
