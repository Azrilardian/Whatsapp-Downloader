'use client';

import { ActivityFilters } from '@/components/activity-filters';
import { EventTable } from '@/components/event-table';
import { QuarantinePanel } from '@/components/quarantine-panel';
import { useActivityBoard } from './use-activity-board';
import type { ActivityBoardProps } from './types';

export function ActivityBoard(props: ActivityBoardProps) {
  const { events, quarantined } = props;
  const { filters, setField, filteredEvents, contactOptions } = useActivityBoard({ events });

  return (
    <div>
      <ActivityFilters filters={filters} contactOptions={contactOptions} onFieldChange={setField} />
      <EventTable events={filteredEvents} />
      <QuarantinePanel items={quarantined} />
    </div>
  );
}
