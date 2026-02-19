import * as path from "path";
import { Suspense } from "react";
import { ClaudeProcesses } from "./ClaudeProcesses";
import { ClaudeStatus } from "./ClaudeStatus";
import { CurrentTime } from "./CurrentTime";
import { TabBar } from "./TabBar";
import { getProjectRoot } from "@/lib/project-root";

function getRepoName(): string {
  try {
    const projectRoot = getProjectRoot();
    return path.basename(projectRoot);
  } catch {
    return "";
  }
}

export function Header() {
  const repoName = getRepoName();

  return (
    <header className="sticky top-0 z-50 w-full border-b border-neutral-200 bg-white">
      <div className="flex h-11 items-end px-4 gap-4">
        {/* Brand */}
        <div className="flex items-center gap-1.5 flex-shrink-0 pb-2">
          <span className="text-sm font-semibold text-neutral-900">
            Botool Agent
          </span>
          <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs font-medium text-neutral-600">
            Viewer
          </span>
          <span className="text-xs text-neutral-400">
            {process.env.NEXT_PUBLIC_APP_VERSION ?? "dev"}
          </span>
        </div>

        {/* Divider */}
        <div className="w-px bg-neutral-200 h-5 flex-shrink-0 mb-2" />

        {/* Tab Bar (flex-1) */}
        <div className="flex-1 flex items-end overflow-x-auto min-w-0">
          <Suspense fallback={null}>
            <TabBar />
          </Suspense>
        </div>

        {/* Right: repoName + ClaudeStatus */}
        <div className="flex items-center gap-3 flex-shrink-0 pb-2">
          {repoName && (
            <span className="rounded-md bg-neutral-100 px-2 py-0.5 text-xs font-mono text-neutral-600">
              {repoName}
            </span>
          )}
          <CurrentTime />
          <ClaudeProcesses />
          <ClaudeStatus />
        </div>
      </div>
    </header>
  );
}
