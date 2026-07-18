import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Db, ItemRow } from '@wadl/shared';
import { NON_TERMINAL_STATUSES, nowIso } from '@wadl/shared';

export interface ReconcileRoots {
  staging: string;
  final: string;
  quarantine: string;
  extract: string;
}

export interface ReconcileResult {
  /** The bounded work queue, rebuilt from `items` status post-reconciliation (AD-13). */
  queue: ItemRow[];
  resolved: number;
}

const NON_TERMINAL_PLACEHOLDERS = NON_TERMINAL_STATUSES.map(() => '?').join(',');

function recordEvent(db: Db, itemId: string | null, eventType: string, detail: string): void {
  db.prepare(
    'INSERT INTO events (event_id, item_id, event_type, detail, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(randomUUID(), itemId, eventType, detail, nowIso());
}

function setStatus(db: Db, itemId: string, status: string): void {
  db.prepare('UPDATE items SET status = ?, updated_at = ? WHERE item_id = ?').run(status, nowIso(), itemId);
}

/** A file or directory whose name is (or is namespaced under) the item_id — the on-disk half of AD-7's dir<->status invariant. */
function findArtifact(root: string, itemId: string): string | null {
  if (!existsSync(root)) return null;
  const match = readdirSync(root).find(
    (name) => name === itemId || name.startsWith(`${itemId}.`) || name.startsWith(`${itemId}-`),
  );
  return match ? join(root, match) : null;
}

function reconcileItem(db: Db, item: ItemRow, roots: ReconcileRoots): void {
  // AD-7: the artifact move happens *before* the status commit, so a crash in
  // that gap leaves the file already in its terminal root while the row is
  // still non-terminal. That work was already validated — complete the
  // bookkeeping rather than redoing or discarding already-trusted work.
  if (findArtifact(roots.final, item.item_id)) {
    setStatus(db, item.item_id, 'stored');
    recordEvent(db, item.item_id, 'reconciled_completed', 'artifact already in final/; status completed to stored');
    return;
  }
  if (findArtifact(roots.quarantine, item.item_id)) {
    setStatus(db, item.item_id, 'quarantined');
    recordEvent(
      db,
      item.item_id,
      'reconciled_completed',
      'artifact already in quarantine/; status completed to quarantined',
    );
    return;
  }

  switch (item.status) {
    case 'received':
    case 'validating':
      // No artifact can exist yet at these stages — nothing to clean up,
      // just safe to re-evaluate the gates from the top.
      setStatus(db, item.item_id, 'received');
      recordEvent(db, item.item_id, 'reconciled_requeued', `${item.status} -> received (no artifact expected)`);
      return;

    case 'downloading': {
      // An in-progress download can never be trusted as complete — discard
      // any partial bytes and re-fetch from scratch.
      const partial = findArtifact(roots.staging, item.item_id);
      if (partial) rmSync(partial, { recursive: true, force: true });
      setStatus(db, item.item_id, 'received');
      recordEvent(db, item.item_id, 'reconciled_requeued', 'downloading -> received (partial download discarded)');
      return;
    }

    case 'scanning': {
      // The file finished downloading before the crash (that's what advanced
      // it to `scanning`) and sits intact in staging/, matching the
      // invariant — re-run the scan rather than re-fetch.
      const staged = findArtifact(roots.staging, item.item_id);
      if (staged) {
        setStatus(db, item.item_id, 'scanning');
        recordEvent(db, item.item_id, 'reconciled_requeued', 'scanning -> scanning (artifact intact, scan re-run)');
      } else {
        // Invariant violated: status says scanning but no artifact exists.
        setStatus(db, item.item_id, 'received');
        recordEvent(db, item.item_id, 'reconciled_requeued', 'scanning -> received (artifact missing, re-fetch)');
      }
      return;
    }

    case 'extracting':
    default: {
      // A mid-extraction state can't be trusted partially applied — bomb
      // caps and canonical-path symlink checks may not have finished —  so
      // fail closed to quarantine and drop whatever extract/ holds.
      const extracted = findArtifact(roots.extract, item.item_id);
      if (extracted) rmSync(extracted, { recursive: true, force: true });
      setStatus(db, item.item_id, 'quarantined');
      recordEvent(
        db,
        item.item_id,
        'reconciled_quarantined',
        `${item.status} -> quarantined (in-flight extraction not trusted)`,
      );
    }
  }
}

/**
 * AD-15: on every worker start, resolve every non-terminal `items` row and
 * every file against AD-7's dir<->status invariant before anything is
 * trusted — a mismatch or in-flight item is always re-queued from a safe
 * earlier stage or moved to quarantine, never advanced. The bounded queue is
 * then rebuilt from `items` status, not held only in memory (AD-13).
 */
export function reconcileOnStartup(db: Db, roots: ReconcileRoots): ReconcileResult {
  const nonTerminal = db
    .prepare(`SELECT * FROM items WHERE status IN (${NON_TERMINAL_PLACEHOLDERS})`)
    .all(...NON_TERMINAL_STATUSES) as ItemRow[];

  for (const item of nonTerminal) {
    reconcileItem(db, item, roots);
  }

  const queue = db
    .prepare(`SELECT * FROM items WHERE status IN (${NON_TERMINAL_PLACEHOLDERS}) ORDER BY created_at`)
    .all(...NON_TERMINAL_STATUSES) as ItemRow[];

  recordEvent(db, null, 'startup_reconciled', `${nonTerminal.length} item(s) resolved, queue rebuilt (${queue.length})`);

  return { queue, resolved: nonTerminal.length };
}
