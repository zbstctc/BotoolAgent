import { NextRequest } from 'next/server';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

const RULES_DIR = join(process.cwd().replace(/\/viewer$/, ''), 'rules');

// GET: Get a specific rule document content
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;

    // id is URL encoded, e.g., "frontend%2Fmy-rule"
    const decodedId = decodeURIComponent(id);
    const [category, name] = decodedId.split('/');

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

    const content = await readFile(filePath, 'utf-8');

    return new Response(JSON.stringify({
      id: decodedId,
      name,
      category,
      content,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error reading rule:', error);
    return new Response(JSON.stringify({ error: 'Failed to read rule' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
