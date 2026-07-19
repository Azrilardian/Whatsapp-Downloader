import { StatusBadge } from '@/components/status-badge';
import { getStatusDotClassName } from '@/components/status-badge/utils';
import { formatEventTime } from '@/lib/format';
import type { ItemStatus } from '@wadl/shared';
import type { ActivityListRowProps } from './types';

export function ActivityListRow(props: ActivityListRowProps) {
  const { event } = props;
  const status = event.status as ItemStatus | null;

  return (
    <div className="flex items-center gap-2.5 border-t border-border py-1.5">
      {status && <div className={`h-1.5 w-1.5 shrink-0 rounded-full ${getStatusDotClassName(status)}`} />}
      <div className="flex-1 text-[13px]">
        {event.sender_jid ?? 'system'} <span className="text-muted-foreground">— {event.filename ?? event.event_type}</span>
      </div>
      {status && <StatusBadge status={status} />}
      <div className="w-[90px] shrink-0 text-right text-xs text-muted-foreground">{formatEventTime(event.created_at)}</div>
    </div>
  );
}
