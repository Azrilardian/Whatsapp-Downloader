import type { ItemStatus } from '@wadl/shared';
import type { StatusMeta } from './types';

const NEUTRAL = 'bg-foreground/5 text-muted-foreground';
const GREEN = 'bg-[rgba(93,122,82,0.14)] text-[#3f5c37]';
const RED = 'bg-[rgba(168,65,42,0.16)] text-[#8a3520]';

const STATUS_LABELS: Record<ItemStatus, string> = {
  received: 'Received',
  validating: 'Validating',
  downloading: 'Downloading',
  scanning: 'Scanning',
  extracting: 'Extracting',
  ignored: 'Ignored',
  duplicate: 'Duplicate',
  rejected: 'Rejected',
  failed: 'Failed',
  quarantined: 'Quarantined',
  stored: 'Stored',
};

const STATUS_TONE: Record<ItemStatus, string> = {
  received: NEUTRAL,
  validating: NEUTRAL,
  downloading: NEUTRAL,
  scanning: NEUTRAL,
  extracting: NEUTRAL,
  ignored: NEUTRAL,
  duplicate: NEUTRAL,
  rejected: RED,
  failed: RED,
  quarantined: RED,
  stored: GREEN,
};

export function getStatusMeta(status: ItemStatus): StatusMeta {
  return { label: STATUS_LABELS[status], className: STATUS_TONE[status] };
}

const NEUTRAL_DOT = 'bg-muted-foreground';
const GREEN_DOT = 'bg-[#3f5c37]';
const RED_DOT = 'bg-[#8a3520]';

const STATUS_DOT: Record<ItemStatus, string> = {
  received: NEUTRAL_DOT,
  validating: NEUTRAL_DOT,
  downloading: NEUTRAL_DOT,
  scanning: NEUTRAL_DOT,
  extracting: NEUTRAL_DOT,
  ignored: NEUTRAL_DOT,
  duplicate: NEUTRAL_DOT,
  rejected: RED_DOT,
  failed: RED_DOT,
  quarantined: RED_DOT,
  stored: GREEN_DOT,
};

export function getStatusDotClassName(status: ItemStatus): string {
  return STATUS_DOT[status];
}

export const ACTIVE_TOGGLE_TONE: Record<'active' | 'inactive', string> = {
  active: GREEN,
  inactive: NEUTRAL,
};
