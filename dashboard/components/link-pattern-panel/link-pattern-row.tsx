import { deleteLinkPatternAction, setLinkPatternActiveAction } from '@/app/whitelists/actions';
import { Badge } from '@/components/ui/badge';
import { ACTIVE_TOGGLE_TONE } from '@/components/status-badge/utils';
import { LinkPatternFormDialog } from './link-pattern-form-dialog';
import type { LinkPatternRowProps } from './types';

export function LinkPatternRow(props: LinkPatternRowProps) {
  const { pattern } = props;

  return (
    <div className="flex items-center gap-2 border-t border-border px-4 py-2.5">
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="truncate font-mono text-[13px] font-medium" title={pattern.pattern}>
          {pattern.pattern}
        </div>
        <div className="text-xs text-muted-foreground">{pattern.type}</div>
      </div>

      <form action={setLinkPatternActiveAction.bind(null, pattern.pattern, pattern.active !== 1)} className="shrink-0">
        <Badge asChild variant="outline" className={`cursor-pointer border-transparent ${ACTIVE_TOGGLE_TONE[pattern.active === 1 ? 'active' : 'inactive']}`}>
          <button type="submit">{pattern.active ? 'Active' : 'Inactive'}</button>
        </Badge>
      </form>

      <LinkPatternFormDialog
        pattern={pattern}
        trigger={
          <button type="button" className="shrink-0 text-xs text-muted-foreground underline">
            Edit
          </button>
        }
      />

      <form action={deleteLinkPatternAction.bind(null, pattern.pattern)} className="shrink-0">
        <button type="submit" className="text-xs text-[#8a3520] underline">
          Remove
        </button>
      </form>
    </div>
  );
}
