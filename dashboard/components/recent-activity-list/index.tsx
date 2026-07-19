import Link from 'next/link';
import { Activity } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/empty-state';
import { ActivityListRow } from './activity-list-row';
import type { RecentActivityListProps } from './types';

export function RecentActivityList(props: RecentActivityListProps) {
  const { events } = props;

  return (
    <Card className="gap-2.5 px-5 py-4.5 shadow-none">
      <CardHeader className="flex flex-row items-center justify-between gap-2 p-0">
        <CardTitle className="text-sm">Recent activity</CardTitle>
        <Link href="/activity" className="text-xs text-muted-foreground underline">
          View all →
        </Link>
      </CardHeader>
      <CardContent className="p-0">
        {events.length === 0 ? (
          <EmptyState icon={Activity} title="No events yet" description="Pipeline activity will appear here as messages arrive." />
        ) : (
          events.map((event) => <ActivityListRow key={event.event_id} event={event} />)
        )}
      </CardContent>
    </Card>
  );
}
