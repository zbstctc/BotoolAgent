import * as fs from 'fs';
import * as path from 'path';
import { getRegistryPath } from '@/lib/project-root';

export interface RegistryProject {
  name: string;
  prdMd: string;
  prdJson: string;
  progress: string;
  branch: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface Registry {
  version: number;
  projects: Record<string, RegistryProject>;
  activeProject: string | null;
}

function readRegistryFromDisk(): Registry {
  const registryPath = getRegistryPath();
  try {
    if (fs.existsSync(registryPath)) {
      return JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
    }
  } catch {
    // Ignore corrupt/missing file
  }
  return { version: 1, projects: {}, activeProject: null };
}

function atomicWriteRegistry(registry: Registry): void {
  const registryPath = getRegistryPath();
  const tmpPath = registryPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(registry, null, 2));
  fs.renameSync(tmpPath, registryPath);
}

/**
 * Async mutex lock — serialises all read-modify-write cycles on registry.json.
 *
 * Usage:
 *   const result = await withRegistry(reg => {
 *     reg.activeProject = 'foo';
 *     return reg;           // return value is forwarded to caller
 *   });
 *
 * The callback receives the current registry object. Mutate it in place
 * (or return a replacement). After the callback returns the registry is
 * atomically written back to disk and the lock is released.
 */
let lock: Promise<void> = Promise.resolve();

export async function withRegistry<T>(
  fn: (registry: Registry) => T | Promise<T>,
): Promise<T> {
  // Queue behind the previous holder
  const prev = lock;
  let release!: () => void;
  lock = new Promise<void>((r) => {
    release = r;
  });
  await prev;

  try {
    const registry = readRegistryFromDisk();
    const result = await fn(registry);
    atomicWriteRegistry(registry);
    return result;
  } finally {
    release();
  }
}

/**
 * Read-only access — does NOT acquire the lock.
 * Safe for GET handlers that only need a snapshot.
 */
export function readRegistry(): Registry {
  return readRegistryFromDisk();
}
