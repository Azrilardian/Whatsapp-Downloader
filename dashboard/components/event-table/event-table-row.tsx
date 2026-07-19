import { flexRender } from '@tanstack/react-table';
import { TableCell, TableRow } from '@/components/ui/table';
import type { EventTableRowProps } from './types';

export function EventTableRow(props: EventTableRowProps) {
  const { row } = props;

  return (
    <TableRow>
      {row.getVisibleCells().map((cell) => (
        <TableCell key={cell.id} className="py-2.5">
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </TableCell>
      ))}
    </TableRow>
  );
}
