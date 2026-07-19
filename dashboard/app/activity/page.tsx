import { listEvents, listQuarantined } from '@/lib/db';
import { ActivityBoard } from '@/components/activity-board';

export const dynamic = 'force-dynamic';

const EVENT_LOG_LIMIT = 200;

// FR-13/AD-1/NFR-6: read-only audit surface — every Event with its context,
// and quarantined items listed distinctly from delivered/stored ones. Local
// dashboard only, never publicly exposed.
export default function ActivityPage() {
  const events = listEvents(EVENT_LOG_LIMIT);
  const quarantined = listQuarantined();

  return (
    <div>
      <h1 className="mb-1 text-[22px] font-semibold">Activity</h1>
      <p className="mb-4 text-[13px] text-muted-foreground">Full event log, newest first.</p>

      <ActivityBoard events={events} quarantined={quarantined} />
    </div>
  );
}
