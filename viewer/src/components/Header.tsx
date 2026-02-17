import Link from "next/link";
import { Suspense } from "react";
import { ProjectSwitcher } from "./ProjectSwitcher";

export function Header() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-neutral-200 bg-white/80 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <span className="text-xl font-semibold text-neutral-900">
            Botool Agent
          </span>
          <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600">
            Viewer
          </span>
          <span className="text-xs text-neutral-400">
            {process.env.NEXT_PUBLIC_APP_VERSION ?? "dev"}
          </span>
        </div>
        <nav className="flex items-center gap-4">
          <Suspense fallback={null}>
            <ProjectSwitcher />
          </Suspense>
          <Link
            href="/"
            className="text-sm font-medium text-neutral-600 hover:text-neutral-900 transition-colors"
          >
            Dashboard
          </Link>
        </nav>
      </div>
    </header>
  );
}
