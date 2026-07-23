import { listContacts, listGroups, listLinkPatterns } from '@/lib/db';
import { ContactPanel } from '@/components/contact-panel';
import { GroupPanel } from '@/components/group-panel';
import { LinkPatternPanel } from '@/components/link-pattern-panel';

export const dynamic = 'force-dynamic';

// FR-12/FR-19/AD-2/AD-18: the dashboard's only writable surface — contacts,
// groups, and link_patterns (plain <form> Server Actions; no client JS
// needed for CRUD).
export default function WhitelistsPage() {
  const contacts = listContacts();
  const groups = listGroups();
  const patterns = listLinkPatterns();

  return (
    <div>
      <h1 className="mb-1 text-[22px] font-semibold">Whitelists</h1>
      <p className="mb-5 text-[13px] text-muted-foreground">Edits apply immediately — no restart needed.</p>

      <div className="grid grid-cols-3 items-start gap-5">
        <ContactPanel contacts={contacts} />
        <GroupPanel groups={groups} />
        <LinkPatternPanel patterns={patterns} />
      </div>
    </div>
  );
}
