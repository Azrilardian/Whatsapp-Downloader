import { listEvents, listQuarantined } from '@/lib/db';

export const dynamic = 'force-dynamic';

// FR-13/AD-1/NFR-6: read-only audit surface — every Event with its context,
// and quarantined items listed distinctly from delivered/stored ones. Local
// dashboard only, never publicly exposed.
export default function ActivityPage() {
  const events = listEvents();
  const quarantined = listQuarantined();

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="text-2xl font-semibold">Activity</h1>
      <p className="mt-1 text-sm text-neutral-500">Every pipeline event and everything currently quarantined.</p>

      <section className="mt-10">
        <h2 className="text-lg font-medium">Quarantined ({quarantined.length})</h2>
        {quarantined.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">Nothing quarantined.</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="pb-1">Sender</th>
                <th className="pb-1">Source URL</th>
                <th className="pb-1">Filename</th>
                <th className="pb-1">Scan result</th>
                <th className="pb-1">Updated</th>
              </tr>
            </thead>
            <tbody>
              {quarantined.map((item) => (
                <tr key={item.item_id} className="border-t border-neutral-200 dark:border-neutral-800">
                  <td className="py-1.5 pr-2 font-mono text-xs">{item.sender_jid}</td>
                  <td className="max-w-xs truncate py-1.5 pr-2 text-xs">{item.source_url}</td>
                  <td className="py-1.5 pr-2 text-xs">{item.filename ?? ''}</td>
                  <td className="py-1.5 pr-2 text-xs text-amber-600 dark:text-amber-400">{item.scan_result ?? ''}</td>
                  <td className="py-1.5 text-xs text-neutral-500">{item.updated_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-medium">Event log ({events.length})</h2>
        {events.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">No events yet.</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="pb-1">Time</th>
                <th className="pb-1">Event</th>
                <th className="pb-1">Sender</th>
                <th className="pb-1">Link / filename</th>
                <th className="pb-1">Status</th>
                <th className="pb-1">Detail</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.event_id} className="border-t border-neutral-200 align-top dark:border-neutral-800">
                  <td className="py-1.5 pr-2 text-xs text-neutral-500">{e.created_at}</td>
                  <td className="py-1.5 pr-2 font-mono text-xs">{e.event_type}</td>
                  <td className="py-1.5 pr-2 font-mono text-xs">{e.sender_jid ?? ''}</td>
                  <td className="max-w-xs truncate py-1.5 pr-2 text-xs">{e.filename ?? e.source_url ?? ''}</td>
                  <td className="py-1.5 pr-2 text-xs">{e.status ?? ''}</td>
                  <td className="max-w-xs truncate py-1.5 text-xs text-neutral-500">{e.detail ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
