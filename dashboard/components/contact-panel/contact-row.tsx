import { deleteContactAction, setContactActiveAction } from '@/app/whitelists/actions';
import { Badge } from '@/components/ui/badge';
import { ACTIVE_TOGGLE_TONE } from '@/components/status-badge/utils';
import { ContactFormDialog } from './contact-form-dialog';
import type { ContactRowProps } from './types';

export function ContactRow(props: ContactRowProps) {
  const { contact } = props;

  return (
    <div className="flex items-center gap-2 border-t border-border px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium">{contact.label ?? contact.jid}</div>
        <div className="text-xs text-muted-foreground">{contact.jid}</div>
      </div>

      <form action={setContactActiveAction.bind(null, contact.jid, contact.active !== 1)} className="shrink-0">
        <Badge asChild variant="outline" className={`cursor-pointer border-transparent ${ACTIVE_TOGGLE_TONE[contact.active === 1 ? 'active' : 'inactive']}`}>
          <button type="submit">{contact.active ? 'Active' : 'Inactive'}</button>
        </Badge>
      </form>

      <ContactFormDialog
        contact={contact}
        trigger={
          <button type="button" className="shrink-0 text-xs text-muted-foreground underline">
            Edit
          </button>
        }
      />

      <form action={deleteContactAction.bind(null, contact.jid)} className="shrink-0">
        <button type="submit" className="text-xs text-[#8a3520] underline">
          Remove
        </button>
      </form>
    </div>
  );
}
