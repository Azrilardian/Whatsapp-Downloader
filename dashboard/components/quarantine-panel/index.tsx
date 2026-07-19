import { ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/empty-state';
import { QuarantineRow } from './quarantine-row';
import type { QuarantinePanelProps } from './types';

export function QuarantinePanel(props: QuarantinePanelProps) {
  const { items } = props;

  return (
    <Card className="gap-0 overflow-hidden border-[rgba(168,65,42,0.35)] py-0 shadow-none">
      <CardHeader className="flex flex-row items-center justify-between gap-2 border-b border-[rgba(168,65,42,0.25)] bg-[rgba(168,65,42,0.06)] px-4 py-3">
        <div className="text-sm font-semibold text-[#8a3520]">Quarantine ({items.length})</div>
        <div className="text-xs text-[#8a3520]">Never moved to Final store</div>
      </CardHeader>
      <CardContent className="p-0">
        {items.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="Quarantine is empty" description="Files that fail a scan will show up here." />
        ) : (
          items.map((item) => <QuarantineRow key={item.item_id} item={item} />)
        )}
      </CardContent>
    </Card>
  );
}
