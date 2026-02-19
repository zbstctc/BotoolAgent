/**
 * rules-to-skill.ts
 * 将规范文档转换为 Claude Code Skill 格式
 */

import { homedir } from 'os';
import { join } from 'path';
import { mkdir, writeFile, unlink, readdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { ensureContainedPath } from '@/lib/project-root';

// Skill 目录路径
const SKILLS_DIR = join(homedir(), '.claude', 'skills', 'botool-rules');

// 分类名称映射（中英文）
const CATEGORY_NAMES: Record<string, { en: string; zh: string }> = {
  frontend: { en: 'frontend', zh: '前端规范' },
  backend: { en: 'backend', zh: '后端规范' },
  testing: { en: 'testing', zh: '测试规范' },
  deployment: { en: 'deployment', zh: '部署规范' },
  application: { en: 'application', zh: '应用规范' },
  other: { en: 'other', zh: '其他规范' },
};

/**
 * Validate that a category string is safe for use in file paths.
 * Rejects categories containing path separators or traversal sequences.
 */
function validateCategory(category: string): void {
  if (
    !category ||
    category.includes('/') ||
    category.includes('\\') ||
    category.includes('..') ||
    category.includes('\0')
  ) {
    throw new Error(`Invalid category: ${category}`);
  }
}

/**
 * 生成 Skill 文件名
 * 格式: {category}-{name}.md
 */
export function generateSkillFileName(category: string, name: string): string {
  // Validate category before using in file path
  validateCategory(category);

  // 将中文名转换为拼音/英文或直接使用
  const safeName = name
    .toLowerCase()
    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return `${category}-${safeName}.md`;
}

/**
 * 生成 Skill 文件内容
 * 遵循 Claude Code Skill 规范
 */
export function generateSkillContent(
  category: string,
  name: string,
  content: string
): string {
  const categoryInfo = CATEGORY_NAMES[category] || { en: category, zh: category };

  // 从内容提取描述（取第一个非空行或标题）
  const lines = content.split('\n').filter(line => line.trim());
  let description = `${categoryInfo.zh} - ${name}`;

  // 尝试从内容中提取更好的描述
  for (const line of lines) {
    const trimmed = line.trim();
    // 跳过标题行
    if (trimmed.startsWith('#')) {
      const headerText = trimmed.replace(/^#+\s*/, '');
      if (headerText && headerText.length < 100) {
        description = headerText;
        break;
      }
    }
  }

  // 生成 skill 名称（用于 Claude Code 识别）
  const skillName = `botool-rules:${category}:${name.toLowerCase().replace(/\s+/g, '-')}`;

  // 构建 Skill 文件内容
  const skillContent = `---
name: ${skillName}
description: "${description.replace(/"/g, '\\"')}"
user-invocable: false
---

# ${categoryInfo.zh}: ${name}

> 此 Skill 由 BotoolAgent 规范管理器自动生成。

---

${content}
`;

  return skillContent;
}

/**
 * 确保 Skill 目录存在
 */
export async function ensureSkillsDir(): Promise<void> {
  if (!existsSync(SKILLS_DIR)) {
    await mkdir(SKILLS_DIR, { recursive: true });
  }
}

/**
 * 将规范保存为 Skill 文件
 */
export async function saveRuleAsSkill(
  category: string,
  name: string,
  content: string
): Promise<{ success: boolean; skillPath: string; skillName: string; error?: string }> {
  try {
    await ensureSkillsDir();

    const fileName = generateSkillFileName(category, name);

    // Validate the resolved path stays within SKILLS_DIR
    try {
      ensureContainedPath(SKILLS_DIR, fileName);
    } catch {
      throw new Error(`Invalid skill path: ${fileName}`);
    }

    const skillPath = join(SKILLS_DIR, fileName);
    const skillContent = generateSkillContent(category, name, content);
    const skillName = `botool-rules:${category}:${name.toLowerCase().replace(/\s+/g, '-')}`;

    await writeFile(skillPath, skillContent, 'utf-8');

    return {
      success: true,
      skillPath,
      skillName,
    };
  } catch (error) {
    console.error('Failed to save rule as skill:', error);
    return {
      success: false,
      skillPath: '',
      skillName: '',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 删除 Skill 文件
 */
export async function deleteSkill(
  category: string,
  name: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const fileName = generateSkillFileName(category, name);

    // Validate the resolved path stays within SKILLS_DIR
    // For delete, SKILLS_DIR may not exist yet — if so, there's nothing to delete
    if (!existsSync(SKILLS_DIR)) {
      return { success: true };
    }

    try {
      ensureContainedPath(SKILLS_DIR, fileName);
    } catch {
      throw new Error(`Invalid skill path: ${fileName}`);
    }

    const skillPath = join(SKILLS_DIR, fileName);

    if (existsSync(skillPath)) {
      await unlink(skillPath);
    }

    return { success: true };
  } catch (error) {
    console.error('Failed to delete skill:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 列出所有已生成的 Skill 文件
 */
export async function listGeneratedSkills(): Promise<{
  skills: { name: string; path: string; category: string; ruleName: string }[];
  error?: string;
}> {
  try {
    await ensureSkillsDir();

    const files = await readdir(SKILLS_DIR);
    const skills: { name: string; path: string; category: string; ruleName: string }[] = [];

    for (const file of files) {
      if (file.endsWith('.md')) {
        const filePath = join(SKILLS_DIR, file);
        const stats = await stat(filePath);

        if (stats.isFile()) {
          // 从文件名解析分类和规范名
          const match = file.match(/^([a-z]+)-(.+)\.md$/);
          if (match) {
            const [, category, ruleName] = match;
            skills.push({
              name: file.replace('.md', ''),
              path: filePath,
              category,
              ruleName,
            });
          }
        }
      }
    }

    return { skills };
  } catch (error) {
    console.error('Failed to list skills:', error);
    return {
      skills: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * 预览 Skill 内容（不保存）
 */
export function previewSkillContent(
  category: string,
  name: string,
  content: string
): { fileName: string; content: string } {
  const fileName = generateSkillFileName(category, name);
  const skillContent = generateSkillContent(category, name, content);

  return {
    fileName,
    content: skillContent,
  };
}

/**
 * 获取 Skills 目录路径
 */
export function getSkillsDir(): string {
  return SKILLS_DIR;
}
