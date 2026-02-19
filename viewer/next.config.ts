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
};

export default nextConfig;
