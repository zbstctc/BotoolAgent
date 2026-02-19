"use client";

import { useEffect, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface StatusData {
  ok: boolean;
  version: string;
  email: string | null;
  plan: string | null;
  orgName: string | null;
  authMethod: string | null;
  tier: string;
  sessionCount: number;
  timestamp: number;
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
    const interval = setInterval(fetchStatus, 30_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (open) fetchStatus();
  }, [open]);

  const isConnected = status?.ok ?? false;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2.5 py-1 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-50 hover:text-neutral-900">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              isConnected ? "bg-green-500" : "bg-neutral-300"
            }`}
          />
          <span className="font-mono">状态</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-72 bg-white p-0"
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
            <div className="px-4 py-2">
              <span className="text-[10px] text-neutral-400">
                Updated {new Date(status.timestamp).toLocaleTimeString()}
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
