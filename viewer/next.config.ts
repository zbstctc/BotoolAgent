import type { NextConfig } from "next";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

function getVersion(): string {
  // 1. Try .botoolagent-version file (works in portable mode without git tags)
  try {
    const versionFile = path.resolve(__dirname, '..', '.botoolagent-version');
    const version = fs.readFileSync(versionFile, 'utf-8').trim();
    if (version) return version;
  } catch {
    // ignore
  }
  // 2. Try git tags (works in standalone mode)
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
