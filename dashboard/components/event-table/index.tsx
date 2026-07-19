'use client';

import { useState } from 'react';
import { SearchX } from 'lucide-react';
import { getCoreRowModel, getSortedRowModel, useReactTable, type SortingState } from '@tanstack/react-table';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableHeader } from '@/components/ui/table';
import { EmptyState } from '@/components/empty-state';
import { eventTableColumns } from './columns';
import { EventTableRow } from './event-table-row';
import { TableHeaderRow } from './table-header-row';
import type { EventTableProps } from './types';

export function EventTable(props: EventTableProps) {
  const { events } = props;
  const [sorting, setSorting] = useState<SortingState>([]);

  const table = useReactTable({
    data: events,
    columns: eventTableColumns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <Card className="mb-6 gap-0 overflow-hidden py-0 shadow-none">
      <CardContent className="p-0">
        {events.length === 0 ? (
          <EmptyState icon={SearchX} title="No events match these filters" description="Try widening the status, contact, or date filters above." />
        ) : (
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableHeaderRow key={headerGroup.id} headerGroup={headerGroup} />
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.map((row) => (
                <EventTableRow key={row.id} row={row} />
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
