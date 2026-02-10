import type { Phase, StepData, NoteData, EdgeConnection } from './types';

export const NODE_WIDTH = 240;
export const NODE_HEIGHT = 70;

export const PHASE_COLORS: Record<Phase, { bg: string; border: string }> = {
  setup: { bg: '#f0f7ff', border: '#4a90d9' },
  loop: { bg: '#f5f5f5', border: '#666666' },
  decision: { bg: '#fff8e6', border: '#c9a227' },
  done: { bg: '#f0fff4', border: '#38a169' },
};

export const ALL_STEPS: StepData[] = [
  // 准备阶段
  { id: '1', label: '读取 prd.json', description: '加载任务列表和进度日志', phase: 'setup' },
  { id: '2', label: '初始化保护机制', description: 'Rate Limit / Circuit Breaker / 超时', phase: 'setup' },
  { id: '3', label: '开始迭代', description: '检查 Rate Limit 和网络连通', phase: 'setup' },
  // 迭代循环
  { id: '4', label: '启动 Claude 实例', description: '全新上下文，带超时和健康监控', phase: 'loop' },
  { id: '5', label: 'Claude 执行任务', description: '选任务 → 编码 → 测试 → 提交 → 推送', phase: 'loop' },
  { id: '6', label: '结果处理', description: '超时/错误 → 自动重试（最多3次）', phase: 'loop' },
  { id: '7', label: '响应分析', description: '统计任务进度，更新状态', phase: 'loop' },
  { id: '8', label: '记录进度日志', description: '追加到 progress.txt', phase: 'loop' },
  { id: '9', label: '双条件退出验证', description: 'COMPLETE 承诺 + prd.json 状态', phase: 'decision' },
  // 退出
  { id: '10', label: '全部完成!', description: '所有任务 passes: true', phase: 'done' },
];

export const NOTES: NoteData[] = [
  {
    id: 'note-1',
    appearsWithStep: 2,
    position: { x: 340, y: 100 },
    color: { bg: '#f5f0ff', border: '#8b5cf6' },
    content: `{
  "id": "DT-001",
  "title": "创建数据库表",
  "acceptanceCriteria": [
    "新增 priority 列",
    "生成并运行迁移",
    "类型检查通过"
  ],
  "passes": false
}`,
  },
  {
    id: 'note-2',
    appearsWithStep: 8,
    position: { x: 480, y: 620 },
    color: { bg: '#fdf4f0', border: '#c97a50' },
    content: `双条件验证机制：
1. Claude 输出 <promise>COMPLETE</promise>
2. prd.json 所有 passes: true
两个条件都满足才安全退出`,
  },
];

export const POSITIONS: Record<string, { x: number; y: number }> = {
  // 准备阶段（左侧垂直）
  '1': { x: 20, y: 20 },
  '2': { x: 80, y: 130 },
  '3': { x: 60, y: 250 },
  // 迭代循环
  '4': { x: 40, y: 420 },
  '5': { x: 450, y: 300 },
  '6': { x: 750, y: 450 },
  '7': { x: 470, y: 520 },
  '8': { x: 200, y: 620 },
  '9': { x: 40, y: 720 },
  // 退出
  '10': { x: 350, y: 880 },
  // 注释
  ...Object.fromEntries(NOTES.map(n => [n.id, n.position])),
};

export const EDGE_CONNECTIONS: EdgeConnection[] = [
  // 准备阶段（垂直连接）
  { source: '1', target: '2', sourceHandle: 'bottom', targetHandle: 'top' },
  { source: '2', target: '3', sourceHandle: 'bottom', targetHandle: 'top' },
  { source: '3', target: '4', sourceHandle: 'bottom', targetHandle: 'top' },
  // 迭代循环
  { source: '4', target: '5', sourceHandle: 'right', targetHandle: 'left' },
  { source: '5', target: '6', sourceHandle: 'right', targetHandle: 'top' },
  { source: '6', target: '7', sourceHandle: 'left-source', targetHandle: 'right-target' },
  { source: '7', target: '8', sourceHandle: 'left-source', targetHandle: 'right-target' },
  { source: '8', target: '9', sourceHandle: 'left-source', targetHandle: 'right-target' },
  { source: '9', target: '4', sourceHandle: 'top-source', targetHandle: 'bottom-target', label: '未通过' },
  // 退出
  { source: '9', target: '10', sourceHandle: 'bottom', targetHandle: 'top', label: '通过' },
];
