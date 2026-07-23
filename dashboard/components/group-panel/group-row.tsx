import { deleteGroupAction, setGroupActiveAction } from '@/app/whitelists/actions';
import { Badge } from '@/components/ui/badge';
import { ACTIVE_TOGGLE_TONE } from '@/components/status-badge/utils';
import { GroupFormDialog } from './group-form-dialog';
import type { GroupRowProps } from './types';

export function GroupRow(props: GroupRowProps) {
  const { group } = props;

  return (
    <div className="flex items-center gap-2 border-t border-border px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium">{group.label ?? group.group_jid}</div>
        <div className="text-xs text-muted-foreground">{group.group_jid}</div>
      </div>

      <form action={setGroupActiveAction.bind(null, group.group_jid, group.active !== 1)} className="shrink-0">
        <Badge asChild variant="outline" className={`cursor-pointer border-transparent ${ACTIVE_TOGGLE_TONE[group.active === 1 ? 'active' : 'inactive']}`}>
          <button type="submit">{group.active ? 'Active' : 'Inactive'}</button>
        </Badge>
      </form>

      <GroupFormDialog
        group={group}
        trigger={
          <button type="button" className="shrink-0 text-xs text-muted-foreground underline">
            Edit
          </button>
        }
      />

      <form action={deleteGroupAction.bind(null, group.group_jid)} className="shrink-0">
        <button type="submit" className="text-xs text-[#8a3520] underline">
          Remove
        </button>
      </form>
    </div>
  );
}
