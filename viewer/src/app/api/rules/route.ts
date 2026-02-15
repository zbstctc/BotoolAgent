import { NextRequest } from 'next/server';
import { readdir, writeFile, unlink, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { getRulesDir } from '@/lib/project-root';

const RULES_DIR = getRulesDir();

// Ensure rules directory exists
async function ensureRulesDir() {
  if (!existsSync(RULES_DIR)) {
    await mkdir(RULES_DIR, { recursive: true });
  }
}

// Ensure category directory exists
async function ensureCategoryDir(category: string) {
  const categoryDir = join(RULES_DIR, category);
  if (!existsSync(categoryDir)) {
    await mkdir(categoryDir, { recursive: true });
  }
  return categoryDir;
}

// GET: List all rules by category
export async function GET() {
  try {
    await ensureRulesDir();

    const categories = [
      'frontend',
      'backend',
      'testing',
      'deployment',
      'application',
      'other',
    ];

    const result: Record<string, { id: string; name: string; category: string; updatedAt?: string }[]> = {};

    for (const category of categories) {
      result[category] = [];
      const categoryDir = join(RULES_DIR, category);

      if (existsSync(categoryDir)) {
        const files = await readdir(categoryDir);
        for (const file of files) {
          if (file.endsWith('.md')) {
            const name = file.replace('.md', '');
            result[category].push({
              id: `${category}/${name}`,
              name,
              category,
            });
          }
        }
      }
    }

    return new Response(JSON.stringify({ categories: result }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error listing rules:', error);
    return new Response(JSON.stringify({ error: 'Failed to list rules' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// POST: Save a rule document
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { category, name, content } = body;

    if (!category || !name || content === undefined) {
      return new Response(JSON.stringify({ error: 'category, name, and content are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Sanitize name
    const safeName = name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_');
    const categoryDir = await ensureCategoryDir(category);
    const filePath = join(categoryDir, `${safeName}.md`);

    await writeFile(filePath, content, 'utf-8');

    return new Response(JSON.stringify({
      success: true,
      id: `${category}/${safeName}`,
      path: filePath,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error saving rule:', error);
    return new Response(JSON.stringify({ error: 'Failed to save rule' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// DELETE: Delete a rule document
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return new Response(JSON.stringify({ error: 'id is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const [category, name] = id.split('/');
    if (!category || !name) {
      return new Response(JSON.stringify({ error: 'Invalid id format' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const filePath = join(RULES_DIR, category, `${name}.md`);

    if (!existsSync(filePath)) {
      return new Response(JSON.stringify({ error: 'Rule not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await unlink(filePath);

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error deleting rule:', error);
    return new Response(JSON.stringify({ error: 'Failed to delete rule' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
