'use client';

import { cn } from '@/lib/utils';

export type LayerStatus = 'pass' | 'fail' | 'skipped' | 'running' | 'pending';

export interface LayerResult {
  id: string;       // "L1" - "L6"
  name: string;     // Layer name
  status: LayerStatus;
}

export interface LayerProgressBarProps {
  layers: LayerResult[];
}

function StatusIcon({ status }: { status: LayerStatus }) {
  switch (status) {
    case 'pass':
      return (
        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-green-100 text-green-600 text-xs font-bold">
          ✓
        </span>
      );
    case 'fail':
      return (
        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-red-100 text-red-600 text-xs font-bold">
          ✗
        </span>
      );
    case 'running':
      return (
        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-neutral-100 text-neutral-700">
          <span className="w-2.5 h-2.5 rounded-full bg-neutral-700 animate-pulse" />
        </span>
      );
    case 'skipped':
      return (
        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-neutral-100 text-neutral-400 text-xs font-bold">
          -
        </span>
      );
    case 'pending':
    default:
      return (
        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-neutral-100 text-neutral-400">
          <span className="w-2.5 h-2.5 rounded-full border-2 border-neutral-300" />
        </span>
      );
  }
}

function getConnectorColor(leftStatus: LayerStatus, rightStatus: LayerStatus): string {
  if (leftStatus === 'pass' && rightStatus === 'pass') return 'bg-green-300';
  if (leftStatus === 'pass' && rightStatus === 'running') return 'bg-green-300';
  if (leftStatus === 'fail') return 'bg-red-300';
  return 'bg-neutral-200';
}

export function LayerProgressBar({ layers }: LayerProgressBarProps) {
  return (
    <div className="flex items-center gap-0 w-full px-2 py-3">
      {layers.map((layer, index) => (
        <div key={layer.id} className="flex items-center flex-1 min-w-0 last:flex-none">
          {/* Layer node */}
          <div className="flex flex-col items-center gap-1">
            <StatusIcon status={layer.status} />
            <span
              className={cn(
                'text-[10px] font-medium leading-none whitespace-nowrap',
                layer.status === 'pass' && 'text-green-600',
                layer.status === 'fail' && 'text-red-600',
                layer.status === 'running' && 'text-neutral-700',
                (layer.status === 'skipped' || layer.status === 'pending') && 'text-neutral-400',
              )}
            >
              {layer.id}
            </span>
            <span
              className={cn(
                'text-[9px] leading-none whitespace-nowrap max-w-[72px] truncate text-center',
                layer.status === 'running' ? 'text-neutral-600' : 'text-neutral-400',
              )}
              title={layer.name}
            >
              {layer.name}
            </span>
          </div>

          {/* Connector line */}
          {index < layers.length - 1 && (
            <div
              className={cn(
                'flex-1 h-0.5 min-w-3 mx-1 rounded-full self-start mt-3',
                getConnectorColor(layer.status, layers[index + 1].status),
              )}
            />
          )}
        </div>
      ))}
    </div>
  );
}
