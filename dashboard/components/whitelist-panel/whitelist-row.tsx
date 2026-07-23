import { Badge } from '@/components/ui/badge';
import { ACTIVE_TOGGLE_TONE } from '@/components/status-badge/utils';
import { WhitelistFormDialog } from './whitelist-form-dialog';
import type { WhitelistRowProps } from './types';

export function WhitelistRow(props: WhitelistRowProps) {
  const { entry, fields, actions } = props;

  return (
    <div className="flex items-center gap-2 border-t border-border px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium">{entry.label ?? entry.id}</div>
        <div className="text-xs text-muted-foreground">{entry.id}</div>
      </div>

      <form action={actions.setActive.bind(null, entry.id, entry.active !== 1)} className="shrink-0">
        <Badge asChild variant="outline" className={`cursor-pointer border-transparent ${ACTIVE_TOGGLE_TONE[entry.active === 1 ? 'active' : 'inactive']}`}>
          <button type="submit">{entry.active ? 'Active' : 'Inactive'}</button>
        </Badge>
      </form>

      <WhitelistFormDialog
        entry={entry}
        fields={fields}
        actions={actions}
        trigger={
          <button type="button" className="shrink-0 text-xs text-muted-foreground underline">
            Edit
          </button>
        }
      />

      <form action={actions.remove.bind(null, entry.id)} className="shrink-0">
        <button type="submit" className="text-xs text-[#8a3520] underline">
          Remove
        </button>
      </form>
    </div>
  );
}
