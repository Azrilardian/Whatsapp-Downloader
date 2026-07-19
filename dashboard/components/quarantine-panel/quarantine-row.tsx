import { formatEventTime } from '@/lib/format';
import type { QuarantineRowProps } from './types';

export function QuarantineRow(props: QuarantineRowProps) {
  const { item } = props;

  return (
    <div className="flex items-start gap-4 border-t border-[rgba(168,65,42,0.18)] px-4 py-3">
      <div className="w-[110px] shrink-0 text-xs text-muted-foreground">{formatEventTime(item.updated_at)}</div>
      <div className="w-[150px] shrink-0 text-[13px]">{item.sender_jid}</div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium">{item.filename ?? item.source_url}</div>
        <div className="mt-0.5 text-xs text-[#8a3520]">{item.scan_result ?? '—'}</div>
      </div>
    </div>
  );
}
