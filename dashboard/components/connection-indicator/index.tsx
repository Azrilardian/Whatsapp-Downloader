import { StatusDot } from '@/components/status-dot';
import { getConnectionMeta } from './utils';
import type { ConnectionIndicatorProps } from './types';

export function ConnectionIndicator(props: ConnectionIndicatorProps) {
  const { connectionStatus } = props;
  const meta = getConnectionMeta(connectionStatus);

  return (
    <div className="flex items-center gap-2">
      <StatusDot colorClassName={meta.dotClassName} />
      <div className="text-xs text-muted-foreground">{meta.label}</div>
    </div>
  );
}
