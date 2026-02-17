import type { NextConfig } from "next";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

function getVersion(): string {
  // 1. .botoolagent-version file is the source of truth for installed version
  try {
    const versionFile = path.resolve(__dirname, '..', '.botoolagent-version');
    const version = fs.readFileSync(versionFile, 'utf-8').trim();
    if (version) return version;
  } catch {
    // ignore
  }
  // 2. Fallback to git tags (dev repo convenience)
  try {
    return execSync("git describe --tags --abbrev=0", { encoding: "utf-8" }).trim();
  } catch {
    return "dev";
  }
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: getVersion(),
  },
};

export default nextConfig;
