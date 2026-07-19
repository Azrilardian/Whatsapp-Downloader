import type { ConnectionStatus } from '@wadl/shared';
import type { ConnectionMeta } from './types';

const CONNECTION_META: Record<ConnectionStatus, ConnectionMeta> = {
  open: { label: 'Connected', dotClassName: 'bg-[#5c8a52]' },
  connecting: { label: 'Connecting…', dotClassName: 'bg-[#b3843a]' },
  close: { label: 'Reconnecting…', dotClassName: 'bg-[#b3843a]' },
  logged_out: { label: 'Needs re-pair', dotClassName: 'bg-[#8a3520]' },
};

export function getConnectionMeta(connectionStatus: ConnectionStatus | null): ConnectionMeta {
  if (connectionStatus === null) return { label: 'No connection recorded', dotClassName: 'bg-muted-foreground/40' };
  return CONNECTION_META[connectionStatus];
}
