'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Stage5Content } from '@/components/panels/Stage5Content';

function Stage5PageContent() {
  const searchParams = useSearchParams();
  const reqId = searchParams.get('req') || '';

  return <Stage5Content reqId={reqId} />;
}

function Stage5Fallback() {
  return (
    <div className="flex h-full items-center justify-center bg-neutral-50 text-sm text-neutral-500">
      Loading...
    </div>
  );
}

export default function Stage5Page() {
  return (
    <Suspense fallback={<Stage5Fallback />}>
      <Stage5PageContent />
    </Suspense>
  );
}
