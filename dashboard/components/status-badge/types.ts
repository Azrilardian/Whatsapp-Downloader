import type { ItemStatus } from '@wadl/shared';

export interface StatusMeta {
  label: string;
  className: string;
}

export interface StatusBadgeProps {
  status: ItemStatus;
}
