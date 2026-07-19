import type { EventWithContext } from '@/lib/db';

export interface RecentActivityListProps {
  events: EventWithContext[];
}

export interface ActivityListRowProps {
  event: EventWithContext;
}
