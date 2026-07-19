import { ArrowUpDown } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import type { ItemStatus } from '@wadl/shared';
import { StatusBadge } from '@/components/status-badge';
import { formatEventTime } from '@/lib/format';
import type { EventWithContext } from '@/lib/db';

function SortableHeader(props: { label: string; onToggle: () => void }) {
  const { label, onToggle } = props;

  return (
    <button
      type="button"
      onClick={onToggle}
      className="inline-flex items-center gap-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase hover:text-foreground"
    >
      {label}
      <ArrowUpDown className="size-3" />
    </button>
  );
}

export const eventTableColumns: ColumnDef<EventWithContext>[] = [
  {
    accessorKey: 'status',
    header: ({ column }) => <SortableHeader label="Status" onToggle={() => column.toggleSorting(column.getIsSorted() === 'asc')} />,
    cell: ({ row }) => {
      const status = row.original.status as ItemStatus | null;
      return status ? <StatusBadge status={status} /> : null;
    },
  },
  {
    accessorKey: 'created_at',
    header: ({ column }) => <SortableHeader label="Time" onToggle={() => column.toggleSorting(column.getIsSorted() === 'asc')} />,
    cell: ({ row }) => <span className="text-xs text-muted-foreground">{formatEventTime(row.original.created_at)}</span>,
  },
  {
    accessorKey: 'sender_jid',
    header: () => <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Contact</span>,
    cell: ({ row }) => <span className="truncate text-xs">{row.original.sender_jid ?? 'system'}</span>,
  },
  {
    id: 'file',
    header: () => <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">File / Link</span>,
    cell: ({ row }) => {
      const event = row.original;
      return (
        <span className="block min-w-0 truncate text-xs" title={event.source_url ?? undefined}>
          {event.filename ?? event.source_url ?? event.event_type}
        </span>
      );
    },
  },
  {
    accessorKey: 'scan_result',
    header: () => <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Scan result</span>,
    cell: ({ row }) => {
      const status = row.original.status as ItemStatus | null;
      const tone = status === 'quarantined' ? 'text-[#8a3520]' : status === 'stored' ? 'text-[#3f5c37]' : 'text-muted-foreground';
      return <span className={`text-xs ${tone}`}>{row.original.scan_result ?? '—'}</span>;
    },
  },
];
