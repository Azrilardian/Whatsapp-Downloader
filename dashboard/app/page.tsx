import { getTodayStatusCounts, listEvents, readWorkerState } from '@/lib/db';
import { ConnectionStatusCard } from '@/components/connection-status-card';
import { StatCard } from '@/components/stat-card';
import { RecentActivityList } from '@/components/recent-activity-list';

export const dynamic = 'force-dynamic';

const RECENT_EVENTS_LIMIT = 5;

export default function Home() {
  const workerState = readWorkerState();
  const todayCounts = getTodayStatusCounts();
  const recentEvents = listEvents(RECENT_EVENTS_LIMIT);

  return (
    <div>
      <h1 className="mb-5 text-[22px] font-semibold">Home</h1>

      <ConnectionStatusCard workerState={workerState} />

      <div className="mb-6 grid grid-cols-3 gap-4">
        <StatCard value={todayCounts.stored} label="Stored today" />
        <StatCard value={todayCounts.quarantined} label="Quarantined today" tone="warning" />
        <StatCard value={todayCounts.ignored} label="Ignored today" />
      </div>

      <RecentActivityList events={recentEvents} />
    </div>
  );
}
