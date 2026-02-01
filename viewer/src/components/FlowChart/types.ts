export type Phase = 'setup' | 'loop' | 'decision' | 'done';
export type StepStatus = 'pending' | 'current' | 'completed';

export interface StepData {
  id: string;
  label: string;
  description: string;
  phase: Phase;
}

export interface NoteData {
  id: string;
  appearsWithStep: number;
  position: { x: number; y: number };
  color: { bg: string; border: string };
  content: string;
}

export interface EdgeConnection {
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  label?: string;
}

export interface CustomNodeData extends Record<string, unknown> {
  title: string;
  description: string;
  phase: Phase;
  status?: StepStatus;
}

export interface NoteNodeData extends Record<string, unknown> {
  content: string;
  color: { bg: string; border: string };
}
