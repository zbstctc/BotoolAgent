import type { Node, Edge } from '@xyflow/react';
import { MarkerType } from '@xyflow/react';
import type { StepData, NoteData, EdgeConnection, CustomNodeData, NoteNodeData, StepStatus } from './types';
import { NODE_WIDTH, NODE_HEIGHT, POSITIONS } from './constants';

export function createNode(
  step: StepData,
  visible: boolean,
  position?: { x: number; y: number },
  status?: StepStatus
): Node<CustomNodeData> {
  return {
    id: step.id,
    type: 'custom',
    position: position || POSITIONS[step.id],
    data: {
      title: step.label,
      description: step.description,
      phase: step.phase,
      status: status || 'pending',
    },
    style: {
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      opacity: visible ? 1 : 0,
      transition: 'opacity 0.5s ease-in-out',
      pointerEvents: visible ? 'auto' : 'none',
    },
  };
}

export function createEdge(conn: EdgeConnection, visible: boolean): Edge {
  return {
    id: `e${conn.source}-${conn.target}`,
    source: conn.source,
    target: conn.target,
    sourceHandle: conn.sourceHandle,
    targetHandle: conn.targetHandle,
    label: visible ? conn.label : undefined,
    animated: visible,
    style: {
      stroke: '#222',
      strokeWidth: 2,
      opacity: visible ? 1 : 0,
      transition: 'opacity 0.5s ease-in-out',
    },
    labelStyle: {
      fill: '#222',
      fontWeight: 600,
      fontSize: 14,
    },
    labelShowBg: true,
    labelBgPadding: [8, 4] as [number, number],
    labelBgStyle: {
      fill: '#fff',
      stroke: '#222',
      strokeWidth: 1,
    },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: '#222',
    },
  };
}

export function createNoteNode(
  note: NoteData,
  visible: boolean,
  position?: { x: number; y: number }
): Node<NoteNodeData> {
  return {
    id: note.id,
    type: 'note',
    position: position || POSITIONS[note.id],
    data: { content: note.content, color: note.color },
    style: {
      opacity: visible ? 1 : 0,
      transition: 'opacity 0.5s ease-in-out',
      pointerEvents: visible ? 'auto' : 'none',
    },
    draggable: true,
    selectable: false,
    connectable: false,
  };
}

export function getEdgeVisibility(
  conn: EdgeConnection,
  visibleStepCount: number,
  allSteps: StepData[]
): boolean {
  const sourceIndex = allSteps.findIndex(s => s.id === conn.source);
  const targetIndex = allSteps.findIndex(s => s.id === conn.target);
  return sourceIndex < visibleStepCount && targetIndex < visibleStepCount;
}
