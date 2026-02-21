'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Stage3Content from '@/components/panels/Stage3Content';

function Stage3PageContent() {
  const searchParams = useSearchParams();
  const reqId = searchParams.get('req') || '';

  return <Stage3Content reqId={reqId} />;
}

function Stage3Fallback() {
  return (
    <div className="flex h-full items-center justify-center bg-neutral-50 text-sm text-neutral-500">
      加载中...
    </div>
  );
}

export default function Stage3Page() {
  return (
    <Suspense fallback={<Stage3Fallback />}>
      <Stage3PageContent />
    </Suspense>
  );
}
