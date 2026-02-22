import type { NextConfig } from "next";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

function getVersion(): string {
  // 1. Git tags are the source of truth (dev repo / git clone users)
  try {
    return execSync("git describe --tags --abbrev=0", {
      encoding: "utf-8",
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    // no .git or no tags — fall through
  }
  // 2. Fallback to .botoolagent-version file (tar.gz distribution users)
  try {
    const versionFile = path.resolve(__dirname, '..', '.botoolagent-version');
    const version = fs.readFileSync(versionFile, 'utf-8').trim();
    if (version) return version;
  } catch {
    // ignore
  }
  return "dev";
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: getVersion(),
  },
  webpack: (config, { dev }) => {
    if (dev) {
      // Exclude .claude/ directory from webpack file watching.
      // Claude Code tools (e.g. TodoWrite) write files here during active
      // CLI sessions; without this, those writes trigger Fast Refresh,
      // which causes Stage1Content to remount and interrupts SSE streams.
      //
      // webpack requires watchOptions.ignored items to be non-empty strings (glob)
      // or RegExps. We only preserve existing string items to avoid schema errors.
      const existing = config.watchOptions?.ignored;
      const stringItems: string[] = [];
      if (Array.isArray(existing)) {
        existing.forEach((item) => {
          if (typeof item === 'string' && item.length > 0) stringItems.push(item);
        });
      } else if (typeof existing === 'string' && existing.length > 0) {
        stringItems.push(existing);
      }
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [...stringItems, '**/.claude/**'],
      };
    }
    return config;
  },
};

export default nextConfig;
