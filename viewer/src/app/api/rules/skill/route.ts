import { NextRequest } from 'next/server';
import {
  saveRuleAsSkill,
  deleteSkill,
  listGeneratedSkills,
  previewSkillContent,
  getSkillsDir,
} from '@/lib/rules-to-skill';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { existsSync } from 'fs';

// GET: List all generated skills or preview a skill
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  // Preview skill content
  if (action === 'preview') {
    const category = searchParams.get('category');
    const name = searchParams.get('name');
    const content = searchParams.get('content');

    if (!category || !name || content === null) {
      return new Response(
        JSON.stringify({ error: 'category, name, and content are required for preview' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const preview = previewSkillContent(category, name, decodeURIComponent(content));

    return new Response(JSON.stringify({ preview }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Get skills directory path
  if (action === 'path') {
    return new Response(JSON.stringify({ path: getSkillsDir() }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // List all generated skills
  const result = await listGeneratedSkills();

  if (result.error) {
    return new Response(JSON.stringify({ error: result.error }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ skills: result.skills }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// POST: Generate skill from rule
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { category, name, content } = body;

    if (!category || !name || content === undefined) {
      return new Response(
        JSON.stringify({ error: 'category, name, and content are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const result = await saveRuleAsSkill(category, name, content);

    if (!result.success) {
      return new Response(JSON.stringify({ error: result.error }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        skillPath: result.skillPath,
        skillName: result.skillName,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error generating skill:', error);
    return new Response(JSON.stringify({ error: 'Failed to generate skill' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// DELETE: Remove skill file
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category');
  const name = searchParams.get('name');

  if (!category || !name) {
    return new Response(
      JSON.stringify({ error: 'category and name are required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const result = await deleteSkill(category, name);

  if (!result.success) {
    return new Response(JSON.stringify({ error: result.error }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
