'use client';

import { useState } from 'react';

export interface QuestionData {
  id: string;
  text: string;
  type: 'single' | 'multiple' | 'text';
  options?: { value: string; label: string }[];
  required?: boolean;
}

export interface AnswerData {
  questionId: string;
  value: string | string[];
}

interface QuestionItemProps {
  question: QuestionData;
  answer?: AnswerData;
  isAnswered: boolean;
  onAnswer: (value: string | string[]) => void;
}

export function QuestionItem({
  question,
  answer,
  isAnswered,
  onAnswer,
}: QuestionItemProps) {
  const [isExpanded, setIsExpanded] = useState(!isAnswered);

  // Get answer summary for collapsed view
  const getAnswerSummary = (): string => {
    if (!answer) return '';

    if (question.type === 'text') {
      const textValue = typeof answer.value === 'string' ? answer.value : '';
      return textValue.length > 50 ? textValue.slice(0, 50) + '...' : textValue;
    }

    if (question.type === 'multiple') {
      const selectedValues = Array.isArray(answer.value) ? answer.value : [];
      const labels = selectedValues
        .map(v => question.options?.find(o => o.value === v)?.label || v)
        .join('、');
      return labels;
    }

    // Single select
    const selectedValue = typeof answer.value === 'string' ? answer.value : '';
    return question.options?.find(o => o.value === selectedValue)?.label || selectedValue;
  };

  // Collapsed view for answered questions
  if (isAnswered && !isExpanded) {
    return (
      <button
        onClick={() => setIsExpanded(true)}
        className="w-full flex items-center gap-3 p-3 rounded-lg bg-green-50 border border-green-100 hover:bg-green-100 transition-colors text-left"
      >
        <span className="text-green-600 text-lg">✓</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-neutral-900 truncate">
            {question.text}
          </p>
          <p className="text-xs text-neutral-500 truncate mt-0.5">
            {getAnswerSummary()}
          </p>
        </div>
        <span className="text-neutral-400 text-xs">点击修改</span>
      </button>
    );
  }

  // Expanded view
  return (
    <div className="p-4 rounded-lg bg-white border border-neutral-200 space-y-3">
      {/* Question text */}
      <div className="flex items-start justify-between">
        <label className="block text-sm font-medium text-neutral-900">
          {question.text}
          {question.required && <span className="text-red-500 ml-1">*</span>}
          {question.type === 'multiple' && (
            <span className="text-xs text-neutral-400 ml-2">(可多选)</span>
          )}
        </label>
        {isAnswered && (
          <button
            onClick={() => setIsExpanded(false)}
            className="text-xs text-neutral-500 hover:text-neutral-700"
          >
            收起
          </button>
        )}
      </div>

      {/* Input based on type */}
      {question.type === 'text' ? (
        <textarea
          value={typeof answer?.value === 'string' ? answer.value : ''}
          onChange={(e) => onAnswer(e.target.value)}
          placeholder="请输入..."
          rows={3}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-500 focus:ring-2 focus:ring-neutral-200 outline-none transition-all resize-none"
        />
      ) : question.type === 'multiple' ? (
        <MultipleSelect
          options={question.options || []}
          selectedValues={Array.isArray(answer?.value) ? answer.value : []}
          onSelect={onAnswer}
        />
      ) : (
        <SingleSelect
          options={question.options || []}
          selectedValue={typeof answer?.value === 'string' ? answer.value : ''}
          onSelect={onAnswer}
        />
      )}
    </div>
  );
}

function SingleSelect({
  options,
  selectedValue,
  onSelect,
}: {
  options: { value: string; label: string }[];
  selectedValue: string;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const isSelected = selectedValue === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onSelect(option.value)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              isSelected
                ? 'bg-neutral-900 text-white shadow-sm'
                : 'bg-white border border-neutral-300 text-neutral-700 hover:border-neutral-400 hover:bg-neutral-100'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function MultipleSelect({
  options,
  selectedValues,
  onSelect,
}: {
  options: { value: string; label: string }[];
  selectedValues: string[];
  onSelect: (values: string[]) => void;
}) {
  const toggleOption = (value: string) => {
    if (selectedValues.includes(value)) {
      onSelect(selectedValues.filter(v => v !== value));
    } else {
      onSelect([...selectedValues, value]);
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const isSelected = selectedValues.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => toggleOption(option.value)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              isSelected
                ? 'bg-neutral-900 text-white shadow-sm'
                : 'bg-white border border-neutral-300 text-neutral-700 hover:border-neutral-400 hover:bg-neutral-100'
            }`}
          >
            {isSelected && <span className="mr-1">✓</span>}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
