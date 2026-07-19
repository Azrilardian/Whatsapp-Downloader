import { listContacts, listLinkPatterns } from '@/lib/db';
import { ContactPanel } from '@/components/contact-panel';
import { LinkPatternPanel } from '@/components/link-pattern-panel';

export const dynamic = 'force-dynamic';

// FR-12/AD-2: the dashboard's only writable surface — contacts and
// link_patterns (plain <form> Server Actions; no client JS needed for CRUD).
export default function WhitelistsPage() {
  const contacts = listContacts();
  const patterns = listLinkPatterns();

  return (
    <div>
      <h1 className="mb-1 text-[22px] font-semibold">Whitelists</h1>
      <p className="mb-5 text-[13px] text-muted-foreground">Edits apply immediately — no restart needed.</p>

      <div className="grid grid-cols-2 items-start gap-5">
        <ContactPanel contacts={contacts} />
        <LinkPatternPanel patterns={patterns} />
      </div>
    </div>
  );
}
