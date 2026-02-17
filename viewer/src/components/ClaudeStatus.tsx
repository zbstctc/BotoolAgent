"use client";

import { useEffect, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface RateLimitWindow {
  label: string;
  used: number;
  limit: number;
  percent: number;
  resetInfo: string;
}

interface StatusData {
  ok: boolean;
  version: string;
  email: string | null;
  plan: string | null;
  orgName: string | null;
  authMethod: string | null;
  tier: string;
  windows: RateLimitWindow[];
  sessionCount: number;
  timestamp: number;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

export function ClaudeStatus() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/cli/status");
      if (res.ok) {
        setStatus(await res.json());
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  useEffect(() => {
    if (open) fetchStatus();
  }, [open]);

  const isConnected = status?.ok ?? false;
  const sessionWindow = status?.windows?.[0];
  const sessionPct = sessionWindow?.percent ?? 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2.5 py-1 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-50 hover:text-neutral-900">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              isConnected
                ? sessionPct >= 80
                  ? "bg-amber-500"
                  : "bg-green-500"
                : "bg-neutral-300"
            }`}
          />
          <span className="font-mono">
            {sessionPct > 0 ? `${sessionPct}% used` : "Usage"}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-80 bg-white p-0"
      >
        {loading && !status ? (
          <div className="flex items-center justify-center py-6 text-sm text-neutral-400">
            Loading...
          </div>
        ) : status ? (
          <div className="divide-y divide-neutral-100">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    isConnected ? "bg-green-500" : "bg-red-400"
                  }`}
                />
                <span className="text-sm font-medium text-neutral-900">
                  {isConnected ? "Connected" : "Disconnected"}
                </span>
              </div>
              <span className="text-xs text-neutral-400">
                {status.plan} Plan
              </span>
            </div>

            {/* Rate Limit Windows */}
            <div className="px-4 py-3 space-y-3">
              {status.windows.map((w) => (
                <UsageWindow key={w.label} window={w} />
              ))}
            </div>

            {/* Account Details */}
            <div className="px-4 py-3 space-y-1.5">
              <StatusRow
                label="Sessions today"
                value={String(status.sessionCount)}
                mono
              />
              <StatusRow
                label="CLI Version"
                value={status.version}
                mono
              />
              {status.email && (
                <StatusRow label="Account" value={status.email} />
              )}
            </div>

            {/* Footer */}
            <div className="px-4 py-2 flex items-center justify-between">
              <span className="text-[10px] text-neutral-400">
                Updated {new Date(status.timestamp).toLocaleTimeString()}
              </span>
              <span className="text-[10px] text-neutral-300">
                ~estimated
              </span>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center py-6 text-sm text-neutral-400">
            Unable to fetch status
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function UsageWindow({ window: w }: { window: RateLimitWindow }) {
  const barColor =
    w.percent >= 80
      ? "bg-red-500"
      : w.percent >= 50
        ? "bg-amber-500"
        : "bg-green-500";

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-neutral-900">
          {w.label}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-100">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${Math.max(w.percent, 1)}%` }}
        />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-neutral-500">
          {w.percent}% used
        </span>
        <span className="text-[11px] font-mono text-neutral-400">
          {formatTokens(w.used)} / {formatTokens(w.limit)}
        </span>
      </div>
    </div>
  );
}

function StatusRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-neutral-500">{label}</span>
      <span
        className={`text-neutral-900 ${mono ? "font-mono" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}
