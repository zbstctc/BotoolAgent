import { createHash } from 'crypto';
import { getProjectRoot } from './project-root';

export function computeWorkspaceId(): string {
  const root = getProjectRoot();
  return createHash('md5').update(root).digest('hex').substring(0, 8);
}
