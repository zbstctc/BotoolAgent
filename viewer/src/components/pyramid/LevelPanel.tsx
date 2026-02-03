'use client';

import { DimensionCard, type Question, type Answer } from './DimensionCard';

export interface Dimension {
  id: string;
  name: string;
  isLocked: boolean;
}

interface LevelPanelProps {
  level: number;
  levelName: string;
  dimensions: Dimension[];
  questions: Record<string, Question[]>; // dimensionId -> questions
  answers: Record<string, Answer>;
  onAnswer: (questionId: string, value: string | string[]) => void;
  onComplete: () => void;
}

const LEVEL_TITLES: Record<number, string> = {
  1: 'L1 核心识别',
  2: 'L2 领域分支',
  3: 'L3 细节深入',
  4: 'L4 边界确认',
};

const LEVEL_DESCRIPTIONS: Record<number, string> = {
  1: '首先，让我们明确你的需求类型和目标用户。',
  2: '接下来，确定这个需求涉及的技术领域。',
  3: '现在，让我们深入了解具体的实现细节。',
  4: '最后，确认需求边界和验收标准。',
};

export function LevelPanel({
  level,
  levelName,
  dimensions,
  questions,
  answers,
  onAnswer,
  onComplete,
}: LevelPanelProps) {
  // Calculate total questions and answered count
  let totalQuestions = 0;
  let answeredQuestions = 0;
  let requiredUnanswered = 0;

  dimensions.forEach(dim => {
    const dimQuestions = questions[dim.id] || [];
    dimQuestions.forEach(q => {
      totalQuestions++;
      if (answers[q.id]) {
        answeredQuestions++;
      } else if (q.required) {
        requiredUnanswered++;
      }
    });
  });

  const canComplete = requiredUnanswered === 0 && totalQuestions > 0;
  const progress = totalQuestions > 0 ? (answeredQuestions / totalQuestions) * 100 : 0;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-6 border-b border-neutral-200 bg-white">
        <h2 className="text-xl font-semibold text-neutral-900">
          {LEVEL_TITLES[level] || levelName}
        </h2>
        <p className="text-sm text-neutral-500 mt-1">
          {LEVEL_DESCRIPTIONS[level]}
        </p>

        {/* Progress */}
        <div className="mt-4">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-neutral-600">
              进度：{answeredQuestions}/{totalQuestions} 问题
            </span>
            <span className="text-neutral-500">{Math.round(progress)}%</span>
          </div>
          <div className="h-2 bg-neutral-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>

      {/* Dimension Cards */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-neutral-50">
        {dimensions.map((dimension) => (
          <DimensionCard
            key={dimension.id}
            dimension={dimension.name}
            questions={questions[dimension.id] || []}
            answers={answers}
            isLocked={dimension.isLocked}
            onAnswer={onAnswer}
          />
        ))}
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-neutral-200 bg-white">
        <button
          onClick={onComplete}
          disabled={!canComplete}
          className={`w-full py-3 rounded-lg font-medium transition-colors ${
            canComplete
              ? 'bg-blue-600 text-white hover:bg-blue-700'
              : 'bg-neutral-200 text-neutral-400 cursor-not-allowed'
          }`}
        >
          {canComplete
            ? level === 4
              ? '完成问答，生成 PRD'
              : `完成第 ${level} 层，进入下一层`
            : `请回答所有必填问题 (${requiredUnanswered} 个未答)`}
        </button>
      </div>
    </div>
  );
}
