'use client';

import { useMemo, useCallback, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  PanOnScrollMode,
  useNodesState,
  useEdgesState,
  type Edge,
  type NodeTypes,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import FeatureNode from './FeatureNode';
import type { FeatureNodeData, FeatureNodeType } from './FeatureNode';
import LaneNode from './LaneNode';
import type { LaneNodeType } from './LaneNode';
import type { ScanNode, ScanResult } from '@/types/scanner';

// --- Types ---

interface ScannerFlowChartProps {
  scanResult: ScanResult;
}

type FlowNode = FeatureNodeType | LaneNodeType | Node;

// --- Layout constants ---

const NODE_W = 280;
const NODE_H = 180;  // estimated card height
const H_GAP = 30;    // horizontal gap between nodes within a lane
const V_GAP = 30;    // vertical gap between node rows within a lane
const ITEMS_PER_ROW = 3;
const LANE_PAD = { top: 46, right: 30, bottom: 28, left: 30 };
const LANE_GAP = 36;     // vertical gap between lanes
const ROOT_GAP = 56;     // gap between root and first lane
const ROOT_Y = 20;

// --- Group config ---

const DEFAULT_GROUP_ORDER = ['frontend', 'backend', 'agent', 'infra'];

const DEFAULT_GROUP_LABELS: Record<string, string> = {
  frontend: '前端界面层',
  backend:  '服务 & API 层',
  agent:    'Agent 执行层',
  infra:    '基础设施层',
};

interface GroupConfig {
  id: string;
  label: string;
  nodeIds: string[];
}

/** Infer a node's group from its type, id, and path when node.group is absent. */
function inferGroup(node: ScanNode): string {
  const id = node.id.toLowerCase();
  const p = (node.path ?? '').toLowerCase();

  if (node.type === 'utility' || node.type === 'config') return 'infra';
  if (p.includes('/contexts') || (p.includes('viewer/src/app') && !p.includes('/api')))
    return 'frontend';
  if (p.includes('/api') || id.includes('test') || id.includes('e2e')) return 'backend';
  if (p.includes('scripts/') || p.includes('skills/') || id.includes('agent') || id.includes('skill'))
    return 'agent';
  if (p === 'tasks' || p.startsWith('tasks/') || p === 'rules' || p.startsWith('rules/'))
    return 'infra';
  if (id.includes('context') || id.includes('state') || id.includes('viewer-app')) return 'frontend';
  if (id.includes('api') || id.includes('scanner')) return 'backend';
  return 'infra';
}

function buildGroupConfigs(scanResult: ScanResult): GroupConfig[] {
  // Build label map: prefer scanResult.groups, fall back to defaults
  const labelMap = new Map<string, string>(
    Object.entries(DEFAULT_GROUP_LABELS)
  );
  if (scanResult.groups) {
    for (const g of scanResult.groups) labelMap.set(g.id, g.label);
  }

  // Determine ordering: scanResult.groups order first, then defaults
  const order: string[] = scanResult.groups
    ? scanResult.groups.map((g) => g.id)
    : DEFAULT_GROUP_ORDER;

  // Collect nodes per group
  const grouped = new Map<string, string[]>();
  for (const node of scanResult.nodes) {
    if (node.type === 'root') continue;
    const gid = node.group ?? inferGroup(node);
    if (!grouped.has(gid)) grouped.set(gid, []);
    grouped.get(gid)!.push(node.id);
  }

  const result: GroupConfig[] = [];
  const seen = new Set<string>();

  // Ordered groups first
  for (const gid of order) {
    if (grouped.has(gid)) {
      result.push({ id: gid, label: labelMap.get(gid) ?? gid, nodeIds: grouped.get(gid)! });
      seen.add(gid);
    }
  }
  // Any extra groups not in ordering
  for (const [gid, ids] of grouped) {
    if (!seen.has(gid)) {
      result.push({ id: gid, label: labelMap.get(gid) ?? gid, nodeIds: ids });
    }
  }

  return result;
}

// --- Layout ---

function layoutNodes(scanResult: ScanResult): { nodes: FlowNode[]; edges: Edge[] } {
  const nodeMap = new Map(scanResult.nodes.map((n) => [n.id, n]));
  const rootNode = scanResult.nodes.find((n) => n.type === 'root');
  const groupConfigs = buildGroupConfigs(scanResult);

  // Lane width: all lanes share the same width (based on max columns across groups)
  const maxCols = Math.min(
    ITEMS_PER_ROW,
    Math.max(...groupConfigs.map((g) => g.nodeIds.length), 1)
  );
  const laneWidth =
    LANE_PAD.left + maxCols * NODE_W + (maxCols - 1) * H_GAP + LANE_PAD.right;

  const allNodes: FlowNode[] = [];

  // ── Root node (centered above all lanes) ─────────────────────────────────
  if (rootNode) {
    const rootData: FeatureNodeData = {
      ...rootNode,
      changedInPR: false,
      changedFiles: scanResult.changedFiles,
    };
    allNodes.push({
      id: rootNode.id,
      type: 'feature' as const,
      position: { x: (laneWidth - NODE_W) / 2, y: ROOT_Y },
      data: rootData,
    } as FeatureNodeType);
  }

  // ── Lanes (stacked vertically) ────────────────────────────────────────────
  let currentY = rootNode ? ROOT_Y + NODE_H + ROOT_GAP : ROOT_Y;

  for (const group of groupConfigs) {
    const numRows = Math.ceil(group.nodeIds.length / ITEMS_PER_ROW);
    const laneHeight =
      LANE_PAD.top +
      numRows * NODE_H +
      (numRows - 1) * V_GAP +
      LANE_PAD.bottom;

    // Background lane node
    allNodes.push({
      id: `lane-${group.id}`,
      type: 'lane' as const,
      position: { x: 0, y: currentY },
      data: { label: group.label, groupId: group.id },
      style: { width: laneWidth, height: laneHeight },
      zIndex: -1,
      selectable: false,
      draggable: false,
      focusable: false,
      connectable: false,
    } as LaneNodeType);

    // Feature nodes inside lane — positions relative to lane
    group.nodeIds.forEach((nodeId, idx) => {
      const node = nodeMap.get(nodeId);
      if (!node) return;

      const col = idx % ITEMS_PER_ROW;
      const row = Math.floor(idx / ITEMS_PER_ROW);

      const changedInPR =
        Array.isArray(scanResult.changedFiles) &&
        scanResult.changedFiles.length > 0 &&
        scanResult.changedFiles.some(
          (file) => file === node.path || file.startsWith(node.path + '/')
        );

      const data: FeatureNodeData = {
        ...node,
        changedInPR,
        changedFiles: scanResult.changedFiles,
      };

      allNodes.push({
        id: nodeId,
        type: 'feature' as const,
        parentId: `lane-${group.id}`,
        extent: 'parent' as const,
        position: {
          x: LANE_PAD.left + col * (NODE_W + H_GAP),
          y: LANE_PAD.top + row * (NODE_H + V_GAP),
        },
        data,
      } as FeatureNodeType);
    });

    currentY += laneHeight + LANE_GAP;
  }

  // ── Edges ─────────────────────────────────────────────────────────────────
  const flowEdges: Edge[] = scanResult.edges.map((edge, idx) => ({
    id: `e-${edge.source}-${edge.target}-${idx}`,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    style: { stroke: '#a3a3a3', strokeWidth: 1.5 },
    animated: false,
  }));

  return { nodes: allNodes, edges: flowEdges };
}

// --- Node type registry (must be stable reference) ---

const nodeTypes: NodeTypes = {
  feature: FeatureNode,
  lane: LaneNode,
};

// --- Component ---

export function ScannerFlowChart({ scanResult }: ScannerFlowChartProps) {
  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => layoutNodes(scanResult),
    [scanResult]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Sync when scanResult changes (e.g. after re-analysis)
  useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);

  useEffect(() => {
    setEdges(initialEdges);
  }, [initialEdges, setEdges]);

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
      panOnScroll
      panOnScrollMode={PanOnScrollMode.Free}
      minZoom={0.1}
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
