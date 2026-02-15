import { NextRequest, NextResponse } from 'next/server';
import type {
  SpecCodeExample,
  SpecTestCase,
  DevTaskEval,
  ConstitutionRule,
  EnrichedPrdJson,
  EnrichedDevTask,
  SessionGroup,
  TestCase,
} from '@/lib/tool-types';

// ============================================================================
// Types
// ============================================================================

interface AutoEnrichEval extends DevTaskEval {
  taskId?: string;
}

interface AutoEnrichResult {
  codeExamples: SpecCodeExample[];
  testCases: SpecTestCase[];
  filesToModify: string[];
  evals: AutoEnrichEval[];
  dependencies: { taskId: string; dependsOn: string[] }[];
  sessions: { id: string; tasks: string[]; reason?: string }[];
}

interface RuleInput {
  id: string;
  name: string;
  category: string;
  content?: string;
}

interface BasePrdJson {
  project: string;
  branchName: string;
  description: string;
  prdFile?: string;
  devTasks?: {
    id: string;
    title: string;
    prdSection?: string;
    description?: string;
    acceptanceCriteria?: string[];
    priority: number;
    passes: boolean;
    notes?: string;
    dependsOn?: string[];
    evals?: DevTaskEval[];
    testCases?: TestCase[];
  }[];
}

// ============================================================================
// Business logic
// ============================================================================

function deriveTestCases(task: {
  description?: string;
  acceptanceCriteria?: string[];
  title?: string;
}): TestCase[] {
  const testCases: TestCase[] = [];
  const allText = [task.title || '', task.description || '', ...(task.acceptanceCriteria || [])].join(' ');

  testCases.push({ type: 'typecheck', desc: 'TypeScript 编译通过' });

  if (/映射|转换|返回|计算|解析|格式化|过滤|排序/.test(allText)) {
    testCases.push({ type: 'unit', desc: '核心逻辑单元测试', tdd: true });
  }

  if (/页面|布局|渲染|显示|跳转|导航|加载|中文化|文案/.test(allText)) {
    testCases.push({ type: 'e2e', desc: '页面功能端到端测试' });
  }

  if (/动画|视觉|颜色|流畅|交互|体验|手动/.test(allText)) {
    testCases.push({ type: 'manual', desc: '视觉和交互手动验证' });
  }

  return testCases;
}

function generateDefaultSessions(tasks: EnrichedDevTask[]): SessionGroup[] {
  const MAX = 8;
  const sessions: SessionGroup[] = [];
  for (let i = 0; i < tasks.length; i += MAX) {
    const batch = tasks.slice(i, i + MAX);
    sessions.push({
      id: `S${sessions.length + 1}`,
      tasks: batch.map((t) => t.id),
      reason: '按优先级自动分组',
    });
  }
  return sessions;
}

function mergeEnrichedPrdJson(
  basePrdJson: BasePrdJson,
  enrichResult: AutoEnrichResult,
  rules: RuleInput[],
): EnrichedPrdJson {
  const constitutionRules: ConstitutionRule[] = rules.map((rule) => ({
    id: rule.id,
    name: rule.name,
    category: rule.category,
    content: rule.content,
  }));

  const enrichedTasks: EnrichedDevTask[] = (basePrdJson.devTasks || []).map((task) => {
    const taskEvals = enrichResult.evals
      .filter((ev) => ev.taskId === task.id)
      .map(({ taskId: _taskId, ...evalData }) => evalData);

    const depInfo = enrichResult.dependencies.find((d) => d.taskId === task.id);

    // Slim prd.json may already have testCases from convert API — use them if present
    const resolvedTestCases = task.testCases?.length
      ? task.testCases
      : deriveTestCases(task);

    // Slim prd.json may already have evals — merge with enriched evals
    const resolvedEvals = taskEvals.length ? taskEvals : (task.evals || []);

    // Slim prd.json may already have dependsOn
    const resolvedDeps = depInfo?.dependsOn || task.dependsOn || [];

    return {
      ...task,
      dependsOn: resolvedDeps,
      contextHint: '',
      spec: {
        codeExamples: enrichResult.codeExamples,
        testCases: enrichResult.testCases,
        filesToModify: enrichResult.filesToModify,
        relatedFiles: [],
      },
      evals: resolvedEvals,
      testCases: resolvedTestCases,
    };
  });

  return {
    project: basePrdJson.project,
    branchName: basePrdJson.branchName,
    description: basePrdJson.description,
    prdFile: basePrdJson.prdFile,
    constitution:
      constitutionRules.length > 0
        ? { rules: constitutionRules, ruleAuditSummary: '' }
        : undefined,
    devTasks: enrichedTasks,
    sessions: enrichResult.sessions?.length
      ? enrichResult.sessions
      : generateDefaultSessions(enrichedTasks),
  };
}

// ============================================================================
// API Handler
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const { basePrdJson, enrichResult, rules } = body as {
      basePrdJson: BasePrdJson;
      enrichResult: AutoEnrichResult;
      rules?: RuleInput[];
    };

    if (!basePrdJson) {
      return NextResponse.json({ error: 'basePrdJson is required' }, { status: 400 });
    }

    if (!basePrdJson.project || !basePrdJson.branchName || !Array.isArray(basePrdJson.devTasks)) {
      return NextResponse.json(
        { error: 'basePrdJson must contain project, branchName, and devTasks array' },
        { status: 400 },
      );
    }

    const result = mergeEnrichedPrdJson(basePrdJson, enrichResult || {
      codeExamples: [],
      testCases: [],
      filesToModify: [],
      evals: [],
      dependencies: [],
      sessions: [],
    }, rules || []);

    return NextResponse.json(result);
  } catch (error) {
    console.error('Merge API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
