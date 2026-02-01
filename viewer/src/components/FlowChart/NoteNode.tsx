'use client';

import type { NoteNodeData } from './types';

interface NoteNodeProps {
  data: NoteNodeData;
}

export function NoteNode({ data }: NoteNodeProps) {
  return (
    <div
      className="note-node"
      style={{
        backgroundColor: data.color.bg,
        borderColor: data.color.border,
      }}
    >
      <pre>{data.content}</pre>
    </div>
  );
}
