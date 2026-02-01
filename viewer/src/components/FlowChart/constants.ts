import type { Phase, StepData, NoteData, EdgeConnection } from './types';

export const NODE_WIDTH = 240;
export const NODE_HEIGHT = 70;

export const PHASE_COLORS: Record<Phase, { bg: string; border: string }> = {
  setup: { bg: '#f0f7ff', border: '#4a90d9' },
  loop: { bg: '#f5f5f5', border: '#666666' },
  decision: { bg: '#fff8e6', border: '#c9a227' },
  done: { bg: '#f0fff4', border: '#38a169' },
};

export const ALL_STEPS: StepData[] = [
  // Setup phase (vertical)
  { id: '1', label: 'You write a PRD', description: 'Define what you want to build', phase: 'setup' },
  { id: '2', label: 'Convert to prd.json', description: 'Break into small user stories', phase: 'setup' },
  { id: '3', label: 'Run BotoolAgent.sh', description: 'Starts the autonomous loop', phase: 'setup' },
  // Loop phase
  { id: '4', label: 'AI picks a story', description: 'Finds next passes: false', phase: 'loop' },
  { id: '5', label: 'Implements it', description: 'Writes code, runs tests', phase: 'loop' },
  { id: '6', label: 'Commits changes', description: 'If tests pass', phase: 'loop' },
  { id: '7', label: 'Updates prd.json', description: 'Sets passes: true', phase: 'loop' },
  { id: '8', label: 'Logs to progress.txt', description: 'Saves learnings', phase: 'loop' },
  { id: '9', label: 'More stories?', description: '', phase: 'decision' },
  // Exit
  { id: '10', label: 'Done!', description: 'All stories complete', phase: 'done' },
];

export const NOTES: NoteData[] = [
  {
    id: 'note-1',
    appearsWithStep: 2,
    position: { x: 340, y: 100 },
    color: { bg: '#f5f0ff', border: '#8b5cf6' },
    content: `{
  "id": "US-001",
  "title": "Add priority field to database",
  "acceptanceCriteria": [
    "Add priority column to tasks table",
    "Generate and run migration",
    "Typecheck passes"
  ],
  "passes": false
}`,
  },
  {
    id: 'note-2',
    appearsWithStep: 8,
    position: { x: 480, y: 620 },
    color: { bg: '#fdf4f0', border: '#c97a50' },
    content: `Also updates AGENTS.md with
patterns discovered, so future
iterations learn from this one.`,
  },
];

export const POSITIONS: Record<string, { x: number; y: number }> = {
  // Vertical setup flow on the left
  '1': { x: 20, y: 20 },
  '2': { x: 80, y: 130 },
  '3': { x: 60, y: 250 },
  // Loop
  '4': { x: 40, y: 420 },
  '5': { x: 450, y: 300 },
  '6': { x: 750, y: 450 },
  '7': { x: 470, y: 520 },
  '8': { x: 200, y: 620 },
  '9': { x: 40, y: 720 },
  // Exit
  '10': { x: 350, y: 880 },
  // Notes
  ...Object.fromEntries(NOTES.map(n => [n.id, n.position])),
};

export const EDGE_CONNECTIONS: EdgeConnection[] = [
  // Setup phase (vertical) - bottom to top connections
  { source: '1', target: '2', sourceHandle: 'bottom', targetHandle: 'top' },
  { source: '2', target: '3', sourceHandle: 'bottom', targetHandle: 'top' },
  { source: '3', target: '4', sourceHandle: 'bottom', targetHandle: 'top' },
  // Loop phase
  { source: '4', target: '5', sourceHandle: 'right', targetHandle: 'left' },
  { source: '5', target: '6', sourceHandle: 'right', targetHandle: 'top' },
  { source: '6', target: '7', sourceHandle: 'left-source', targetHandle: 'right-target' },
  { source: '7', target: '8', sourceHandle: 'left-source', targetHandle: 'right-target' },
  { source: '8', target: '9', sourceHandle: 'left-source', targetHandle: 'right-target' },
  { source: '9', target: '4', sourceHandle: 'top-source', targetHandle: 'bottom-target', label: 'Yes' },
  // Exit
  { source: '9', target: '10', sourceHandle: 'bottom', targetHandle: 'top', label: 'No' },
];
