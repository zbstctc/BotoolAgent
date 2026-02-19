export type RequirementStage = 0 | 1 | 2 | 3 | 4 | 5;
export type RequirementStatus = 'active' | 'completed' | 'archived';

export interface Requirement {
  id: string;                     // UUID
  name: string;                   // 需求标题
  stage: RequirementStage;        // 当前阶段
  status: RequirementStatus;

  // Stage 0 data
  sourceFile?: string;            // 原始文件路径 (DRAFT-*.md 或导入的 .md)
  description?: string;           // 用户描述

  // Stage 1 data
  prdId?: string;                 // 生成的 PRD 文件 ID
  prdSessionId?: string;          // 金字塔问答会话 ID

  // Stage 2 data
  prdJsonPath?: string;           // prd.json 路径
  taskCount?: number;             // 总任务数

  // Stage 3-5 data
  branchName?: string;            // Git 分支名
  tasksCompleted?: number;        // 已完成任务数
  prUrl?: string;                 // PR URL

  // Meta
  createdAt: number;
  updatedAt: number;
}

export type RequirementFilter = 'active' | 'archived';

export interface StageMeta {
  label: string;          // 主标签
  labelCompleted?: string; // 完成状态标签 (Stage 1, 5)
  badgeVariant: 'neutral' | 'warning' | 'success' | 'default';
}

export const STAGE_META: StageMeta[] = [
  { label: '草稿', badgeVariant: 'neutral' },
  { label: 'PRD 生成中', labelCompleted: 'PRD 已完成', badgeVariant: 'warning' },
  { label: '待开发', badgeVariant: 'warning' },
  { label: '开发中', labelCompleted: '开发完成', badgeVariant: 'default' },
  { label: '测试中', badgeVariant: 'warning' },
  { label: '待合并', labelCompleted: '已完成', badgeVariant: 'success' },
];
