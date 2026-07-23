import type { Db, LinkPatternRow } from '@wadl/shared';
import { extractUrls, findMatchingUrls } from '@wadl/shared';

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

/**
 * FR-19/AD-18: a message sent inside an active whitelisted group satisfies
 * the sender gate for any participant, independent of that participant's
 * own Contact-whitelist status.
 */
export function isGroupWhitelisted(db: Db, groupJid: string): boolean {
  const row = db.prepare('SELECT active FROM groups WHERE group_jid = ?').get(groupJid) as
    | { active: 0 | 1 }
    | undefined;
  return row?.active === 1;
}

/**
 * FR-1/FR-19/AD-18: resolve the sender gate from raw Baileys message-key
 * shape. `participant` is present only on group messages (the actual
 * sender inside the group); `remoteJid` is the conversation — a group JID
 * for group messages, the person JID for 1:1. A group message passes if
 * the group itself is whitelisted OR the participant is individually
 * whitelisted (OR-semantics — whitelisting a group is meant to admit any
 * member, not require re-whitelisting each one). A 1:1 message passes only
 * via the Contact whitelist.
 */
export function isMessageSenderWhitelisted(
  db: Db,
  key: { remoteJid: string; participant: string | null },
): boolean {
  if (key.participant) {
    return isGroupWhitelisted(db, key.remoteJid) || isSenderWhitelisted(db, key.participant);
  }
  return isSenderWhitelisted(db, key.remoteJid);
}

/**
 * FR-2/AD-12: from a whitelisted sender's message text, extract candidate
 * URLs and keep only the ones matching an active link_patterns entry, via
 * the one shared matcher module. Read live on every call — a whitelist edit
 * takes effect on the next message, no restart (AD-5, FR-11).
 */
export function evaluateLinkGate(db: Db, text: string): string[] {
  const candidates = extractUrls(text);
  if (candidates.length === 0) return [];
  const activePatterns = db.prepare('SELECT * FROM link_patterns WHERE active = 1').all() as LinkPatternRow[];
  if (activePatterns.length === 0) return [];
  return findMatchingUrls(candidates, activePatterns);
}
