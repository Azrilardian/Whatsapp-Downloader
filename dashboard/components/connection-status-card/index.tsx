import { Card } from '@/components/ui/card';
import { QrRepairDialog } from '@/components/qr-repair-dialog';
import { StatusDot } from '@/components/status-dot';
import { formatUptimeSince } from './utils';
import type { ConnectionStatusCardProps } from './types';

export function ConnectionStatusCard(props: ConnectionStatusCardProps) {
  const { workerState } = props;

  if (workerState === null) {
    return (
      <Card className="mb-5 px-6 py-5 text-sm text-muted-foreground shadow-none">
        No connection state recorded yet — start the worker once to create it.
      </Card>
    );
  }

  const connected = workerState.connection_status === 'open';
  const hasPendingQr = workerState.qr_data_url !== null;

  const title = connected
    ? 'WhatsApp session connected'
    : hasPendingQr
      ? 'Scan the QR to pair'
      : workerState.connection_status === 'connecting'
        ? 'Connecting to WhatsApp…'
        : 'Session needs re-pairing';

  const subtitle = connected
    ? formatUptimeSince(workerState.updated_at)
    : hasPendingQr
      ? 'A fresh QR code is ready — scan it from a linked device to resume.'
      : 'Waiting for a fresh QR code from the worker.';

  return (
    <Card
      className={`mb-5 flex-row items-center justify-between gap-3 px-6 py-5 shadow-none transition-colors duration-300 ${
        connected ? 'border-border' : 'border-[rgba(179,132,58,0.4)] bg-[rgba(179,132,58,0.06)]'
      }`}
    >
      <div className="flex items-center gap-3">
        <StatusDot colorClassName={connected ? 'bg-[#5c8a52]' : 'bg-[#b3843a]'} size="md" />
        <div>
          <div className="text-[15px] font-semibold">{title}</div>
          <div className="mt-0.5 text-[13px] text-muted-foreground">{subtitle}</div>
        </div>
      </div>
      {hasPendingQr && <QrRepairDialog qrDataUrl={workerState.qr_data_url} />}
    </Card>
  );
}
