'use client';

import { useMemo, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  type Edge,
  type NodeTypes,
} from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import '@xyflow/react/dist/style.css';
import FeatureNode from './FeatureNode';
import type { FeatureNodeData, FeatureNodeType } from './FeatureNode';
import type { ScanResult } from '@/types/scanner';

// --- Types ---

interface ScannerFlowChartProps {
  scanResult: ScanResult;
}

// --- Constants ---

const NODE_WIDTH = 280;
const NODE_HEIGHT = 180; // estimated height for dagre layout

// --- Node type registry (must be stable reference) ---

const nodeTypes: NodeTypes = {
  feature: FeatureNode,
};

// --- Layout ---

function layoutNodes(
  scanResult: ScanResult
): { nodes: FeatureNodeType[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 60 });

  // Add nodes to dagre graph
  for (const node of scanResult.nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }

  // Add edges to dagre graph
  for (const edge of scanResult.edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  // Map dagre positions to React Flow nodes
  const flowNodes: FeatureNodeType[] = scanResult.nodes.map((node) => {
    const pos = g.node(node.id);
    const data: FeatureNodeData = {
      ...node,
      changedInPR: false,
      changedFiles: scanResult.changedFiles,
    };

    return {
      id: node.id,
      type: 'feature' as const,
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - NODE_HEIGHT / 2,
      },
      data,
    };
  });

  const flowEdges: Edge[] = scanResult.edges.map((edge, idx) => ({
    id: `e-${edge.source}-${edge.target}-${idx}`,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    style: { stroke: '#a3a3a3', strokeWidth: 1.5 },
    animated: false,
  }));

  return { nodes: flowNodes, edges: flowEdges };
}

// --- Component ---

export function ScannerFlowChart({ scanResult }: ScannerFlowChartProps) {
  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => layoutNodes(scanResult),
    [scanResult]
  );

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  const onInit = useCallback((instance: { fitView: () => void }) => {
    // Wait a tick for nodes to be measured before fitting view
    setTimeout(() => instance.fitView(), 50);
  }, []);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      onInit={onInit}
      fitView
      proOptions={{ hideAttribution: true }}
      nodesDraggable
      nodesConnectable={false}
      elementsSelectable
      minZoom={0.2}
      maxZoom={2}
      className="bg-neutral-50"
    >
      <Background color="#e5e5e5" gap={20} />
      <Controls
        showInteractive={false}
        className="!bg-white !border-neutral-200 !shadow-sm"
      />
    </ReactFlow>
  );
}
