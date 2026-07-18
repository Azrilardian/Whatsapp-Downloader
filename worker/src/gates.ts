import type { Db } from '@wadl/shared';

/**
 * FR-1/AD-2: process a message only if its sender matches an active
 * `contacts` entry — a deactivated entry is treated exactly like no entry
 * at all, i.e. not whitelisted.
 */
export function isSenderWhitelisted(db: Db, senderJid: string): boolean {
  const row = db.prepare('SELECT active FROM contacts WHERE jid = ?').get(senderJid) as
    | { active: 0 | 1 }
    | undefined;
  return row?.active === 1;
}
