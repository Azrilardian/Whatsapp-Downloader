import { MessagesSquare, Users } from 'lucide-react';
import { listContacts, listGroups, listLinkPatterns } from '@/lib/db';
import { WhitelistPanel } from '@/components/whitelist-panel';
import { LinkPatternPanel } from '@/components/link-pattern-panel';
import { deleteContactAction, deleteGroupAction, saveContactAction, saveGroupAction, setContactActiveAction, setGroupActiveAction } from './actions';

export const dynamic = 'force-dynamic';

// FR-12/FR-19/AD-2/AD-18: the dashboard's only writable surface — contacts,
// groups, and link_patterns (plain <form> Server Actions; no client JS
// needed for CRUD). Contacts and groups share one WhitelistPanel — they're
// the same (identity, label, active) shape; link_patterns differs (a `type`
// column instead of `label`) so it keeps its own panel.
export default function WhitelistsPage() {
  const contacts = listContacts();
  const groups = listGroups();
  const patterns = listLinkPatterns();

  return (
    <div>
      <h1 className="mb-1 text-[22px] font-semibold">Whitelists</h1>
      <p className="mb-5 text-[13px] text-muted-foreground">Edits apply immediately — no restart needed.</p>

      <div className="grid grid-cols-3 items-start gap-5">
        <WhitelistPanel
          title="Contacts"
          addButtonLabel="+ Add contact"
          icon={Users}
          emptyTitle="No contacts yet"
          emptyDescription="Add a sender identity to start whitelisting messages."
          entries={contacts.map((c) => ({ id: c.jid, label: c.label, active: c.active }))}
          fields={{
            idFieldName: 'jid',
            originalIdFieldName: 'originalJid',
            idLabel: 'Sender identity',
            idPlaceholder: '+62 8xx-xxxx-xxxx',
            labelPlaceholder: 'e.g. Aji — build host',
            entityLabel: 'contact',
          }}
          actions={{ save: saveContactAction, setActive: setContactActiveAction, remove: deleteContactAction }}
        />
        <WhitelistPanel
          title="Groups"
          addButtonLabel="+ Add group"
          icon={MessagesSquare}
          emptyTitle="No groups yet"
          emptyDescription="Whitelist a WhatsApp group to admit any participant's messages."
          entries={groups.map((g) => ({ id: g.group_jid, label: g.label, active: g.active }))}
          fields={{
            idFieldName: 'groupJid',
            originalIdFieldName: 'originalGroupJid',
            idLabel: 'Group identity',
            idPlaceholder: '1234567890-1234567890@g.us',
            labelPlaceholder: 'e.g. Build team',
            entityLabel: 'group',
          }}
          actions={{ save: saveGroupAction, setActive: setGroupActiveAction, remove: deleteGroupAction }}
        />
        <LinkPatternPanel patterns={patterns} />
      </div>
    </div>
  );
}
