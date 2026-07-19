import { flexRender, type HeaderGroup } from '@tanstack/react-table';
import { TableHead, TableRow } from '@/components/ui/table';
import type { EventWithContext } from '@/lib/db';

export function TableHeaderRow(props: { headerGroup: HeaderGroup<EventWithContext> }) {
  const { headerGroup } = props;

  return (
    <TableRow>
      {headerGroup.headers.map((header) => (
        <TableHead key={header.id}>{header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}</TableHead>
      ))}
    </TableRow>
  );
}
