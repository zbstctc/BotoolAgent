import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

// Path to tasks directory (relative to project root)
const PROJECT_ROOT = process.cwd();
const TASKS_DIR = path.join(PROJECT_ROOT, '..', 'tasks');

function sanitizeFilename(name: string): string {
  // Remove special characters, keep alphanumeric, spaces, hyphens, and underscores
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s\-_\u4e00-\u9fff]/g, '') // Keep Chinese characters
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
    .slice(0, 50); // Limit length
}

function extractPRDName(content: string): string {
  // Try to extract title from markdown # PRD: <name>
  const titleMatch = content.match(/^#\s*PRD:\s*(.+)$/m);
  if (titleMatch) {
    return titleMatch[1].trim();
  }

  const h1Match = content.match(/^#\s+(.+)$/m);
  if (h1Match) {
    return h1Match[1].trim();
  }

  return '';
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { content, name: providedName } = body;

    if (!content || typeof content !== 'string') {
      return NextResponse.json(
        { error: 'PRD content is required' },
        { status: 400 }
      );
    }

    // Extract or use provided name
    let prdName = providedName || extractPRDName(content);
    if (!prdName) {
      prdName = `prd-${Date.now()}`;
    }

    // Create sanitized filename
    const sanitizedName = sanitizeFilename(prdName);
    const filename = `prd-${sanitizedName}.md`;
    const filePath = path.join(TASKS_DIR, filename);

    // Ensure tasks directory exists
    if (!fs.existsSync(TASKS_DIR)) {
      fs.mkdirSync(TASKS_DIR, { recursive: true });
    }

    // Check if file already exists
    if (fs.existsSync(filePath)) {
      // Generate unique filename by appending timestamp
      const uniqueFilename = `prd-${sanitizedName}-${Date.now()}.md`;
      const uniqueFilePath = path.join(TASKS_DIR, uniqueFilename);
      fs.writeFileSync(uniqueFilePath, content, 'utf-8');

      return NextResponse.json({
        success: true,
        filename: uniqueFilename,
        id: uniqueFilename.replace(/^prd-/, '').replace(/\.md$/, ''),
        name: prdName,
        message: 'PRD saved successfully (with unique identifier due to existing file)',
      });
    }

    // Write the file
    fs.writeFileSync(filePath, content, 'utf-8');

    return NextResponse.json({
      success: true,
      filename,
      id: filename.replace(/^prd-/, '').replace(/\.md$/, ''),
      name: prdName,
      message: 'PRD saved successfully',
    });
  } catch (error) {
    console.error('Error saving PRD:', error);
    return NextResponse.json(
      { error: 'Failed to save PRD' },
      { status: 500 }
    );
  }
}
