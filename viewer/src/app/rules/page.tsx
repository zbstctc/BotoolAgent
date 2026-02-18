'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { RulesManager } from '@/components/rules/RulesManager';

export default function RulesPage() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-neutral-200 bg-white">
        <Link
          href="/"
          className="flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-900 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          返回 Dashboard
        </Link>
        <span className="text-neutral-300">·</span>
        <h1 className="text-sm font-medium text-neutral-900">规范管理</h1>
      </div>
      <div className="flex-1 overflow-hidden">
        <RulesManager />
      </div>
    </div>
  );
}
