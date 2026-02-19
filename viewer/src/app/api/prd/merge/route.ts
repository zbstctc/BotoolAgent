import { NextRequest, NextResponse } from 'next/server';
import { readFile, writeFile, rename } from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
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
import { getBotoolRoot } from '@/lib/project-root';

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
  file?: string;        // 新模式: 规范文件路径
  checklist?: string[]; // 新模式: 检查项列表
  content?: string;     // 旧模式: 完整内容 (向后兼容)
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
    // 新模式: file + checklist; 旧模式: content (Q4 向后兼容)
    file: rule.file || '',
    checklist: rule.checklist || [],
    content: rule.content,
  }));

  const enrichedTasks: EnrichedDevTask[] = (basePrdJson.devTasks || []).map((task) => {
    const taskEvals = enrichResult.evals
      .filter((ev) => ev.taskId === task.id)
      .map((ev) => {
        const evalData = { ...ev };
        delete evalData.taskId;
        return evalData;
      });

    const depInfo = enrichResult.dependencies.find((d) => d.taskId === task.id);

    // Slim prd.json may already have testCases from convert API — use them if present
    const resolvedTestCases = task.testCases?.length
      ? task.testCases
      : deriveTestCases(task);

    // Slim prd.json may already have evals — merge with enriched evals
    const resolvedEvals = taskEvals.length ? taskEvals : (task.evals || []);

    // Slim prd.json may already have dependsOn
    const resolvedDeps = depInfo?.dependsOn || task.dependsOn || [];

    // Filter codeExamples by taskId — only assign examples belonging to this task.
    // Examples without a taskId are treated as universal and included for all tasks (backward compat).
    const taskExamples = enrichResult.codeExamples.filter(
      (ex) => ex.taskId === task.id || !ex.taskId,
    );

    return {
      ...task,
      dependsOn: resolvedDeps,
      contextHint: '',
      spec: {
        codeExamples: taskExamples,
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
// 从 content 自动提取 checklist（兼容旧模式：前端只传 content 时自动补全）
// ============================================================================

const CHECKLIST_HEADING_PATTERNS = /核心规则|检查项|规范|checklist|要点|must|required|必须/i;

function deriveChecklistFromContent(content: string): string[] {
  const lines = content.split('\n');
  const items: string[] = [];
  let inRelevantSection = false;

  for (const line of lines) {
    // Detect relevant headings
    if (/^#{1,4}\s/.test(line) && CHECKLIST_HEADING_PATTERNS.test(line)) {
      inRelevantSection = true;
      continue;
    }
    // Exit section at next heading
    if (/^#{1,4}\s/.test(line)) {
      inRelevantSection = false;
      continue;
    }
    // Collect list items (- xxx or * xxx or 1. xxx)
    const listMatch = line.match(/^\s*[-*]\s+(.+)/) || line.match(/^\s*\d+\.\s+(.+)/);
    if (listMatch && listMatch[1].length > 4 && listMatch[1].length < 120) {
      // Prefer items from relevant sections, but also collect top-level items
      if (inRelevantSection || /^[-*]\s/.test(line)) {
        items.push(listMatch[1].trim());
      }
    }
  }

  // Return up to 8 items, prioritizing shorter actionable items
  return items
    .sort((a, b) => a.length - b.length)
    .slice(0, 8);
}

function deriveFileFromRule(rule: RuleInput): string {
  if (rule.file) return rule.file;
  // Derive from category/name: rules/{category}/{name}.md
  const cat = rule.category.toLowerCase().replace(/\s+/g, '-');
  const name = rule.name.replace(/\s+/g, '-');
  return `rules/${cat}/${name}.md`;
}

/**
 * Ensure each rule has file + checklist populated.
 * If frontend only sent content (old mode), auto-derive these fields.
 */
function ensureRuleFields(rules: RuleInput[]): RuleInput[] {
  return rules.map((rule) => {
    const hasChecklist = rule.checklist && rule.checklist.length > 0;
    return {
      ...rule,
      file: rule.file || deriveFileFromRule(rule),
      checklist: hasChecklist
        ? rule.checklist
        : rule.content
          ? deriveChecklistFromContent(rule.content)
          : [],
    };
  });
}

// ============================================================================
// 规范融合 — 将规范 checklist 注入 PRD.md §7 (best-effort)
// ============================================================================

/**
 * Inject [规范] acceptance-criteria entries into PRD.md §7 (开发计划).
 *
 * For each Phase heading (### 7.x) → add "适用规范" header with matched rules.
 * For each DT checkbox (- [ ] DT-xxx) → append [规范] checklist items from
 * matching rules based on category keywords in the DT block.
 *
 * This is a best-effort operation: if the file doesn't exist, the format
 * doesn't match, or any I/O error occurs, we silently skip.
 */
async function fuseRulesIntoPrdMd(
  prdFilePath: string,
  rules: RuleInput[],
): Promise<void> {
  // Only rules with checklist items are useful for fusion
  const fusableRules = rules.filter((r) => r.checklist && r.checklist.length > 0);
  if (fusableRules.length === 0) return;

  const botoolRoot = getBotoolRoot();
  const absolutePath = path.resolve(botoolRoot, prdFilePath);
  // Guard: resolved path must stay within project root (prevent path traversal)
  if (!absolutePath.startsWith(botoolRoot + path.sep) && absolutePath !== botoolRoot) {
    console.warn(`[fuseRulesIntoPrdMd] Path traversal blocked: ${prdFilePath}`);
    return;
  }
  if (!existsSync(absolutePath)) return;

  const original = await readFile(absolutePath, 'utf-8');
  const lines = original.split('\n');

  // ---- Locate §7 boundary ----
  let section7Start = -1;
  let section7End = lines.length; // default: until end of file
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match "## 7." or "## 7 " (section 7 heading)
    if (/^##\s+7[\.\s]/.test(line)) {
      section7Start = i;
      continue;
    }
    // If we're past §7 and hit another §N (N>=8), that's the boundary
    if (section7Start >= 0 && /^##\s+\d/.test(line) && !/^###/.test(line)) {
      section7End = i;
      break;
    }
  }
  if (section7Start < 0) return; // No §7 found

  // ---- Build category → rules index ----
  // Each rule's category (and name) are used as matching keywords
  const rulesByCategory = new Map<string, RuleInput[]>();
  for (const rule of fusableRules) {
    const cats = [rule.category.toLowerCase(), rule.name.toLowerCase()];
    for (const cat of cats) {
      if (!rulesByCategory.has(cat)) rulesByCategory.set(cat, []);
      rulesByCategory.get(cat)!.push(rule);
    }
  }

  // ---- Category keyword matching ----
  const CATEGORY_KEYWORDS: Record<string, string[]> = {
    backend: ['api', 'route', '接口', '后端', 'server', 'handler', 'endpoint'],
    frontend: ['ui', '页面', '组件', '前端', 'component', 'view', 'page', '渲染', '布局', '显示'],
    database: ['db', '数据库', 'sql', 'schema', 'migration', 'table', 'query', 'prisma', 'supabase'],
    auth: ['认证', '鉴权', 'auth', 'login', 'session', 'token', 'permission', '权限'],
    testing: ['test', '测试', 'spec', 'e2e', 'unit'],
    security: ['安全', 'security', 'xss', 'csrf', 'injection', '加密'],
  };

  function matchRulesForText(text: string): RuleInput[] {
    const lowerText = text.toLowerCase();
    const matched = new Set<RuleInput>();

    // Direct category/name match
    for (const [key, catRules] of rulesByCategory.entries()) {
      if (lowerText.includes(key)) {
        catRules.forEach((r) => matched.add(r));
      }
    }

    // Keyword-based match
    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      if (keywords.some((kw) => lowerText.includes(kw))) {
        // Find rules whose category matches
        for (const rule of fusableRules) {
          if (rule.category.toLowerCase().includes(category) ||
              rule.name.toLowerCase().includes(category)) {
            matched.add(rule);
          }
        }
      }
    }

    return Array.from(matched);
  }

  // ---- Process §7 lines ----
  const output: string[] = [
    ...lines.slice(0, section7Start), // everything before §7
  ];

  let i = section7Start;
  while (i < section7End) {
    const line = lines[i];

    // Phase heading: ### 7.x ...
    if (/^###\s+7\.\d/.test(line)) {
      output.push(line);
      i++;

      // Collect Phase block text for keyword matching (until next ### or end)
      let phaseTextEnd = i;
      while (phaseTextEnd < section7End && !/^###\s/.test(lines[phaseTextEnd])) {
        phaseTextEnd++;
      }
      const phaseText = lines.slice(i, phaseTextEnd).join(' ');
      const phaseRules = matchRulesForText(phaseText);

      // Skip existing fusion blocks (re-run safety: remove old injections)
      // Uses marker comments for robust detection: <!-- botool-rules-begin/end -->
      while (i < section7End) {
        if (lines[i].trim() === '' || lines[i].trim() === '<!-- botool-rules-begin -->') {
          // If we hit a marker, skip until end marker
          if (lines[i].trim() === '<!-- botool-rules-begin -->') {
            i++;
            while (i < section7End && lines[i].trim() !== '<!-- botool-rules-end -->') {
              i++;
            }
            if (i < section7End) i++; // skip end marker
            continue;
          }
          // Also clean up old-style injections (no markers): empty line followed by blockquote
          if (i + 1 < section7End && /^>\s*\*\*适用规范\*\*/.test(lines[i + 1])) {
            i++; // skip empty line
            while (i < section7End && (/^>\s/.test(lines[i]) || lines[i].trim() === '')) {
              i++;
            }
            continue;
          }
          break;
        } else if (/^>\s*\*\*适用规范\*\*/.test(lines[i]) || /^>\s*\*\*规范要点\*\*/.test(lines[i])) {
          // Old-style injection without preceding empty line
          while (i < section7End && (/^>\s/.test(lines[i]) || lines[i].trim() === '')) {
            i++;
          }
          continue;
        } else {
          break;
        }
      }

      // Inject Phase-level rule summary with markers
      if (phaseRules.length > 0) {
        output.push('<!-- botool-rules-begin -->');
        output.push(`> **适用规范**: ${phaseRules.map((r) => r.name).join(', ')}`);
        // Collect top checklist items as 规范要点 (max 5)
        const keyPoints: string[] = [];
        for (const rule of phaseRules) {
          for (const item of rule.checklist || []) {
            if (keyPoints.length < 5) keyPoints.push(item);
          }
        }
        if (keyPoints.length > 0) {
          output.push('> **规范要点**:');
          for (const point of keyPoints) {
            output.push(`> - ${point}`);
          }
        }
        output.push('<!-- botool-rules-end -->');
        output.push('');
      }

      continue;
    }

    // DT checkbox line: - [ ] DT-xxx: ...
    if (/^-\s*\[[ x]\]\s*DT-\d+/.test(line)) {
      output.push(line);
      i++;

      // Collect the DT's acceptance criteria block (indented lines)
      const dtLines: string[] = [line];
      while (i < section7End && /^\s+/.test(lines[i]) && !/^-\s*\[[ x]\]\s*DT-\d+/.test(lines[i]) && !/^###/.test(lines[i])) {
        const subLine = lines[i];
        // Skip previously injected [规范] lines (re-run safety)
        if (/\[规范\]/.test(subLine)) {
          i++;
          continue;
        }
        dtLines.push(subLine);
        output.push(subLine);
        i++;
      }

      // Match rules for this DT's text
      const dtText = dtLines.join(' ');
      const dtRules = matchRulesForText(dtText);

      if (dtRules.length > 0) {
        // Find the insertion point: before "Typecheck passes" line or at the end
        // We already pushed the lines, so we inject [规范] lines here
        const lastOutputIdx = output.length;

        // Check if the last pushed line was "Typecheck passes" — insert before it
        let insertBeforeTypecheck = -1;
        for (let j = lastOutputIdx - 1; j >= Math.max(0, lastOutputIdx - 10); j--) {
          if (/typecheck\s+pass/i.test(output[j])) {
            insertBeforeTypecheck = j;
            break;
          }
        }

        const ruleLines: string[] = [];
        for (const rule of dtRules) {
          for (const item of rule.checklist || []) {
            ruleLines.push(`    - [ ] [规范] ${item}`);
          }
        }

        if (ruleLines.length > 0) {
          if (insertBeforeTypecheck >= 0) {
            // Insert before the Typecheck line
            output.splice(insertBeforeTypecheck, 0, ...ruleLines);
          } else {
            // Append at end of DT block
            output.push(...ruleLines);
          }
        }
      }

      continue;
    }

    // Regular line — pass through
    output.push(line);
    i++;
  }

  // Append everything after §7
  output.push(...lines.slice(section7End));

  const result = output.join('\n');
  if (result !== original) {
    // Atomic write: tmp file + rename to prevent corruption on crash
    const tmpPath = absolutePath + '.tmp';
    await writeFile(tmpPath, result, 'utf-8');
    await rename(tmpPath, absolutePath);
  }
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

    const safeRules = ensureRuleFields(rules || []);

    const result = mergeEnrichedPrdJson(basePrdJson, enrichResult || {
      codeExamples: [],
      testCases: [],
      filesToModify: [],
      evals: [],
      dependencies: [],
      sessions: [],
    }, safeRules);

    // 规范融合: 将规范 checklist 注入 PRD.md §7 (best-effort, Q5/Q6)
    if (basePrdJson.prdFile && safeRules.length > 0) {
      try {
        await fuseRulesIntoPrdMd(basePrdJson.prdFile, safeRules);
      } catch (err) {
        // Best-effort: silently skip if fusion fails
        console.warn('Rule fusion into PRD.md skipped due to error:', err);
      }
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Merge API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
