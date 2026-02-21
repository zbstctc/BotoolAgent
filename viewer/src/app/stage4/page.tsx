'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Stage4Content from '@/components/panels/Stage4Content';

function Stage4PageContent() {
  const searchParams = useSearchParams();
  const reqId = searchParams.get('req') || '';

  return <Stage4Content reqId={reqId} />;
}

function Stage4Fallback() {
  return (
    <div className="flex h-full items-center justify-center bg-neutral-50 text-sm text-neutral-500">
      加载中...
    </div>
  );
}

export default function Stage4Page() {
  return (
    <Suspense fallback={<Stage4Fallback />}>
      <Stage4PageContent />
    </Suspense>
  );
}
