'use client';

import { Stage1Content } from '@/components/panels/Stage1Content';
import { Stage2Content } from '@/components/panels/Stage2Content';
import Stage3Content from '@/components/panels/Stage3Content';
import Stage4Content from '@/components/panels/Stage4Content';
import { Stage5Content } from '@/components/panels/Stage5Content';

export interface StageRouterProps {
  reqId: string;
  stage: number;
}

export function StageRouter({ reqId, stage }: StageRouterProps) {
  switch (stage) {
    case 0:
    case 1:
      return <Stage1Content reqId={reqId} />;
    case 2:
      return <Stage2Content reqId={reqId} />;
    case 3:
      return <Stage3Content reqId={reqId} />;
    case 4:
      return <Stage4Content reqId={reqId} />;
    case 5:
      return <Stage5Content reqId={reqId} />;
    default:
      return <Stage1Content reqId={reqId} />;
  }
}
