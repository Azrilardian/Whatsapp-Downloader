import Link from 'next/link';
import { readSettings, readWorkerState } from '@/lib/db';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  connecting: 'Connecting…',
  open: 'Connected',
  close: 'Disconnected — auto-reconnecting',
  logged_out: 'Session logged out — re-pair required',
};

const STATUS_CLASS: Record<string, string> = {
  connecting: 'text-amber-600 dark:text-amber-400',
  open: 'text-green-600 dark:text-green-400',
  close: 'text-amber-600 dark:text-amber-400',
  logged_out: 'text-red-600 dark:text-red-400',
};

export default function Home() {
  const settings = readSettings();
  const workerState = readWorkerState();

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-semibold">WhatsApp Downloader</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Local dashboard shell — settings views arrive later in Epic 5.
      </p>
      <p className="mt-4 flex flex-col gap-1">
        <Link href="/whitelists" className="text-sm underline">
          Manage contact &amp; link-pattern whitelists →
        </Link>
        <Link href="/activity" className="text-sm underline">
          View event log &amp; quarantine →
        </Link>
      </p>

      <section className="mt-8">
        <h2 className="text-lg font-medium">Connection status</h2>
        {workerState === null ? (
          <p className="mt-2 text-sm text-neutral-500">No connection state recorded yet.</p>
        ) : (
          <>
            <p className={`mt-2 text-sm font-medium ${STATUS_CLASS[workerState.connection_status] ?? ''}`}>
              {STATUS_LABEL[workerState.connection_status] ?? workerState.connection_status}
            </p>
            <p className="mt-1 text-xs text-neutral-500">Updated {workerState.updated_at}</p>
            {workerState.qr_data_url && (
              <div className="mt-4">
                <p className="text-sm text-neutral-500">Scan to (re-)pair the WhatsApp session:</p>
                {/* eslint-disable-next-line @next/next/no-img-element -- data URL, not an optimizable remote asset */}
                <img
                  src={workerState.qr_data_url}
                  alt="WhatsApp pairing QR code"
                  className="mt-2 h-56 w-56 border border-neutral-200 dark:border-neutral-800"
                />
              </div>
            )}
          </>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-medium">Shared store</h2>
        {settings === null ? (
          <p className="mt-2 text-sm text-amber-600 dark:text-amber-400">
            Database not found — start the worker once so it creates the schema
            (<code>npm run worker:once</code>).
          </p>
        ) : (
          <>
            <p className="mt-2 text-sm text-neutral-500">
              Connected to the shared SQLite store. Seeded policy settings:
            </p>
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr>
                  <th scope="col" className="text-left">Setting</th>
                  <th scope="col" className="text-right">Value</th>
                </tr>
              </thead>
              <tbody>
                {settings.map((s) => (
                  <tr key={s.key} className="border-t border-neutral-200 dark:border-neutral-800">
                    <td className="py-1.5 pr-4 font-mono text-xs">{s.key}</td>
                    <td className="py-1.5 text-right font-mono text-xs">{s.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>
    </main>
  );
}
