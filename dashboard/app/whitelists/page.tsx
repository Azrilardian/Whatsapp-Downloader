import { listContacts, listLinkPatterns } from '@/lib/db';
import {
  deleteContactAction,
  deleteLinkPatternAction,
  saveContactAction,
  saveLinkPatternAction,
  setContactActiveAction,
  setLinkPatternActiveAction,
} from './actions';

export const dynamic = 'force-dynamic';

// FR-12/AD-2: the dashboard's only writable surface — contacts and
// link_patterns (plain <form> Server Actions; no client JS needed for CRUD).
export default function WhitelistsPage() {
  const contacts = listContacts();
  const patterns = listLinkPatterns();

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-semibold">Whitelists</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Only whitelisted senders and link patterns reach the pipeline. Edits take effect on the worker&apos;s next message — no restart.
      </p>

      <section className="mt-10">
        <h2 className="text-lg font-medium">Contacts</h2>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="pb-1">JID</th>
              <th className="pb-1">Label</th>
              <th className="pb-1">Active</th>
              <th className="pb-1" />
            </tr>
          </thead>
          <tbody>
            {contacts.map((c) => (
              <tr key={c.jid} className="border-t border-neutral-200 align-top dark:border-neutral-800">
                <td className="py-2 pr-2 font-mono text-xs">{c.jid}</td>
                <td className="py-2 pr-2">{c.label ?? ''}</td>
                <td className="py-2 pr-2">{c.active ? 'active' : 'inactive'}</td>
                <td className="py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <form action={setContactActiveAction.bind(null, c.jid, c.active !== 1)}>
                      <button type="submit" className="text-xs underline">
                        {c.active ? 'Deactivate' : 'Activate'}
                      </button>
                    </form>
                    <form action={deleteContactAction.bind(null, c.jid)}>
                      <button type="submit" className="text-xs text-red-600 underline dark:text-red-400">
                        Delete
                      </button>
                    </form>
                    <details>
                      <summary className="cursor-pointer text-xs underline">Edit</summary>
                      <form action={saveContactAction} className="mt-2 flex flex-col gap-1">
                        <input type="hidden" name="originalJid" value={c.jid} />
                        <input aria-label="JID" name="jid" defaultValue={c.jid} required className="rounded border px-2 py-1 text-xs" />
                        <input
                          aria-label="Label"
                          name="label"
                          defaultValue={c.label ?? ''}
                          placeholder="label"
                          className="rounded border px-2 py-1 text-xs"
                        />
                        <label className="flex items-center gap-1 text-xs">
                          <input type="checkbox" name="active" defaultChecked={c.active === 1} /> active
                        </label>
                        <button type="submit" className="w-fit rounded border px-2 py-1 text-xs">
                          Save
                        </button>
                      </form>
                    </details>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <details className="mt-4">
          <summary className="cursor-pointer text-sm underline">Add contact</summary>
          <form action={saveContactAction} className="mt-2 flex max-w-sm flex-col gap-2">
            <input aria-label="JID" name="jid" placeholder="628123456789@s.whatsapp.net" required className="rounded border px-2 py-1 text-sm" />
            <input aria-label="Label" name="label" placeholder="label (optional)" className="rounded border px-2 py-1 text-sm" />
            <label className="flex items-center gap-1 text-sm">
              <input type="checkbox" name="active" defaultChecked /> active
            </label>
            <button type="submit" className="w-fit rounded border px-3 py-1 text-sm">
              Add
            </button>
          </form>
        </details>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-medium">Link patterns</h2>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="pb-1">Pattern</th>
              <th className="pb-1">Type</th>
              <th className="pb-1">Active</th>
              <th className="pb-1" />
            </tr>
          </thead>
          <tbody>
            {patterns.map((p) => (
              <tr key={p.pattern} className="border-t border-neutral-200 align-top dark:border-neutral-800">
                <td className="py-2 pr-2 font-mono text-xs">{p.pattern}</td>
                <td className="py-2 pr-2">{p.type}</td>
                <td className="py-2 pr-2">{p.active ? 'active' : 'inactive'}</td>
                <td className="py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <form action={setLinkPatternActiveAction.bind(null, p.pattern, p.active !== 1)}>
                      <button type="submit" className="text-xs underline">
                        {p.active ? 'Deactivate' : 'Activate'}
                      </button>
                    </form>
                    <form action={deleteLinkPatternAction.bind(null, p.pattern)}>
                      <button type="submit" className="text-xs text-red-600 underline dark:text-red-400">
                        Delete
                      </button>
                    </form>
                    <details>
                      <summary className="cursor-pointer text-xs underline">Edit</summary>
                      <form action={saveLinkPatternAction} className="mt-2 flex flex-col gap-1">
                        <input type="hidden" name="originalPattern" value={p.pattern} />
                        <input aria-label="Pattern" name="pattern" defaultValue={p.pattern} required className="rounded border px-2 py-1 text-xs" />
                        <select aria-label="Pattern type" name="type" defaultValue={p.type} className="rounded border px-2 py-1 text-xs">
                          <option value="domain">domain</option>
                          <option value="extension">extension</option>
                        </select>
                        <label className="flex items-center gap-1 text-xs">
                          <input type="checkbox" name="active" defaultChecked={p.active === 1} /> active
                        </label>
                        <button type="submit" className="w-fit rounded border px-2 py-1 text-xs">
                          Save
                        </button>
                      </form>
                    </details>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <details className="mt-4">
          <summary className="cursor-pointer text-sm underline">Add link pattern</summary>
          <form action={saveLinkPatternAction} className="mt-2 flex max-w-sm flex-col gap-2">
            <input aria-label="Pattern" name="pattern" placeholder="build.example.com or .zip" required className="rounded border px-2 py-1 text-sm" />
            <select aria-label="Pattern type" name="type" defaultValue="domain" className="rounded border px-2 py-1 text-sm">
              <option value="domain">domain</option>
              <option value="extension">extension</option>
            </select>
            <label className="flex items-center gap-1 text-sm">
              <input type="checkbox" name="active" defaultChecked /> active
            </label>
            <button type="submit" className="w-fit rounded border px-3 py-1 text-sm">
              Add
            </button>
          </form>
        </details>
      </section>
    </main>
  );
}
