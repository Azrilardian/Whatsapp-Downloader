import { MessagesSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/empty-state';
import { GroupFormDialog } from './group-form-dialog';
import { GroupRow } from './group-row';
import type { GroupPanelProps } from './types';

export function GroupPanel(props: GroupPanelProps) {
  const { groups } = props;

  return (
    <Card className="gap-0 overflow-hidden py-0 shadow-none">
      <CardHeader className="flex flex-row items-center justify-between gap-2 border-b border-border px-4 py-3.5">
        <CardTitle className="text-sm">Groups</CardTitle>
        <GroupFormDialog group={null} trigger={<Button size="sm">+ Add group</Button>} />
      </CardHeader>
      <CardContent className="p-0">
        {groups.length === 0 ? (
          <EmptyState icon={MessagesSquare} title="No groups yet" description="Whitelist a WhatsApp group to admit any participant's messages." />
        ) : (
          groups.map((group) => <GroupRow key={group.group_jid} group={group} />)
        )}
      </CardContent>
    </Card>
  );
}
