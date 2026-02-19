import { NextRequest } from 'next/server';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { verifyCsrfProtection } from '@/lib/api-guard';

// Test types supported
type TestType = 'typecheck' | 'unit' | 'integration' | 'e2e' | 'lint';

interface TestCommand {
  type: TestType;
  command: string;
  args: string[];
  name: string;
}

interface PackageJson {
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
  dependencies?: Record<string, string>;
}

interface TestResult {
  type: TestType;
  name: string;
  status: 'running' | 'passed' | 'failed' | 'skipped';
  output: string;
  passed?: number;
  failed?: number;
  skipped?: number;
  duration?: number;
}

// Import centralized path resolution
import { getProjectRoot } from '@/lib/project-root';

// Detect available test commands from package.json
function detectTestCommands(projectRoot: string): TestCommand[] {
  const commands: TestCommand[] = [];

  // Check root package.json
  const rootPkgPath = path.join(projectRoot, 'package.json');
  const viewerPkgPath = path.join(projectRoot, 'viewer', 'package.json');

  // Collect package.json paths to check
  const pkgPaths: { path: string; dir: string }[] = [];

  if (fs.existsSync(rootPkgPath)) {
    pkgPaths.push({ path: rootPkgPath, dir: projectRoot });
  }
  if (fs.existsSync(viewerPkgPath)) {
    pkgPaths.push({ path: viewerPkgPath, dir: path.join(projectRoot, 'viewer') });
  }

  for (const pkg of pkgPaths) {
    try {
      const content = fs.readFileSync(pkg.path, 'utf-8');
      const pkgJson: PackageJson = JSON.parse(content);
      const scripts = pkgJson.scripts || {};

      // Check for typecheck command
      if (scripts['typecheck'] || scripts['type-check']) {
        const scriptName = scripts['typecheck'] ? 'typecheck' : 'type-check';
        commands.push({
          type: 'typecheck',
          command: 'npm',
          args: ['run', scriptName],
          name: `TypeCheck (${path.basename(pkg.dir)})`,
        });
      } else if (scripts['tsc']) {
        commands.push({
          type: 'typecheck',
          command: 'npm',
          args: ['run', 'tsc'],
          name: `TypeCheck (${path.basename(pkg.dir)})`,
        });
      }

      // Check for lint command
      if (scripts['lint']) {
        commands.push({
          type: 'lint',
          command: 'npm',
          args: ['run', 'lint'],
          name: `Lint (${path.basename(pkg.dir)})`,
        });
      }

      // Check for unit test command
      if (scripts['test']) {
        commands.push({
          type: 'unit',
          command: 'npm',
          args: ['run', 'test'],
          name: `Unit Tests (${path.basename(pkg.dir)})`,
        });
      } else if (scripts['test:unit']) {
        commands.push({
          type: 'unit',
          command: 'npm',
          args: ['run', 'test:unit'],
          name: `Unit Tests (${path.basename(pkg.dir)})`,
        });
      }

      // Check for integration test command
      if (scripts['test:integration']) {
        commands.push({
          type: 'integration',
          command: 'npm',
          args: ['run', 'test:integration'],
          name: `Integration Tests (${path.basename(pkg.dir)})`,
        });
      }

      // Check for e2e test command
      if (scripts['test:e2e'] || scripts['e2e']) {
        const scriptName = scripts['test:e2e'] ? 'test:e2e' : 'e2e';
        commands.push({
          type: 'e2e',
          command: 'npm',
          args: ['run', scriptName],
          name: `E2E Tests (${path.basename(pkg.dir)})`,
        });
      }

      // Also store the directory for running commands
      for (const cmd of commands) {
        if (!cmd.args.includes('--prefix')) {
          // Add the working directory info
          (cmd as TestCommand & { cwd?: string }).cwd = pkg.dir;
        }
      }
    } catch {
      // Skip if package.json can't be read
    }
  }

  return commands;
}

// Parse test output to extract statistics
function parseTestOutput(output: string, type: TestType): { passed: number; failed: number; skipped: number } {
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  if (type === 'typecheck' || type === 'lint') {
    // For typecheck/lint, success means no errors
    const hasErrors = output.includes('error') || output.includes('Error');
    if (hasErrors) {
      // Count error lines
      const errorMatches = output.match(/error/gi);
      failed = errorMatches ? errorMatches.length : 1;
    } else {
      passed = 1;
    }
    return { passed, failed, skipped };
  }

  // Jest style: "Tests: X passed, Y failed, Z skipped"
  const jestMatch = output.match(/Tests:\s+(\d+)\s+passed(?:,\s+(\d+)\s+failed)?(?:,\s+(\d+)\s+skipped)?/i);
  if (jestMatch) {
    passed = parseInt(jestMatch[1] || '0', 10);
    failed = parseInt(jestMatch[2] || '0', 10);
    skipped = parseInt(jestMatch[3] || '0', 10);
    return { passed, failed, skipped };
  }

  // Vitest style: "X passed | Y failed | Z skipped"
  const vitestMatch = output.match(/(\d+)\s+passed\s*\|\s*(\d+)\s+failed(?:\s*\|\s*(\d+)\s+skipped)?/i);
  if (vitestMatch) {
    passed = parseInt(vitestMatch[1] || '0', 10);
    failed = parseInt(vitestMatch[2] || '0', 10);
    skipped = parseInt(vitestMatch[3] || '0', 10);
    return { passed, failed, skipped };
  }

  // Mocha style: "X passing, Y failing"
  const mochaMatch = output.match(/(\d+)\s+passing(?:.*?(\d+)\s+failing)?/i);
  if (mochaMatch) {
    passed = parseInt(mochaMatch[1] || '0', 10);
    failed = parseInt(mochaMatch[2] || '0', 10);
    return { passed, failed, skipped };
  }

  // Generic: count checkmarks and x marks
  const passMatches = output.match(/[✓✔]/g);
  const failMatches = output.match(/[✗✘×]/g);
  if (passMatches) passed = passMatches.length;
  if (failMatches) failed = failMatches.length;

  return { passed, failed, skipped };
}

// Run a single test command
async function runTestCommand(
  cmd: TestCommand & { cwd?: string },
  onOutput: (data: string) => void
): Promise<TestResult> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let output = '';

    const proc = spawn(cmd.command, cmd.args, {
      cwd: cmd.cwd || getProjectRoot(),
      shell: true,
      env: {
        ...process.env,
        FORCE_COLOR: '1', // Enable colored output
        CI: 'true', // Some test runners behave differently in CI
      },
    });

    proc.stdout.on('data', (data: Buffer) => {
      const chunk = data.toString();
      output += chunk;
      onOutput(chunk);
    });

    proc.stderr.on('data', (data: Buffer) => {
      const chunk = data.toString();
      output += chunk;
      onOutput(chunk);
    });

    proc.on('close', (code) => {
      const duration = Date.now() - startTime;
      const stats = parseTestOutput(output, cmd.type);

      resolve({
        type: cmd.type,
        name: cmd.name,
        status: code === 0 ? 'passed' : 'failed',
        output,
        passed: stats.passed,
        failed: stats.failed,
        skipped: stats.skipped,
        duration,
      });
    });

    proc.on('error', (error) => {
      resolve({
        type: cmd.type,
        name: cmd.name,
        status: 'failed',
        output: `Error: ${error.message}`,
        passed: 0,
        failed: 1,
        skipped: 0,
        duration: Date.now() - startTime,
      });
    });
  });
}

// GET: Get available test commands
export async function GET() {
  const projectRoot = getProjectRoot();
  const commands = detectTestCommands(projectRoot);

  return new Response(JSON.stringify({
    projectRoot,
    commands: commands.map(cmd => ({
      type: cmd.type,
      name: cmd.name,
    })),
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// POST: Run tests
export async function POST(request: NextRequest) {
  const csrfError = verifyCsrfProtection(request);
  if (csrfError) return csrfError;

  try {
    const body = await request.json().catch(() => ({}));
    const requestedTypes: TestType[] = body.types || ['typecheck', 'lint', 'unit', 'integration', 'e2e'];

    const projectRoot = getProjectRoot();
    const allCommands = detectTestCommands(projectRoot);

    // Filter to requested test types
    const commands = allCommands.filter(cmd => requestedTypes.includes(cmd.type));

    if (commands.length === 0) {
      return new Response(JSON.stringify({
        error: 'No test commands found',
        availableTypes: allCommands.map(c => c.type),
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Create SSE stream
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        // Helper to send SSE event
        const sendEvent = (event: string, data: unknown) => {
          try {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          } catch {
            // Stream may be closed
          }
        };

        const results: TestResult[] = [];

        // Send initial event with test plan
        sendEvent('plan', {
          tests: commands.map(cmd => ({
            type: cmd.type,
            name: cmd.name,
          })),
        });

        for (const cmd of commands as (TestCommand & { cwd?: string })[]) {
          // Send start event
          sendEvent('start', {
            type: cmd.type,
            name: cmd.name,
          });

          // Run the test
          const result = await runTestCommand(cmd, (output) => {
            sendEvent('output', {
              type: cmd.type,
              output,
            });
          });

          results.push(result);

          // Send result event
          sendEvent('result', result);
        }

        // Send summary
        const summary = {
          total: results.length,
          passed: results.filter(r => r.status === 'passed').length,
          failed: results.filter(r => r.status === 'failed').length,
          results,
        };

        sendEvent('summary', summary);
        sendEvent('done', { timestamp: new Date().toISOString() });

        // Close stream
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Test run error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Internal server error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
