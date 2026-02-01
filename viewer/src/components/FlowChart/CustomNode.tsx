'use client';

import { Handle, Position } from '@xyflow/react';
import type { CustomNodeData } from './types';
import { PHASE_COLORS } from './constants';

interface CustomNodeProps {
  data: CustomNodeData;
}

export function CustomNode({ data }: CustomNodeProps) {
  const colors = PHASE_COLORS[data.phase];

  return (
    <div
      className="custom-node"
      style={{
        backgroundColor: colors.bg,
        borderColor: colors.border,
      }}
    >
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="target" position={Position.Left} id="left" />
      <Handle type="source" position={Position.Right} id="right" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="target" position={Position.Right} id="right-target" style={{ right: 0 }} />
      <Handle type="target" position={Position.Bottom} id="bottom-target" style={{ bottom: 0 }} />
      <Handle type="source" position={Position.Top} id="top-source" />
      <Handle type="source" position={Position.Left} id="left-source" />
      <div className="node-content">
        <div className="node-title">{data.title}</div>
        {data.description && <div className="node-description">{data.description}</div>}
      </div>
    </div>
  );
}
