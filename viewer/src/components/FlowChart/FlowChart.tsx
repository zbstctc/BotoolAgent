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

const nodeTypes = { custom: CustomNode, note: NoteNode };

// Agent step represents which workflow phase the agent is in
// 'idle' = not started, 'running' = in loop, 'done' = completed all tasks
export type AgentPhase = 'idle' | 'running' | 'done';

interface FlowChartProps {
  agentPhase?: AgentPhase;
  currentIteration?: number;
  showControls?: boolean; // Whether to show step-by-step navigation controls
}

// Compute step status based on agent phase and iteration count
function getStepStatus(stepIndex: number, agentPhase: AgentPhase, currentIteration: number): StepStatus {
  // Steps 1-3 are setup: completed once agent is running or done
  if (stepIndex < 3) {
    return agentPhase === 'idle' ? 'pending' : 'completed';
  }

  // Step 10 (index 9) is "Done!" - only completed when all tasks are done
  if (stepIndex === 9) {
    return agentPhase === 'done' ? 'completed' : 'pending';
  }

  // Step 9 (index 8) is "More stories?" decision node
  if (stepIndex === 8) {
    if (agentPhase === 'done') return 'completed';
    // After iterations, the decision was made (answered "Yes" to continue)
    if (agentPhase === 'running' && currentIteration > 0) return 'completed';
    return 'pending';
  }

  // Steps 4-8 (indexes 3-7) are the main loop steps
  if (agentPhase === 'running') {
    // Highlight step 4 (AI picks a story) as current during running
    if (stepIndex === 3) return 'current';
    // Other loop steps show as pending
    return 'pending';
  }

  if (agentPhase === 'done') {
    // All loop steps completed when done
    return 'completed';
  }

  return 'pending';
}

// Helper to compute nodes based on positions, visibility count, and agent state
function computeNodes(
  count: number,
  positions: Record<string, { x: number; y: number }>,
  agentPhase: AgentPhase = 'idle',
  currentIteration: number = 0
): Node[] {
  const stepNodes = ALL_STEPS.map((step, index) =>
    createNode(step, index < count, positions[step.id], getStepStatus(index, agentPhase, currentIteration))
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

export function FlowChart({ agentPhase = 'idle', currentIteration = 0, showControls = false }: FlowChartProps) {
  const [visibleCount, setVisibleCount] = useState(ALL_STEPS.length); // Show all steps by default
  const nodePositions = useRef<Record<string, { x: number; y: number }>>({ ...POSITIONS });

  // Compute initial values using useMemo with static positions (safe during render)
  const initialNodes = useMemo(
    () => computeNodes(ALL_STEPS.length, POSITIONS, agentPhase, currentIteration),
    [agentPhase, currentIteration]
  );
  const initialEdges = useMemo(() => computeEdges(ALL_STEPS.length), []);

  const [nodes, setNodes] = useNodesState(initialNodes);
  const [edges, setEdges] = useEdgesState(initialEdges);

  // Update nodes when agentPhase or currentIteration changes
  useEffect(() => {
    setNodes(computeNodes(visibleCount, nodePositions.current, agentPhase, currentIteration));
  }, [agentPhase, currentIteration, visibleCount, setNodes]);

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
      setNodes(computeNodes(newCount, nodePositions.current, agentPhase, currentIteration));
      setEdges(computeEdges(newCount));
    }
  }, [visibleCount, setNodes, setEdges, agentPhase, currentIteration]);

  const handlePrev = useCallback(() => {
    if (visibleCount > 1) {
      const newCount = visibleCount - 1;
      setVisibleCount(newCount);

      // Access ref in event handler (safe)
      setNodes(computeNodes(newCount, nodePositions.current, agentPhase, currentIteration));
      setEdges(computeEdges(newCount));
    }
  }, [visibleCount, setNodes, setEdges, agentPhase, currentIteration]);

  const handleReset = useCallback(() => {
    setVisibleCount(ALL_STEPS.length);
    nodePositions.current = { ...POSITIONS };
    setNodes(computeNodes(ALL_STEPS.length, POSITIONS, agentPhase, currentIteration));
    setEdges(computeEdges(ALL_STEPS.length));
  }, [setNodes, setEdges, agentPhase, currentIteration]);

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
