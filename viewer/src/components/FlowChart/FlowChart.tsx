'use client';

import { useCallback, useState, useRef } from 'react';
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

const nodeTypes = { custom: CustomNode, note: NoteNode };

export function FlowChart() {
  const [visibleCount, setVisibleCount] = useState(1);
  const nodePositions = useRef<Record<string, { x: number; y: number }>>({ ...POSITIONS });

  const getNodes = useCallback((count: number): Node[] => {
    const stepNodes = ALL_STEPS.map((step, index) =>
      createNode(step, index < count, nodePositions.current[step.id])
    );
    const noteNodes = NOTES.map(note => {
      const noteVisible = count >= note.appearsWithStep;
      return createNoteNode(note, noteVisible, nodePositions.current[note.id]);
    });
    return [...stepNodes, ...noteNodes];
  }, []);

  const initialNodes = getNodes(1);
  const initialEdges = EDGE_CONNECTIONS.map((conn) =>
    createEdge(conn, false)
  );

  const [nodes, setNodes] = useNodesState(initialNodes);
  const [edges, setEdges] = useEdgesState(initialEdges);

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

      setNodes(getNodes(newCount));
      setEdges(
        EDGE_CONNECTIONS.map((conn) =>
          createEdge(conn, getEdgeVisibility(conn, newCount, ALL_STEPS))
        )
      );
    }
  }, [visibleCount, setNodes, setEdges, getNodes]);

  const handlePrev = useCallback(() => {
    if (visibleCount > 1) {
      const newCount = visibleCount - 1;
      setVisibleCount(newCount);

      setNodes(getNodes(newCount));
      setEdges(
        EDGE_CONNECTIONS.map((conn) =>
          createEdge(conn, getEdgeVisibility(conn, newCount, ALL_STEPS))
        )
      );
    }
  }, [visibleCount, setNodes, setEdges, getNodes]);

  const handleReset = useCallback(() => {
    setVisibleCount(1);
    nodePositions.current = { ...POSITIONS };
    setNodes(getNodes(1));
    setEdges(EDGE_CONNECTIONS.map((conn) => createEdge(conn, false)));
  }, [setNodes, setEdges, getNodes]);

  return (
    <div className="flowchart-container">
      <div className="flowchart-header">
        <h1>How Botool Agent Works</h1>
        <p>Autonomous AI agent loop for completing PRDs</p>
      </div>
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
          nodesConnectable={true}
          edgesReconnectable={true}
          elementsSelectable={true}
          deleteKeyCode={['Backspace', 'Delete']}
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
    </div>
  );
}
