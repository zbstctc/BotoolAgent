/**
 * Skill 文件解析器
 * 从 SKILL.md 文件中提取 Prompt 模板
 */

import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';

const SKILL_PATH = join(homedir(), '.claude/skills/botoolagent-pyramidprd/SKILL.md');

export interface SkillPrompts {
  L1_QUESTION_PROMPT: string;
  L2_QUESTION_PROMPT: string;
  L3_QUESTION_PROMPT: string;
  L4_QUESTION_PROMPT: string;
  PRD_GENERATION_PROMPT: string;
  LAYOUT_GENERATION_PROMPT: string;
  ITERATION_ANALYSIS_PROMPT: string;
}

// 缓存解析结果
let cachedPrompts: SkillPrompts | null = null;

/**
 * 解析 Skill 文件提取 Prompt 模板
 */
export async function parseSkillPrompts(): Promise<SkillPrompts> {
  if (cachedPrompts) {
    return cachedPrompts;
  }

  try {
    const content = await readFile(SKILL_PATH, 'utf-8');
    const prompts = extractPrompts(content);
    cachedPrompts = prompts;
    return prompts;
  } catch (error) {
    console.error('Failed to parse skill file:', error);
    // Return fallback prompts
    return getFallbackPrompts();
  }
}

/**
 * 从 Skill 内容中提取 Prompt 模板
 */
function extractPrompts(content: string): SkillPrompts {
  const prompts: SkillPrompts = {
    L1_QUESTION_PROMPT: '',
    L2_QUESTION_PROMPT: '',
    L3_QUESTION_PROMPT: '',
    L4_QUESTION_PROMPT: '',
    PRD_GENERATION_PROMPT: '',
    LAYOUT_GENERATION_PROMPT: '',
    ITERATION_ANALYSIS_PROMPT: '',
  };

  // Extract each prompt section
  const promptNames = Object.keys(prompts) as (keyof SkillPrompts)[];

  for (const name of promptNames) {
    const regex = new RegExp(`### ${name}\\s*\`\`\`[\\s\\S]*?\n([\\s\\S]*?)\n\`\`\``, 'i');
    const match = content.match(regex);
    if (match) {
      prompts[name] = match[1].trim();
    }
  }

  // If no prompts found, try alternative format
  if (!prompts.L1_QUESTION_PROMPT) {
    // Try to extract from code blocks with prompt names as headers
    for (const name of promptNames) {
      const altRegex = new RegExp(`${name}[:\\s]*\n\`\`\`\\s*\n([\\s\\S]*?)\n\`\`\``, 'i');
      const match = content.match(altRegex);
      if (match) {
        prompts[name] = match[1].trim();
      }
    }
  }

  return prompts;
}

/**
 * 获取 Fallback Prompts（当 Skill 文件不可用时）
 */
function getFallbackPrompts(): SkillPrompts {
  return {
    L1_QUESTION_PROMPT: `你是一个 PRD 需求分析专家。根据用户的需求描述，生成 4-6 个核心识别问题。

需求描述：{{description}}
需求类型：{{requirementType}}

请生成问题来明确：
1. 目标用户是谁
2. 核心要解决的问题
3. 期望的核心功能
4. 成功的衡量标准

返回 JSON 格式：
{
  "questions": [
    {
      "id": "l1-q1",
      "text": "问题内容",
      "type": "single|multiple|text",
      "options": [{"value": "v1", "label": "选项1"}],
      "required": true,
      "topic": "topic-id"
    }
  ]
}`,

    L2_QUESTION_PROMPT: `根据 L1 的回答，确定需要深入的领域维度。

L1 回答：{{l1Answers}}
激活的维度：{{activeDimensions}}

为每个激活的维度生成 2-3 个问题，总共 8-12 个问题。

返回 JSON 格式：
{
  "questions": [
    {
      "id": "l2-q1",
      "text": "问题内容",
      "type": "single|multiple|text",
      "options": [...],
      "required": true,
      "dimension": "frontend",
      "topic": "ui-components"
    }
  ],
  "suggestedDimensions": ["frontend", "backend"]
}`,

    L3_QUESTION_PROMPT: `根据 L2 的回答，深入每个维度的具体细节。

已收集的回答：{{collectedAnswers}}
激活的维度：{{activeDimensions}}

针对用户关心的领域，生成 8-12 个深入的实现细节问题。

返回 JSON 格式同上。`,

    L4_QUESTION_PROMPT: `根据前面的所有回答，生成边界确认问题。

已收集的所有回答：{{collectedAnswers}}

生成 4-6 个问题来确认：
1. 需求范围内的内容
2. 明确不包含的内容
3. 具体的验收标准
4. 可能的风险和依赖

返回 JSON 格式同上。`,

    PRD_GENERATION_PROMPT: `根据金字塔问答收集的所有信息，生成完整的 PRD 文档。

收集的信息：{{collectedAnswers}}

生成一个结构化的 PRD，包含：
1. 项目概述
2. 目标用户
3. 功能需求
4. 非功能需求
5. 验收标准
6. 非目标（Out of Scope）

返回 Markdown 格式的 PRD。`,

    LAYOUT_GENERATION_PROMPT: `根据 PRD 内容，生成页面布局描述。

PRD 内容：{{prdContent}}

返回 JSON 格式：
{
  "pages": [
    {
      "name": "页面名称",
      "layout": "页面布局描述",
      "components": ["组件1", "组件2"]
    }
  ]
}`,

    ITERATION_ANALYSIS_PROMPT: `用户提交了修改需求，分析需要重新提问的层级。

当前 PRD：{{currentPrd}}
修改需求：{{modificationRequest}}

返回 JSON 格式：
{
  "affectedLevels": [2, 3],
  "unchangedLevels": [1, 4],
  "analysis": "分析说明"
}`,
  };
}

/**
 * 填充 Prompt 模板变量
 */
export function fillPromptTemplate(
  template: string,
  variables: Record<string, string>
): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`{{${key}}}`, 'g'), value);
  }
  return result;
}

/**
 * 清除缓存（用于开发时重新加载）
 */
export function clearPromptCache(): void {
  cachedPrompts = null;
}
