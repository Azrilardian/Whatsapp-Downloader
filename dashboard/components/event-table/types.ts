import type { Row } from '@tanstack/react-table';
import type { EventWithContext } from '@/lib/db';

export interface EventTableProps {
  events: EventWithContext[];
}

export interface EventTableRowProps {
  row: Row<EventWithContext>;
}
