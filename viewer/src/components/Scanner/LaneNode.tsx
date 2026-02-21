'use client';

import { memo } from 'react';
import type { NodeProps, Node } from '@xyflow/react';

// --- Types ---

export type LaneNodeData = {
  label: string;
  groupId: string;
  [key: string]: unknown;
};

export type LaneNodeType = Node<LaneNodeData, 'lane'>;

// --- Group color config ---

const GROUP_STYLES: Record<
  string,
  { bg: string; border: string; headerColor: string }
> = {
  frontend: { bg: '#eff6ff', border: '#bfdbfe', headerColor: '#1d4ed8' },
  backend:  { bg: '#faf5ff', border: '#ddd6fe', headerColor: '#6d28d9' },
  agent:    { bg: '#fff7ed', border: '#fed7aa', headerColor: '#c2410c' },
  infra:    { bg: '#f0fdf4', border: '#bbf7d0', headerColor: '#15803d' },
};

const DEFAULT_STYLE = { bg: '#f9fafb', border: '#e5e7eb', headerColor: '#374151' };

// --- Component ---

function LaneNodeInner({ data }: NodeProps<LaneNodeType>) {
  const s = GROUP_STYLES[data.groupId] ?? DEFAULT_STYLE;

  return (
    <div
      // pointer-events-none: lane is purely visual, never receives clicks
      className="pointer-events-none h-full w-full"
      style={{
        background: s.bg,
        border: `2px solid ${s.border}`,
        borderRadius: 12,
      }}
    >
      {/* Group label banner */}
      <div
        className="px-4 py-2 text-[11px] font-semibold uppercase tracking-widest"
        style={{ color: s.headerColor }}
      >
        {data.label}
      </div>
    </div>
  );
}

const LaneNode = memo(LaneNodeInner);
LaneNode.displayName = 'LaneNode';

export default LaneNode;
