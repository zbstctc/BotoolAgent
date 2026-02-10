'use client';

import { useCallback, useRef, useMemo, useState, useEffect } from 'react';
import type { Node, Edge, NodeChange, EdgeChange, Connection } from '@xyflow/react';
import {
  ReactFlow,
  useNodesState,
  useEdgesState,
  Controls,
  Background,
  BackgroundVariant,
  MarkerType,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  reconnectEdge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './FlowChart.css';
import { CustomNode } from './CustomNode';
import { NoteNode } from './NoteNode';
import { createNode, createEdge, createNoteNode, getEdgeVisibility } from './utils';
import { ALL_STEPS, NOTES, POSITIONS, EDGE_CONNECTIONS } from './constants';
import type { StepStatus } from './types';
import type { AgentStatus, AgentStatusType } from '@/hooks/useAgentStatus';

const nodeTypes = { custom: CustomNode, note: NoteNode };

// Agent step represents which workflow phase the agent is in
// 'idle' = not started, 'running' = in loop, 'done' = completed all tasks
export type AgentPhase = 'idle' | 'running' | 'done';

interface FlowChartProps {
  agentPhase?: AgentPhase;
  agentStatus?: AgentStatus;
  currentIteration?: number;
  showControls?: boolean; // Whether to show step-by-step navigation controls
}

// Step index mapping:
// 0: 读取 prd.json
// 1: 初始化保护机制
// 2: 开始迭代 (检查 Rate Limit)
// 3: 启动 Claude 实例
// 4: Claude 执行任务
// 5: 结果处理
// 6: 响应分析
// 7: 记录进度日志
// 8: 双条件退出验证
// 9: 全部完成!

// Precise step status mapping based on AgentStatusType
function getStepStatusPrecise(stepIndex: number, agentStatusType: AgentStatusType, currentIteration: number, retryCount: number): StepStatus {
  // idle → all pending
  if (agentStatusType === 'idle') return 'pending';

  // complete → all completed
  if (agentStatusType === 'complete') return 'completed';

  // Setup steps (0-2): completed once agent starts running
  if (stepIndex < 3) {
    // Step 2 (检查 Rate Limit) is current when waiting_network
    if (stepIndex === 2 && agentStatusType === 'waiting_network') return 'current';
    return 'completed';
  }

  // Step 9 (全部完成!): only on 'complete' (handled above)
  if (stepIndex === 9) return 'pending';

  // Step 8 (双条件退出验证)
  if (stepIndex === 8) {
    if (agentStatusType === 'iteration_complete') return 'current';
    if (currentIteration > 0) return 'completed';
    return 'pending';
  }

  // Main loop steps (3-7) - precise mapping by status
  switch (agentStatusType) {
    case 'running':
      // running → highlight 启动 Claude 实例 (3) and Claude 执行任务 (4)
      if (stepIndex === 3) return 'completed';
      if (stepIndex === 4) return 'current';
      // Steps after current are pending, unless we've iterated
      if (stepIndex > 4 && currentIteration > 0) return 'completed';
      return 'pending';

    case 'waiting_network':
      // waiting_network → step 2 is current (handled above), loop steps completed up to check
      if (stepIndex <= 4) return 'completed';
      return 'pending';

    case 'timeout':
    case 'error':
    case 'failed':
      // Error states → highlight 结果处理 (5) with error status
      if (stepIndex <= 4) return 'completed';
      if (stepIndex === 5) return retryCount > 0 ? 'retry' : 'error';
      return 'pending';

    case 'iteration_complete':
      // iteration_complete → all loop steps completed, decision node is current (handled above)
      if (stepIndex <= 7) return 'completed';
      return 'pending';

    case 'max_iterations':
      // max_iterations → all loop steps completed, decision highlighted as error
      if (stepIndex <= 7) return 'completed';
      if (stepIndex === 8) return 'error';
      return 'pending';

    default:
      return 'pending';
  }
}

// Fallback: compute step status from coarse AgentPhase (for backward compat)
function getStepStatusFromPhase(stepIndex: number, agentPhase: AgentPhase, currentIteration: number): StepStatus {
  if (stepIndex < 3) {
    return agentPhase === 'idle' ? 'pending' : 'completed';
  }
  if (stepIndex === 9) {
    return agentPhase === 'done' ? 'completed' : 'pending';
  }
  if (stepIndex === 8) {
    if (agentPhase === 'done') return 'completed';
    if (agentPhase === 'running' && currentIteration > 0) return 'completed';
    return 'pending';
  }
  if (agentPhase === 'running') {
    if (stepIndex === 3) return 'current';
    return 'pending';
  }
  if (agentPhase === 'done') return 'completed';
  return 'pending';
}

// Unified getStepStatus: prefer precise mapping when agentStatus is available
function getStepStatus(
  stepIndex: number,
  agentPhase: AgentPhase,
  currentIteration: number,
  agentStatus?: AgentStatus
): StepStatus {
  if (agentStatus && agentStatus.status !== 'idle') {
    return getStepStatusPrecise(stepIndex, agentStatus.status, currentIteration, agentStatus.retryCount);
  }
  return getStepStatusFromPhase(stepIndex, agentPhase, currentIteration);
}

// Helper to compute nodes based on positions, visibility count, and agent state
function computeNodes(
  count: number,
  positions: Record<string, { x: number; y: number }>,
  agentPhase: AgentPhase = 'idle',
  currentIteration: number = 0,
  agentStatus?: AgentStatus
): Node[] {
  const stepNodes = ALL_STEPS.map((step, index) =>
    createNode(step, index < count, positions[step.id], getStepStatus(index, agentPhase, currentIteration, agentStatus))
  );
  const noteNodes = NOTES.map(note => {
    const noteVisible = count >= note.appearsWithStep;
    return createNoteNode(note, noteVisible, positions[note.id]);
  });
  return [...stepNodes, ...noteNodes];
}

function computeEdges(count: number): Edge[] {
  return EDGE_CONNECTIONS.map((conn) =>
    createEdge(conn, getEdgeVisibility(conn, count, ALL_STEPS))
  );
}

export function FlowChart({ agentPhase = 'idle', agentStatus, currentIteration = 0, showControls = false }: FlowChartProps) {
  const [visibleCount, setVisibleCount] = useState(ALL_STEPS.length); // Show all steps by default
  const nodePositions = useRef<Record<string, { x: number; y: number }>>({ ...POSITIONS });

  // Compute initial values using useMemo with static positions (safe during render)
  const initialNodes = useMemo(
    () => computeNodes(ALL_STEPS.length, POSITIONS, agentPhase, currentIteration, agentStatus),
    [agentPhase, currentIteration, agentStatus]
  );
  const initialEdges = useMemo(() => computeEdges(ALL_STEPS.length), []);

  const [nodes, setNodes] = useNodesState(initialNodes);
  const [edges, setEdges] = useEdgesState(initialEdges);

  // Update nodes when agentPhase, currentIteration, or agentStatus changes
  useEffect(() => {
    setNodes(computeNodes(visibleCount, nodePositions.current, agentPhase, currentIteration, agentStatus));
  }, [agentPhase, currentIteration, agentStatus, visibleCount, setNodes]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      changes.forEach((change) => {
        if (change.type === 'position' && 'position' in change && change.position) {
          nodePositions.current[change.id] = change.position;
        }
      });
      setNodes((nds) => applyNodeChanges(changes, nds));
    },
    [setNodes]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges((eds) => applyEdgeChanges(changes, eds));
    },
    [setEdges]
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            animated: true,
            style: { stroke: '#222', strokeWidth: 2 },
            markerEnd: { type: MarkerType.ArrowClosed, color: '#222' },
          },
          eds
        )
      );
    },
    [setEdges]
  );

  const onReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      setEdges((eds) => reconnectEdge(oldEdge, newConnection, eds));
    },
    [setEdges]
  );

  const handleNext = useCallback(() => {
    if (visibleCount < ALL_STEPS.length) {
      const newCount = visibleCount + 1;
      setVisibleCount(newCount);

      // Access ref in event handler (safe)
      setNodes(computeNodes(newCount, nodePositions.current, agentPhase, currentIteration, agentStatus));
      setEdges(computeEdges(newCount));
    }
  }, [visibleCount, setNodes, setEdges, agentPhase, currentIteration, agentStatus]);

  const handlePrev = useCallback(() => {
    if (visibleCount > 1) {
      const newCount = visibleCount - 1;
      setVisibleCount(newCount);

      // Access ref in event handler (safe)
      setNodes(computeNodes(newCount, nodePositions.current, agentPhase, currentIteration, agentStatus));
      setEdges(computeEdges(newCount));
    }
  }, [visibleCount, setNodes, setEdges, agentPhase, currentIteration, agentStatus]);

  const handleReset = useCallback(() => {
    setVisibleCount(ALL_STEPS.length);
    nodePositions.current = { ...POSITIONS };
    setNodes(computeNodes(ALL_STEPS.length, POSITIONS, agentPhase, currentIteration, agentStatus));
    setEdges(computeEdges(ALL_STEPS.length));
  }, [setNodes, setEdges, agentPhase, currentIteration, agentStatus]);

  return (
    <div className="flowchart-container">
      {showControls && (
        <div className="flowchart-header">
          <h1>BotoolAgent 工作流程</h1>
          <p>自主 AI 代理循环，自动完成 PRD 中的开发任务</p>
        </div>
      )}
      <div className="flowchart-flow">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onReconnect={onReconnect}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          nodesDraggable={true}
          nodesConnectable={showControls}
          edgesReconnectable={showControls}
          elementsSelectable={true}
          deleteKeyCode={showControls ? ['Backspace', 'Delete'] : []}
          panOnDrag={true}
          panOnScroll={true}
          zoomOnScroll={true}
          zoomOnPinch={true}
          zoomOnDoubleClick={true}
          selectNodesOnDrag={false}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#ddd" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      {showControls && (
        <>
          <div className="flowchart-controls">
            <button onClick={handlePrev} disabled={visibleCount <= 1}>
              Previous
            </button>
            <span className="flowchart-step-counter">
              Step {visibleCount} of {ALL_STEPS.length}
            </span>
            <button onClick={handleNext} disabled={visibleCount >= ALL_STEPS.length}>
              Next
            </button>
            <button onClick={handleReset} className="flowchart-reset-btn">
              Reset
            </button>
          </div>
          <div className="flowchart-instructions">
            Click Next to reveal each step
          </div>
        </>
      )}
    </div>
  );
}
