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

  const isError = status === 'error';
  const isRetry = status === 'retry';
  const isCurrent = status === 'current';
  const isCompleted = status === 'completed';

  // Determine border color based on status
  const borderColor = isCurrent
    ? '#3b82f6'
    : isError
    ? '#ef4444'
    : isRetry
    ? '#f97316'
    : colors.border;

  // CSS class for animations
  const nodeClass = [
    'custom-node',
    isCurrent ? 'custom-node-current' : '',
    isError || isRetry ? 'custom-node-error' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={nodeClass}
      style={{
        backgroundColor: isError ? '#fef2f2' : isRetry ? '#fff7ed' : colors.bg,
        borderColor,
        borderWidth: isCurrent || isError || isRetry ? 3 : 2,
        opacity: isCompleted ? 0.9 : 1,
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
          {isCompleted && <span style={{ color: '#22c55e', marginRight: 6 }}>✓</span>}
          {isCurrent && <span style={{ color: '#3b82f6', marginRight: 6 }}>●</span>}
          {isError && <span style={{ color: '#ef4444', marginRight: 6 }}>✗</span>}
          {isRetry && <span style={{ color: '#f97316', marginRight: 6 }}>↻</span>}
          {data.title}
        </div>
        {data.description && <div className="node-description">{data.description}</div>}
      </div>
    </div>
  );
}
