'use client';

import { Handle, Position } from '@xyflow/react';
import type { CustomNodeData } from './types';
import { PHASE_COLORS } from './constants';

interface CustomNodeProps {
  data: CustomNodeData;
}

export function CustomNode({ data }: CustomNodeProps) {
  const colors = PHASE_COLORS[data.phase];
  const status = data.status || 'pending';

  // Status-based styling
  const statusStyles = {
    current: {
      boxShadow: '0 0 0 3px rgba(59, 130, 246, 0.5)',
      animation: 'pulse 2s infinite',
    },
    completed: {
      opacity: 0.9,
    },
    pending: {},
  };

  return (
    <div
      className={`custom-node ${status === 'current' ? 'custom-node-current' : ''}`}
      style={{
        backgroundColor: colors.bg,
        borderColor: status === 'current' ? '#3b82f6' : colors.border,
        borderWidth: status === 'current' ? 3 : 2,
        ...statusStyles[status],
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
        <div className="node-title">
          {status === 'completed' && <span style={{ color: '#22c55e', marginRight: 6 }}>✓</span>}
          {status === 'current' && <span style={{ color: '#3b82f6', marginRight: 6 }}>●</span>}
          {data.title}
        </div>
        {data.description && <div className="node-description">{data.description}</div>}
      </div>
    </div>
  );
}
