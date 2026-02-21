'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Stage2Content } from '@/components/panels/Stage2Content';

function Stage2PageContent() {
  const searchParams = useSearchParams();
  const reqId = searchParams.get('req') || '';

  return <Stage2Content reqId={reqId} />;
}

function Stage2Fallback() {
  return (
    <div className="flex h-full items-center justify-center bg-neutral-50 text-sm text-neutral-500">
      加载中...
    </div>
  );
}

export default function Stage2Page() {
  return (
    <Suspense fallback={<Stage2Fallback />}>
      <Stage2PageContent />
    </Suspense>
  );
}
