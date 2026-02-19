import { NextResponse } from "next/server";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { getTasksDir } from "@/lib/project-root";

interface AgentProcess {
  pid: number;
  rssKb: number;
  cpuPercent: number;
  cwd: string;
  projectLabel: string;
  agent: "claude" | "codex";
  source: "cli" | "cursor" | "botool";
  role: "main" | "teammate";
  sessionId: string | null;
  uptime: string;
  uptimeSeconds: number;
  matchedProjectId: string | null;
  isUnresponsive: boolean;
}

interface AgentPidData {
  pid: number;
  startedAt?: string;
}

/**
 * Build a map of PID to projectId by scanning tasks/{id}/agent-pid files.
 */
function buildPidProjectMap(): Map<number, string> {
  const map = new Map<number, string>();
  const tasksDir = getTasksDir();

  try {
    const entries = fs.readdirSync(tasksDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pidFile = path.join(tasksDir, entry.name, "agent-pid");
      try {
        const raw = fs.readFileSync(pidFile, "utf-8");
        const data: AgentPidData = JSON.parse(raw);
        if (data.pid) {
          map.set(data.pid, entry.name);
        }
      } catch {
        // file doesn't exist or parse error — skip
      }
    }
  } catch {
    // tasks dir doesn't exist — skip
  }

  return map;
}

/**
 * Batch-resolve cwd for a list of PIDs using a single lsof call.
 */
function resolveCwds(pids: number[]): Map<number, string> {
  const cwdMap = new Map<number, string>();
  if (pids.length === 0) return cwdMap;

  try {
    const pidList = pids.join(",");
    const output = execSync(`lsof -a -d cwd -p ${pidList} -Fn 2>/dev/null`, {
      encoding: "utf-8",
      timeout: 5000,
    });

    let currentPid: number | null = null;
    for (const line of output.split("\n")) {
      if (line.startsWith("p")) {
        currentPid = parseInt(line.slice(1), 10);
      } else if (line.startsWith("n") && currentPid !== null) {
        cwdMap.set(currentPid, line.slice(1));
      }
    }
  } catch {
    // lsof failed — return empty map
  }

  return cwdMap;
}

/**
 * Parse uptime string from ps etime format.
 * Formats: "MM:SS", "HH:MM:SS", "D-HH:MM:SS"
 */
function normalizeUptime(raw: string): string {
  const trimmed = raw.trim();
  // Already human-readable from ps
  return trimmed;
}

/**
 * Parse ps etime format to total seconds.
 * Formats: "MM:SS", "HH:MM:SS", "D-HH:MM:SS"
 */
function uptimeToSeconds(etime: string): number {
  const trimmed = etime.trim();
  let days = 0;
  let timePart = trimmed;

  // Handle "D-HH:MM:SS" format
  if (trimmed.includes("-")) {
    const [d, rest] = trimmed.split("-");
    days = parseInt(d, 10);
    timePart = rest;
  }

  const parts = timePart.split(":").map(Number);
  let seconds = 0;
  if (parts.length === 3) {
    seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    seconds = parts[0] * 60 + parts[1];
  }

  return days * 86400 + seconds;
}

/**
 * Check if a command string is a claude or codex CLI process.
 * Returns the agent type or null.
 */
function matchAgentCommand(command: string): "claude" | "codex" | null {
  const cmdLower = command.toLowerCase();
  for (const name of ["claude", "codex"] as const) {
    if (
      cmdLower.startsWith(`${name} `) ||
      cmdLower.startsWith(`${name}\t`) ||
      cmdLower.includes(`/${name} `) ||
      cmdLower.includes(`/${name}\t`) ||
      cmdLower === name
    ) {
      return name;
    }
  }
  return null;
}

/**
 * Get the set of PIDs that are currently valid claude/codex processes.
 * Used by POST handler to validate kill requests.
 */
function getAgentPids(): Set<number> {
  const pids = new Set<number>();
  try {
    const psOutput = execSync("ps -eo pid,command", {
      encoding: "utf-8",
      timeout: 5000,
    });
    for (const line of psOutput.split("\n").slice(1)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const lowerLine = trimmed.toLowerCase();
      if (!lowerLine.includes("claude") && !lowerLine.includes("codex")) continue;
      if (lowerLine.includes("grep")) continue;

      const match = trimmed.match(/^\s*(\d+)\s+(.+)$/);
      if (!match) continue;

      if (matchAgentCommand(match[2])) {
        pids.add(parseInt(match[1], 10));
      }
    }
  } catch {
    // ignore
  }
  return pids;
}

export async function GET() {
  try {
    // 1. Get all processes
    const psOutput = execSync("ps -eo pid,rss,%cpu,etime,command", {
      encoding: "utf-8",
      timeout: 5000,
    });

    const lines = psOutput.split("\n").slice(1); // skip header

    // 2. Filter claude + codex processes
    const agentLines: Array<{
      pid: number;
      rssKb: number;
      cpuPercent: number;
      uptime: string;
      command: string;
      agent: "claude" | "codex";
    }> = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const lowerLine = trimmed.toLowerCase();
      if (!lowerLine.includes("claude") && !lowerLine.includes("codex")) continue;

      // Exclude grep, our own API, and tmux wrapper processes
      if (lowerLine.includes("grep")) continue;
      if (lowerLine.includes("claude-processes")) continue;
      if (lowerLine.includes("tmux new-session")) continue;

      // Parse: PID RSS %CPU ETIME COMMAND...
      const match = trimmed.match(
        /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+([\d:.-]+)\s+(.+)$/
      );
      if (!match) continue;

      const command = match[5];
      const agent = matchAgentCommand(command);
      if (!agent) continue;

      agentLines.push({
        pid: parseInt(match[1], 10),
        rssKb: parseInt(match[2], 10),
        cpuPercent: parseFloat(match[3]),
        uptime: normalizeUptime(match[4]),
        command,
        agent,
      });
    }

    // 3. Batch resolve cwds
    const pids = agentLines.map((p) => p.pid);
    const cwdMap = resolveCwds(pids);

    // 4. Build PID → project map
    const pidProjectMap = buildPidProjectMap();

    // 5. Assemble results
    const processes: AgentProcess[] = agentLines.map((p) => {
      const cwd = cwdMap.get(p.pid) ?? "unknown";
      const matchedProjectId = pidProjectMap.get(p.pid) ?? null;

      // Determine role from command line
      const isTeammate = p.command.includes("--teammate-mode");
      const role: "main" | "teammate" = isTeammate ? "teammate" : "main";

      // Extract session ID
      const sessionMatch = p.command.match(/--session-id\s+(\S+)/);
      const sessionId = sessionMatch ? sessionMatch[1] : null;

      // Detect source: cursor extension vs BotoolAgent vs generic CLI
      let source: "cli" | "cursor" | "botool" = "cli";
      if (p.command.includes(".cursor/extensions/")) {
        source = "cursor";
      } else if (matchedProjectId || cwd.includes("BotoolAgent")) {
        source = "botool";
      }

      // Project label: prefer matched project name, fall back to basename of cwd
      let projectLabel = matchedProjectId ?? path.basename(cwd);
      if (!projectLabel || projectLabel === "unknown" || projectLabel === "/") {
        projectLabel = source === "cursor" ? "Cursor" : p.agent === "codex" ? "Codex" : "unknown";
      }

      const secs = uptimeToSeconds(p.uptime);

      // Unresponsive detection: 0% CPU + running > 1 hour
      const isUnresponsive = p.cpuPercent === 0 && secs > 3600;

      return {
        pid: p.pid,
        rssKb: p.rssKb,
        cpuPercent: p.cpuPercent,
        cwd,
        projectLabel,
        agent: p.agent,
        source,
        role,
        sessionId,
        uptime: p.uptime,
        uptimeSeconds: secs,
        matchedProjectId,
        isUnresponsive,
      };
    });

    // Sort: main processes first, then by PID
    processes.sort((a, b) => {
      if (a.role !== b.role) return a.role === "main" ? -1 : 1;
      return a.pid - b.pid;
    });

    const totalMemoryKb = processes.reduce((sum, p) => sum + p.rssKb, 0);

    return NextResponse.json({
      processes,
      totalMemoryMb: Math.round((totalMemoryKb / 1024) * 10) / 10,
      totalCount: processes.length,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error("[claude-processes] Error:", error);
    return NextResponse.json({
      processes: [],
      totalMemoryMb: 0,
      totalCount: 0,
      timestamp: Date.now(),
    });
  }
}

/**
 * POST: Kill a claude process by PID.
 * Body: { pid: number }
 * Safety: validates that the PID belongs to a running claude process.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const pid = Number(body?.pid);

    if (!pid || !Number.isInteger(pid) || pid <= 0) {
      return NextResponse.json({ error: "Invalid PID" }, { status: 400 });
    }

    // Verify the PID is actually a claude/codex process
    const agentPids = getAgentPids();
    if (!agentPids.has(pid)) {
      return NextResponse.json(
        { error: "PID is not a claude/codex process" },
        { status: 403 }
      );
    }

    // Send SIGTERM for graceful shutdown
    try {
      process.kill(pid, "SIGTERM");
    } catch (e: unknown) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ESRCH") {
        return NextResponse.json({ ok: true, message: "Process already exited" });
      }
      throw e;
    }

    return NextResponse.json({ ok: true, message: `Sent SIGTERM to PID ${pid}` });
  } catch (error) {
    console.error("[claude-processes] Kill error:", error);
    return NextResponse.json({ error: "Failed to kill process" }, { status: 500 });
  }
}
