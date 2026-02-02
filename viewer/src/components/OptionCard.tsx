'use client';

import { useState } from 'react';

export interface Option {
  id: string;
  label: string;
  description?: string;
}

export interface OptionCardProps {
  options: Option[];
  mode: 'single' | 'multi';
  selected: string[];
  onChange: (selected: string[]) => void;
  showOther?: boolean;
  otherValue?: string;
  onOtherChange?: (value: string) => void;
  disabled?: boolean;
  /** For text-only questions (no predefined options) */
  textInputOnly?: boolean;
  /** Input type: 'text' for single line, 'textarea' for multiline */
  inputType?: 'text' | 'textarea';
  /** Placeholder for text input */
  placeholder?: string;
}

export function OptionCard({
  options,
  mode,
  selected,
  onChange,
  showOther = false,
  otherValue = '',
  onOtherChange,
  disabled = false,
  textInputOnly = false,
  inputType = 'text',
  placeholder,
}: OptionCardProps) {
  const [isOtherSelected, setIsOtherSelected] = useState(false);

  // For text-only questions, render just the input field
  if (textInputOnly) {
    return (
      <div className="space-y-2">
        {inputType === 'textarea' ? (
          <textarea
            value={otherValue}
            onChange={(e) => onOtherChange?.(e.target.value)}
            placeholder={placeholder || '请输入您的答案...'}
            disabled={disabled}
            rows={4}
            className="w-full rounded-lg border-2 border-neutral-200 bg-white px-4 py-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-neutral-50 disabled:cursor-not-allowed resize-none transition-all"
          />
        ) : (
          <input
            type="text"
            value={otherValue}
            onChange={(e) => onOtherChange?.(e.target.value)}
            placeholder={placeholder || '请输入您的答案...'}
            disabled={disabled}
            className="w-full rounded-lg border-2 border-neutral-200 bg-white px-4 py-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-neutral-50 disabled:cursor-not-allowed transition-all"
          />
        )}
        <p className="text-xs text-neutral-400">
          {inputType === 'textarea' ? '可输入多行文本' : '请输入文本回答'}
        </p>
      </div>
    );
  }

  const handleOptionClick = (optionId: string) => {
    if (disabled) return;

    if (mode === 'single') {
      onChange([optionId]);
      setIsOtherSelected(false);
    } else {
      if (selected.includes(optionId)) {
        onChange(selected.filter((id) => id !== optionId));
      } else {
        onChange([...selected, optionId]);
      }
    }
  };

  const handleOtherClick = () => {
    if (disabled) return;

    if (mode === 'single') {
      onChange([]);
      setIsOtherSelected(true);
    } else {
      setIsOtherSelected(!isOtherSelected);
    }
  };

  return (
    <div className="space-y-2">
      {/* Regular Options */}
      {options.map((option) => {
        const isSelected = selected.includes(option.id);
        return (
          <button
            key={option.id}
            onClick={() => handleOptionClick(option.id)}
            disabled={disabled}
            className={`w-full text-left rounded-lg border-2 p-4 transition-all ${
              isSelected
                ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200'
                : 'border-neutral-200 bg-white hover:border-neutral-300 hover:bg-neutral-50'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <div className="flex items-start gap-3">
              {/* Selection Indicator */}
              <div
                className={`mt-0.5 flex-shrink-0 w-5 h-5 border-2 flex items-center justify-center ${
                  mode === 'single' ? 'rounded-full' : 'rounded-md'
                } ${
                  isSelected
                    ? 'border-blue-500 bg-blue-500'
                    : 'border-neutral-300 bg-white'
                }`}
              >
                {isSelected && (
                  <svg
                    className="w-3 h-3 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={3}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <p
                  className={`text-sm font-medium ${
                    isSelected ? 'text-blue-900' : 'text-neutral-900'
                  }`}
                >
                  {option.label}
                </p>
                {option.description && (
                  <p
                    className={`text-xs mt-0.5 ${
                      isSelected ? 'text-blue-700' : 'text-neutral-500'
                    }`}
                  >
                    {option.description}
                  </p>
                )}
              </div>
            </div>
          </button>
        );
      })}

      {/* "Other" Option */}
      {showOther && (
        <div
          className={`rounded-lg border-2 p-4 transition-all ${
            isOtherSelected
              ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200'
              : 'border-neutral-200 bg-white'
          } ${disabled ? 'opacity-50' : ''}`}
        >
          <button
            onClick={handleOtherClick}
            disabled={disabled}
            className={`w-full text-left ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <div className="flex items-start gap-3">
              {/* Selection Indicator */}
              <div
                className={`mt-0.5 flex-shrink-0 w-5 h-5 border-2 flex items-center justify-center ${
                  mode === 'single' ? 'rounded-full' : 'rounded-md'
                } ${
                  isOtherSelected
                    ? 'border-blue-500 bg-blue-500'
                    : 'border-neutral-300 bg-white'
                }`}
              >
                {isOtherSelected && (
                  <svg
                    className="w-3 h-3 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={3}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                )}
              </div>

              {/* Label */}
              <p
                className={`text-sm font-medium ${
                  isOtherSelected ? 'text-blue-900' : 'text-neutral-900'
                }`}
              >
                其他
              </p>
            </div>
          </button>

          {/* Custom Text Input */}
          {isOtherSelected && (
            <div className="mt-3 pl-8">
              <input
                type="text"
                value={otherValue}
                onChange={(e) => onOtherChange?.(e.target.value)}
                placeholder="请输入..."
                disabled={disabled}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-neutral-50 disabled:cursor-not-allowed"
                autoFocus
              />
            </div>
          )}
        </div>
      )}

      {/* Mode Indicator */}
      <p className="text-xs text-neutral-400 mt-2">
        {mode === 'single' ? '单选' : '多选（可选择多个选项）'}
      </p>
    </div>
  );
}
