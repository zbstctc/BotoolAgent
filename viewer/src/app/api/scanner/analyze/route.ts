import { NextResponse } from 'next/server';
import { spawn, execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { getProjectRoot, ensureContainedPath } from '@/lib/project-root';
import { verifyCsrfProtection } from '@/lib/api-guard';
import { ScanResultSchema } from '@/types/scanner';
import type { ScanResult } from '@/types/scanner';

// --- Concurrency guard ---
let isAnalyzing = false;

// --- Constants ---
const STDERR_MAX_LENGTH = 2000;
const FILE_TREE_MAX_DEPTH = 4;

/**
 * Sanitize stderr output before sending to client:
 * 1. Truncate to STDERR_MAX_LENGTH characters
 * 2. Replace absolute paths with <path> placeholder
 */
function sanitizeStderr(raw: string): string {
  const truncated = raw.length > STDERR_MAX_LENGTH
    ? raw.slice(0, STDERR_MAX_LENGTH) + '... (truncated)'
    : raw;
  // Replace absolute paths (Unix-style /foo/bar and Windows-style C:\foo\bar)
  return truncated.replace(/(?:\/[\w./-]+|[A-Z]:\\[\w.\\-]+)/g, '<path>');
}

/**
 * Send an SSE event to the stream controller.
 */
function sendSSE(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  event: string,
  data: unknown
): void {
  try {
    controller.enqueue(
      encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    );
  } catch {
    // Controller may be closed
  }
}

/**
 * Run a command and return stdout as a string.
 * Uses execFile (not shell) for safety.
 */
function runCommand(
  cmd: string,
  args: string[],
  options: { cwd: string; timeout?: number }
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, {
      cwd: options.cwd,
      timeout: options.timeout ?? 10_000,
      maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(sanitizeStderr(stderr || error.message)));
        return;
      }
      resolve(stdout);
    });
  });
}

/**
 * Check if codex CLI is installed by running `which codex`.
 */
async function isCodexInstalled(): Promise<boolean> {
  try {
    await runCommand('which', ['codex'], { cwd: '/tmp' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate file tree using find with max-depth.
 */
async function generateFileTree(projectRoot: string): Promise<string> {
  try {
    const output = await runCommand(
      'find',
      ['.', '-maxdepth', String(FILE_TREE_MAX_DEPTH), '-not', '-path', '*/.git/*', '-not', '-path', '*/node_modules/*'],
      { cwd: projectRoot, timeout: 15_000 }
    );
    return output;
  } catch {
    return '(file tree generation failed)';
  }
}

/**
 * Read README and key config files from project root.
 */
function readProjectContext(projectRoot: string): string {
  const contextFiles = [
    'README.md',
    'readme.md',
    'package.json',
    'tsconfig.json',
    'Cargo.toml',
    'go.mod',
    'pyproject.toml',
    'requirements.txt',
  ];

  const parts: string[] = [];

  for (const filename of contextFiles) {
    try {
      const filePath = ensureContainedPath(projectRoot, filename);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        // Limit each file to 5000 chars to keep prompt manageable
        const truncated = content.length > 5000
          ? content.slice(0, 5000) + '\n... (truncated)'
          : content;
        parts.push(`--- ${filename} ---\n${truncated}`);
      }
    } catch {
      // ensureContainedPath may throw if path escapes; skip silently
    }
  }

  return parts.join('\n\n');
}

/**
 * Fetch current PR metadata using gh CLI.
 * Returns { prNumber, changedFiles } or defaults on failure.
 */
async function fetchPRMetadata(
  projectRoot: string
): Promise<{ prNumber: number | null; changedFiles: string[] }> {
  try {
    // Get current branch's PR number
    const prListOutput = await runCommand(
      'gh',
      ['pr', 'list', '--head', '@', '--json', 'number', '--limit', '1'],
      { cwd: projectRoot, timeout: 15_000 }
    );
    const prList = JSON.parse(prListOutput);

    if (!Array.isArray(prList) || prList.length === 0) {
      return { prNumber: null, changedFiles: [] };
    }

    const prNumber = prList[0].number as number;

    // Get changed files for this PR
    const filesOutput = await runCommand(
      'gh',
      ['pr', 'diff', String(prNumber), '--name-only'],
      { cwd: projectRoot, timeout: 15_000 }
    );

    const changedFiles = filesOutput
      .split('\n')
      .map((f) => f.trim())
      .filter(Boolean);

    return { prNumber, changedFiles };
  } catch {
    // gh not installed or not in a git repo with PR — graceful degradation
    return { prNumber: null, changedFiles: [] };
  }
}

/**
 * Build the analysis prompt for Codex.
 */
function buildAnalysisPrompt(
  fileTree: string,
  projectContext: string,
  prNumber: number | null,
  changedFiles: string[]
): string {
  const prSection = prNumber
    ? `\n## Current PR\nPR #${prNumber}\nChanged files:\n${changedFiles.map((f) => `- ${f}`).join('\n')}\n`
    : '';

  return `Analyze this project and output a JSON object describing its architecture.

## File Tree
${fileTree}

## Project Context
${projectContext}
${prSection}
## Output Format

You MUST output ONLY a valid JSON object (no markdown fences, no explanation) with this exact structure:

{
  "projectName": "string - the project name",
  "analyzedAt": "string - ISO 8601 timestamp",
  "prNumber": ${prNumber ?? 'null'},
  "changedFiles": ${JSON.stringify(changedFiles)},
  "nodes": [
    {
      "id": "unique-id",
      "label": "Human readable label",
      "path": "relative/path",
      "type": "root | module | component | utility | config",
      "description": "Brief description",
      "techStack": ["tech1", "tech2"],
      "features": [
        { "name": "Feature name", "description": "Brief desc", "relatedFiles": ["file1.ts"] }
      ]
    }
  ],
  "edges": [
    { "source": "node-id-1", "target": "node-id-2", "label": "relationship" }
  ]
}

Rules:
- Include the most important modules/components (aim for 5-15 nodes)
- Connect nodes with edges that describe real dependencies or data flows
- Use the file tree and context files to determine the project structure
- The root node should represent the overall project
- Output ONLY the JSON object, nothing else`;
}

/**
 * Spawn codex and collect its stdout output.
 */
function spawnCodexAnalysis(
  prompt: string,
  projectRoot: string,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder
): Promise<string> {
  return new Promise((resolve, reject) => {
    const codex = spawn(
      'codex',
      ['exec', '-a', 'never', '--full-auto', prompt],
      {
        cwd: projectRoot,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    let stdout = '';
    let stderr = '';

    codex.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    codex.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    codex.on('error', (err) => {
      reject(new Error(`Failed to spawn codex: ${sanitizeStderr(err.message)}`));
    });

    codex.on('close', (code) => {
      if (code !== 0) {
        const sanitized = sanitizeStderr(stderr || `codex exited with code ${code}`);
        sendSSE(controller, encoder, 'error', {
          errorType: 'analysis-failed',
          message: `Codex analysis failed: ${sanitized}`,
        });
        reject(new Error(sanitized));
        return;
      }
      resolve(stdout);
    });
  });
}

/**
 * Extract JSON from codex output which may contain markdown fences or extra text.
 */
function extractJSON(raw: string): string {
  // Try to find JSON within markdown code fences
  const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }

  // Try to find a JSON object directly
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return jsonMatch[0];
  }

  return raw.trim();
}

// --- POST Handler ---

export async function POST(request: Request) {
  const csrfError = verifyCsrfProtection(request);
  if (csrfError) return csrfError;

  // Concurrency guard
  if (isAnalyzing) {
    return NextResponse.json(
      { error: 'Analysis already in progress' },
      { status: 409 }
    );
  }

  isAnalyzing = true;

  const encoder = new TextEncoder();
  let streamController: ReadableStreamDefaultController | null = null;

  const stream = new ReadableStream({
    start(controller) {
      streamController = controller;
    },
    cancel() {
      isAnalyzing = false;
    },
  });

  // Run the analysis pipeline asynchronously
  const runAnalysis = async () => {
    const ctrl = streamController!;
    const projectRoot = getProjectRoot();

    try {
      // Step 1: Check codex installation
      const codexAvailable = await isCodexInstalled();
      if (!codexAvailable) {
        sendSSE(ctrl, encoder, 'error', {
          errorType: 'codex-not-installed',
          message:
            'Codex CLI is not installed. Please install it first: npm install -g @openai/codex',
        });
        ctrl.close();
        return;
      }

      // Step 2: Generate file tree
      sendSSE(ctrl, encoder, 'progress', {
        step: 'generating-file-tree',
        message: '正在生成文件树...',
      });
      const fileTree = await generateFileTree(projectRoot);

      // Step 3: Read project context
      sendSSE(ctrl, encoder, 'progress', {
        step: 'reading-readme',
        message: '正在读取项目配置...',
      });
      const projectContext = readProjectContext(projectRoot);

      // Step 4: Fetch PR metadata
      sendSSE(ctrl, encoder, 'progress', {
        step: 'fetching-pr',
        message: '正在获取 PR 信息...',
      });
      const { prNumber, changedFiles } = await fetchPRMetadata(projectRoot);

      // Step 5: Run codex analysis
      sendSSE(ctrl, encoder, 'progress', {
        step: 'analyzing',
        message: '正在分析项目结构...',
      });

      const prompt = buildAnalysisPrompt(
        fileTree,
        projectContext,
        prNumber,
        changedFiles
      );
      const rawOutput = await spawnCodexAnalysis(
        prompt,
        projectRoot,
        ctrl,
        encoder
      );

      // Step 6: Parse and validate output
      const jsonStr = extractJSON(rawOutput);
      let parsed: unknown;
      try {
        parsed = JSON.parse(jsonStr);
      } catch {
        sendSSE(ctrl, encoder, 'error', {
          errorType: 'parse-error',
          message: 'Failed to parse Codex output as JSON',
        });
        ctrl.close();
        return;
      }

      const validation = ScanResultSchema.safeParse(parsed);
      if (!validation.success) {
        const issues = validation.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ');
        sendSSE(ctrl, encoder, 'error', {
          errorType: 'parse-error',
          message: `Scan result validation failed: ${issues}`,
        });
        ctrl.close();
        return;
      }

      const scanResult: ScanResult = validation.data;

      // Step 7: Write result to file
      const resultPath = ensureContainedPath(
        projectRoot,
        '.botoolagent-scan-result.json'
      );
      fs.writeFileSync(resultPath, JSON.stringify(scanResult, null, 2));

      // Step 8: Send result event
      sendSSE(ctrl, encoder, 'result', { scanResult });
      ctrl.close();
    } catch (error) {
      console.error('Scanner analysis error:', error);
      try {
        sendSSE(ctrl, encoder, 'error', {
          errorType: 'analysis-failed',
          message:
            error instanceof Error
              ? sanitizeStderr(error.message)
              : 'Unknown analysis error',
        });
        ctrl.close();
      } catch {
        // Controller may already be closed
      }
    } finally {
      isAnalyzing = false;
    }
  };

  // Start the analysis without awaiting (streams response immediately)
  runAnalysis().catch((error) => {
    console.error('Unhandled scanner analysis error:', error);
    isAnalyzing = false;
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
