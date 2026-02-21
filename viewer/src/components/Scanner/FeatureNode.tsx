'use client';

import { memo, useMemo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { FolderOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import type { ScanNode } from '@/types/scanner';

// --- Types ---

export type FeatureNodeData = ScanNode & {
  /** Whether this node has files changed in the current PR */
  changedInPR?: boolean;
  /** All changed files in the current PR (used to derive isNew per feature) */
  changedFiles?: string[];
  /** Index signature required by React Flow v12 Node<Data> constraint */
  [key: string]: unknown;
};

export type FeatureNodeType = Node<FeatureNodeData, 'feature'>;

// --- Helpers ---

/**
 * Check if a feature is "new" by testing intersection of
 * feature.relatedFiles with changedFiles.
 */
function isFeatureNew(
  relatedFiles: string[] | undefined,
  changedFiles: string[] | undefined
): boolean {
  if (!relatedFiles?.length || !changedFiles?.length) return false;
  const changedSet = new Set(changedFiles);
  return relatedFiles.some((f) => changedSet.has(f));
}

// --- Component ---

function FeatureNodeInner({ data }: NodeProps<FeatureNodeType>) {
  const isRoot = data.type === 'root';

  // Pre-compute changedFiles set once for all features
  const newFlags = useMemo(() => {
    if (!data.features?.length) return [];
    return data.features.map((feat) =>
      isFeatureNew(feat.relatedFiles, data.changedFiles)
    );
  }, [data.features, data.changedFiles]);

  // Border: green when changedInPR (but not for root nodes)
  const showGreenBorder = !isRoot && data.changedInPR === true;

  return (
    <div
      className={cn(
        'w-[280px] rounded-lg p-3 shadow-sm',
        isRoot
          ? 'bg-neutral-900 text-white'
          : 'border bg-white text-foreground',
        showGreenBorder
          ? 'border-2 border-green-400'
          : !isRoot && 'border-neutral-200'
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-neutral-400" />

      {/* Header: label + description */}
      <div className="mb-2">
        <h3 className={cn('text-sm font-semibold', isRoot && 'text-white')}>
          {data.label}
        </h3>
        {data.description ? (
          <p
            className={cn(
              'mt-0.5 text-xs',
              isRoot ? 'text-neutral-300' : 'text-neutral-500'
            )}
          >
            {data.description}
          </p>
        ) : null}
      </div>

      {/* Tech stack badges */}
      {data.techStack && data.techStack.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-1">
          {data.techStack.map((tech) => (
            <Badge key={tech} variant="neutral" className="text-[10px]">
              {tech}
            </Badge>
          ))}
        </div>
      ) : null}

      {/* Features list */}
      {data.features && data.features.length > 0 ? (
        <ul className={cn('mb-2 space-y-1', isRoot ? 'border-t border-neutral-700 pt-2' : 'border-t border-neutral-100 pt-2')}>
          {data.features.map((feat, idx) => (
            <li
              key={feat.name}
              className={cn(
                'flex items-center gap-1.5 text-xs',
                isRoot ? 'text-neutral-200' : 'text-neutral-700'
              )}
            >
              <span className={cn('shrink-0', isRoot ? 'text-neutral-400' : 'text-neutral-400')}>
                &bull;
              </span>
              <span className="truncate">{feat.name}</span>
              {newFlags[idx] ? (
                <Badge variant="success" className="ml-auto shrink-0 text-[10px]">
                  NEW
                </Badge>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {/* Path footer */}
      <div
        className={cn(
          'flex items-center gap-1 border-t pt-2 text-xs',
          isRoot
            ? 'border-neutral-700 text-neutral-300'
            : 'border-neutral-100 text-neutral-400'
        )}
      >
        <FolderOpen className="size-3 shrink-0" />
        <span className="truncate">{data.path}</span>
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-neutral-400" />
    </div>
  );
}

const FeatureNode = memo(FeatureNodeInner);
FeatureNode.displayName = 'FeatureNode';

export default FeatureNode;
