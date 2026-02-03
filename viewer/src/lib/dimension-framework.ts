/**
 * 金字塔问答维度框架配置
 * 定义各层级的维度和话题
 */

// 层级定义
export type LevelId = 1 | 2 | 3 | 4;

export interface LevelConfig {
  id: LevelId;
  name: string;
  description: string;
  minQuestions: number;
  maxQuestions: number;
}

export const LEVELS: LevelConfig[] = [
  {
    id: 1,
    name: 'L1 核心识别',
    description: '明确需求类型、目标用户和核心价值',
    minQuestions: 4,
    maxQuestions: 6,
  },
  {
    id: 2,
    name: 'L2 领域分支',
    description: '确定涉及的技术领域和功能模块',
    minQuestions: 8,
    maxQuestions: 12,
  },
  {
    id: 3,
    name: 'L3 细节深入',
    description: '深入每个领域的具体实现细节',
    minQuestions: 8,
    maxQuestions: 12,
  },
  {
    id: 4,
    name: 'L4 边界确认',
    description: '确认需求边界、验收标准和非目标',
    minQuestions: 4,
    maxQuestions: 6,
  },
];

// L1 核心话题
export const L1_TOPICS = [
  {
    id: 'requirement-type',
    name: '需求类型',
    description: '明确是新功能、改进还是修复',
  },
  {
    id: 'target-user',
    name: '目标用户',
    description: '谁会使用这个功能',
  },
  {
    id: 'core-problem',
    name: '核心问题',
    description: '这个功能解决什么问题',
  },
  {
    id: 'success-criteria',
    name: '成功标准',
    description: '如何判断功能成功',
  },
  {
    id: 'urgency',
    name: '紧急程度',
    description: '时间要求和优先级',
  },
];

// L2 维度定义
export interface DimensionConfig {
  id: string;
  name: string;
  description: string;
  triggerKeywords: string[];
  topics: { id: string; name: string; description: string }[];
}

export const L2_DIMENSIONS: DimensionConfig[] = [
  {
    id: 'frontend',
    name: '前端/界面',
    description: '用户界面和交互相关',
    triggerKeywords: ['界面', 'UI', '页面', '按钮', '表单', '显示', '样式', '布局', '响应式', '移动端'],
    topics: [
      { id: 'ui-components', name: '界面组件', description: '需要哪些 UI 组件' },
      { id: 'layout', name: '布局结构', description: '页面布局方式' },
      { id: 'interaction', name: '交互方式', description: '用户如何与界面交互' },
      { id: 'responsive', name: '响应式需求', description: '不同设备的适配' },
    ],
  },
  {
    id: 'backend',
    name: '后端/数据',
    description: '数据处理和服务端逻辑',
    triggerKeywords: ['数据', '存储', 'API', '接口', '服务', '数据库', '查询', '保存', '同步'],
    topics: [
      { id: 'data-model', name: '数据模型', description: '需要哪些数据结构' },
      { id: 'api-design', name: 'API 设计', description: '需要哪些接口' },
      { id: 'data-flow', name: '数据流转', description: '数据如何流转处理' },
      { id: 'persistence', name: '数据持久化', description: '数据如何存储' },
    ],
  },
  {
    id: 'ux',
    name: '用户体验',
    description: '用户使用流程和体验',
    triggerKeywords: ['流程', '步骤', '引导', '提示', '反馈', '错误处理', '加载', '体验'],
    topics: [
      { id: 'user-flow', name: '用户流程', description: '用户操作步骤' },
      { id: 'feedback', name: '状态反馈', description: '如何提示用户状态' },
      { id: 'error-handling', name: '错误处理', description: '异常情况如何处理' },
      { id: 'accessibility', name: '可访问性', description: '无障碍相关需求' },
    ],
  },
  {
    id: 'architecture',
    name: '架构/集成',
    description: '系统架构和外部集成',
    triggerKeywords: ['集成', '第三方', '权限', '安全', '性能', '扩展', '模块', '依赖'],
    topics: [
      { id: 'integration', name: '外部集成', description: '需要对接哪些外部系统' },
      { id: 'permissions', name: '权限控制', description: '访问权限要求' },
      { id: 'performance', name: '性能要求', description: '性能和响应时间要求' },
      { id: 'scalability', name: '扩展性', description: '未来扩展考虑' },
    ],
  },
];

// L4 边界确认话题
export const L4_TOPICS = [
  {
    id: 'in-scope',
    name: '范围内',
    description: '明确包含在本次需求内的内容',
  },
  {
    id: 'out-scope',
    name: '范围外',
    description: '明确不包含在本次需求内的内容',
  },
  {
    id: 'acceptance-criteria',
    name: '验收标准',
    description: '如何验证功能完成',
  },
  {
    id: 'dependencies',
    name: '依赖条件',
    description: '功能实现的前置依赖',
  },
  {
    id: 'risks',
    name: '风险点',
    description: '可能的风险和挑战',
  },
];

// 根据用户回答确定激活的维度
export function getActiveDimensions(
  l1Answers: Record<string, string | string[]>,
  description: string
): string[] {
  const activeDimensions: string[] = [];
  const lowerDesc = description.toLowerCase();

  L2_DIMENSIONS.forEach(dim => {
    // 检查是否有触发词匹配
    const hasKeyword = dim.triggerKeywords.some(keyword =>
      lowerDesc.includes(keyword.toLowerCase())
    );

    if (hasKeyword) {
      activeDimensions.push(dim.id);
    }
  });

  // 如果没有匹配任何维度，默认激活前端和用户体验
  if (activeDimensions.length === 0) {
    activeDimensions.push('frontend', 'ux');
  }

  return activeDimensions;
}

// 获取层级的问题数量约束
export function getQuestionConstraints(level: LevelId): { min: number; max: number } {
  const config = LEVELS.find(l => l.id === level);
  return config
    ? { min: config.minQuestions, max: config.maxQuestions }
    : { min: 4, max: 6 };
}

// 类型定义
export interface QuestionOption {
  value: string;
  label: string;
}

export interface GeneratedQuestion {
  id: string;
  text: string;
  type: 'single' | 'multiple' | 'text';
  options?: QuestionOption[];
  required: boolean;
  dimension?: string;
  topic?: string;
}
