'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Stage1Content } from '@/components/panels/Stage1Content';

function Stage1PageContent() {
  const searchParams = useSearchParams();
  const reqId = searchParams.get('req') || '';

  return <Stage1Content reqId={reqId} />;
}

function Stage1Fallback() {
  return (
    <div className="flex h-full items-center justify-center bg-neutral-50 text-sm text-neutral-500">
      加载中...
    </div>
  );
}

export default function Stage1Page() {
  return (
    <Suspense fallback={<Stage1Fallback />}>
      <Stage1PageContent />
    </Suspense>
  );
}
