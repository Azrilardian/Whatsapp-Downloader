import type { ConnectionStatus } from '@wadl/shared';

export interface ConnectionIndicatorProps {
  connectionStatus: ConnectionStatus | null;
}

export interface ConnectionMeta {
  label: string;
  dotClassName: string;
}
