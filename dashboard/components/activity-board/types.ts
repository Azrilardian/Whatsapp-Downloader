import type { ItemRow, ItemStatus } from '@wadl/shared';
import type { EventWithContext } from '@/lib/db';

export interface ActivityBoardProps {
  events: EventWithContext[];
  quarantined: ItemRow[];
}

export type DateFilter = 'all' | 'today' | 'yesterday';

export interface FiltersState {
  status: ItemStatus | 'all';
  contact: string;
  date: DateFilter;
  search: string;
}

export type FiltersField = keyof FiltersState;

export interface UseActivityBoardProps {
  events: EventWithContext[];
}
