import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/empty-state';
import { WhitelistFormDialog } from './whitelist-form-dialog';
import { WhitelistRow } from './whitelist-row';
import type { WhitelistPanelProps } from './types';

export function WhitelistPanel(props: WhitelistPanelProps) {
  const { title, addButtonLabel, icon: Icon, emptyTitle, emptyDescription, entries, fields, actions } = props;

  return (
    <Card className="gap-0 overflow-hidden py-0 shadow-none">
      <CardHeader className="flex flex-row items-center justify-between gap-2 border-b border-border px-4 py-3.5">
        <CardTitle className="text-sm">{title}</CardTitle>
        <WhitelistFormDialog entry={null} fields={fields} actions={actions} trigger={<Button size="sm">{addButtonLabel}</Button>} />
      </CardHeader>
      <CardContent className="p-0">
        {entries.length === 0 ? (
          <EmptyState icon={Icon} title={emptyTitle} description={emptyDescription} />
        ) : (
          entries.map((entry) => <WhitelistRow key={entry.id} entry={entry} fields={fields} actions={actions} />)
        )}
      </CardContent>
    </Card>
  );
}
