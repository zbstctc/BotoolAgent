'use client';

import { RulesManager } from '@/components/rules/RulesManager';

export default function RulesPage() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-neutral-200 bg-white">
        <h1 className="text-sm font-medium text-neutral-900">规范管理</h1>
      </div>
      <div className="flex-1 overflow-hidden">
        <RulesManager />
      </div>
    </div>
  );
}
