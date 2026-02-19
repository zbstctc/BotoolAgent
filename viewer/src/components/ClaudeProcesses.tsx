"use client";

import { useEffect, useState, useCallback, startTransition } from "react";
import { Terminal, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

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

interface ProcessData {
  processes: AgentProcess[];
  totalMemoryMb: number;
  totalCount: number;
  timestamp: number;
}

function formatMemory(kb: number): string {
  const mb = kb / 1024;
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}

export function ClaudeProcesses() {
  const [data, setData] = useState<ProcessData | null>(null);
  const [open, setOpen] = useState(false);
  const [killingPids, setKillingPids] = useState<Set<number>>(new Set());
  const [confirmTarget, setConfirmTarget] = useState<AgentProcess | null>(null);

  const fetchProcesses = useCallback(async () => {
    try {
      const res = await fetch("/api/claude-processes");
      if (res.ok) {
        const result = await res.json();
        startTransition(() => setData(result));
      }
    } catch {
      // keep previous data on error
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchProcesses();
    const interval = setInterval(fetchProcesses, 10_000);
    return () => clearInterval(interval);
  }, [fetchProcesses]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) fetchProcesses();
  }, [open, fetchProcesses]);

  const killProcess = useCallback(async (pid: number) => {
    setKillingPids((prev) => new Set(prev).add(pid));
    try {
      await fetch("/api/claude-processes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pid }),
      });
      setTimeout(() => {
        fetchProcesses();
        setKillingPids((prev) => {
          const next = new Set(prev);
          next.delete(pid);
          return next;
        });
      }, 1500);
    } catch {
      setKillingPids((prev) => {
        const next = new Set(prev);
        next.delete(pid);
        return next;
      });
    }
  }, [fetchProcesses]);

  const handleKillRequest = useCallback((proc: AgentProcess) => {
    setConfirmTarget(proc);
  }, []);

  const handleConfirmKill = useCallback(() => {
    if (confirmTarget) {
      killProcess(confirmTarget.pid);
      setConfirmTarget(null);
    }
  }, [confirmTarget, killProcess]);

  const count = data?.totalCount ?? 0;
  const unresponsiveCount = data?.processes?.filter((p) => p.isUnresponsive).length ?? 0;

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button className="flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2.5 py-1 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-50 hover:text-neutral-900">
            <Terminal className="h-3.5 w-3.5" />
            <span className="font-mono">
              进程管理
            </span>
            {unresponsiveCount > 0 && (
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500" />
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={8}
          className="w-96 bg-white p-0"
        >
          {data ? (
            <div className="divide-y divide-neutral-100">
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-neutral-900">
                    AI Processes
                  </span>
                  {unresponsiveCount > 0 && (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700">
                      {unresponsiveCount} 无响应
                    </span>
                  )}
                </div>
                <span className="text-xs font-mono text-neutral-500">
                  {data.totalMemoryMb > 1024
                    ? `${(data.totalMemoryMb / 1024).toFixed(1)} GB`
                    : `${data.totalMemoryMb} MB`}{" "}
                  total
                </span>
              </div>

              {/* Process List */}
              {data.processes.length > 0 ? (
                <div className="max-h-72 overflow-y-auto divide-y divide-neutral-50">
                  {data.processes.map((proc) => (
                    <ProcessRow
                      key={proc.pid}
                      process={proc}
                      killing={killingPids.has(proc.pid)}
                      onKill={handleKillRequest}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-center py-6 text-sm text-neutral-400">
                  No AI processes running
                </div>
              )}

              {/* Footer */}
              <div className="px-4 py-2 flex items-center justify-between">
                <span className="text-[10px] text-neutral-400">
                  Updated{" "}
                  {new Date(data.timestamp).toLocaleTimeString()}
                </span>
                <span className="text-[10px] text-neutral-300">
                  Auto-refresh 10s
                </span>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center py-6 text-sm text-neutral-400">
              Loading...
            </div>
          )}
        </PopoverContent>
      </Popover>

      {/* Kill Confirmation Dialog */}
      <Dialog open={confirmTarget !== null} onOpenChange={(v) => { if (!v) setConfirmTarget(null); }}>
        <DialogContent className="sm:max-w-md bg-white">
          <DialogHeader>
            <DialogTitle>确认终止进程</DialogTitle>
          </DialogHeader>
          {confirmTarget && (
            <div className="space-y-3 py-2">
              <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-neutral-900">
                    {confirmTarget.projectLabel}
                  </span>
                  <span className={`text-xs font-medium ${
                    confirmTarget.agent === "codex" ? "text-blue-600" : "text-green-600"
                  }`}>
                    {confirmTarget.agent === "codex" ? "Codex" : "Claude"}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs font-mono text-neutral-500">
                  <span>PID {confirmTarget.pid}</span>
                  <span>{formatMemory(confirmTarget.rssKb)}</span>
                  <span>{confirmTarget.uptime}</span>
                </div>
              </div>
              {confirmTarget.source === "cursor" && (
                <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">
                  此进程由 Cursor 管理，终止后会导致 Cursor 崩溃！
                </p>
              )}
              <p className="text-sm text-neutral-500">
                将发送 SIGTERM 信号终止该进程，此操作不可撤销。
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmTarget(null)}>取消</Button>
            <Button
              variant="destructive"
              onClick={handleConfirmKill}
            >
              终止进程
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ProcessRow({
  process: proc,
  killing,
  onKill,
}: {
  process: AgentProcess;
  killing: boolean;
  onKill: (proc: AgentProcess) => void;
}) {
  const isMain = proc.role === "main";

  const sourceLabel = proc.source === "cursor"
    ? "Cursor"
    : proc.source === "botool"
      ? "Botool"
      : proc.agent === "codex" ? "Codex" : "Claude";

  const sourceColor = proc.source === "cursor"
    ? "text-purple-600"
    : proc.agent === "codex"
      ? "text-blue-600"
      : isMain
        ? "text-green-600"
        : "text-amber-600";

  return (
    <div
      className={`px-4 py-2.5 group ${
        proc.isUnresponsive ? "bg-red-50/50" : ""
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`inline-block h-2 w-2 rounded-full flex-shrink-0 ${
              proc.isUnresponsive
                ? "bg-red-400"
                : isMain
                  ? "bg-green-500"
                  : "bg-amber-500"
            }`}
          />
          <span className="text-sm font-medium text-neutral-900 truncate">
            {proc.projectLabel}
          </span>
          {proc.isUnresponsive && (
            <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-600 flex-shrink-0">
              无响应
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
          <span className={`text-[11px] font-medium ${sourceColor}`}>
            {sourceLabel}
          </span>
          <button
            onClick={() => onKill(proc)}
            disabled={killing}
            className={`rounded p-0.5 transition-colors ${
              proc.isUnresponsive
                ? "text-red-400 hover:text-red-600 hover:bg-red-100"
                : "text-neutral-300 opacity-0 group-hover:opacity-100 hover:text-neutral-600 hover:bg-neutral-100"
            } disabled:opacity-50`}
            title={`Kill PID ${proc.pid}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="mt-1 flex items-center gap-3 text-[11px] font-mono text-neutral-500 pl-4">
        <span>PID {proc.pid}</span>
        <span>{formatMemory(proc.rssKb)}</span>
        <span>{proc.cpuPercent}%</span>
        <span>{proc.uptime}</span>
      </div>
    </div>
  );
}
