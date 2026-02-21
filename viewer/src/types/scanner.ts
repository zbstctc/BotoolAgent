import { z } from 'zod';

// --- Zod Schemas ---

export const ScanNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  path: z.string(),
  type: z.enum(['root', 'module', 'component', 'utility', 'config']),
  description: z.string().optional(),
  techStack: z.array(z.string()).optional(),
  features: z
    .array(
      z.object({
        name: z.string(),
        description: z.string().optional(),
        relatedFiles: z.array(z.string()).optional(),
      })
    )
    .optional(),
});

export const ScanEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  label: z.string().optional(),
});

export const ScanResultSchema = z.object({
  projectName: z.string(),
  analyzedAt: z.string(),
  prNumber: z.number().nullable(),
  changedFiles: z.array(z.string()),
  nodes: z.array(ScanNodeSchema),
  edges: z.array(ScanEdgeSchema),
});

// --- TypeScript types derived from Zod schemas ---

export type ScanNode = z.infer<typeof ScanNodeSchema>;
export type ScanEdge = z.infer<typeof ScanEdgeSchema>;
export type ScanResult = z.infer<typeof ScanResultSchema>;

// --- SSE event types ---

export interface ScanProgressEvent {
  step:
    | 'generating-file-tree'
    | 'reading-readme'
    | 'fetching-pr'
    | 'analyzing';
  message: string;
}

export interface ScanResultEvent {
  scanResult: ScanResult;
}

export interface ScanErrorEvent {
  errorType:
    | 'codex-not-installed'
    | 'analysis-failed'
    | 'parse-error'
    | 'concurrent-request';
  message: string;
}
