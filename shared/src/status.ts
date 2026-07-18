// AD-5: the pipeline status enum, defined once here and imported by both
// processes. Transitions are one-directional toward a terminal state.

export const NON_TERMINAL_STATUSES = [
  'received',
  'validating',
  'downloading',
  'scanning',
  'extracting',
] as const;

export const TERMINAL_STATUSES = [
  'ignored',
  'duplicate',
  'rejected',
  'failed',
  'quarantined',
  'stored',
] as const;

export const ITEM_STATUSES = [...NON_TERMINAL_STATUSES, ...TERMINAL_STATUSES] as const;

export type NonTerminalStatus = (typeof NON_TERMINAL_STATUSES)[number];
export type TerminalStatus = (typeof TERMINAL_STATUSES)[number];
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export function isTerminal(status: ItemStatus): status is TerminalStatus {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}
