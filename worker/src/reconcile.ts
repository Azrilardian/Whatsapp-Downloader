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

// A download in progress writes to `<item_id>.part` and is renamed to its
// final name only once complete — so a `.part` file is never a trustworthy
// artifact, no matter what status the row currently claims.
const PARTIAL_SUFFIX = '.part';

function recordEvent(db: Db, itemId: string | null, eventType: string, detail: string): void {
  db.prepare(
    'INSERT INTO events (event_id, item_id, event_type, detail, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(randomUUID(), itemId, eventType, detail, nowIso());
}

function setStatus(db: Db, itemId: string, status: string): void {
  db.prepare('UPDATE items SET status = ?, updated_at = ? WHERE item_id = ?').run(status, nowIso(), itemId);
}

/** Status write + its reconciliation audit event, atomically — a crash between the two must never leave one without the other. */
function transitionItem(db: Db, itemId: string, status: string, eventType: string, detail: string): void {
  db.transaction(() => {
    setStatus(db, itemId, status);
    recordEvent(db, itemId, eventType, detail);
  })();
}

/** The canonical completed artifact for itemId — never an in-progress `.part` file. */
function findArtifact(root: string, itemId: string): string | null {
  if (!existsSync(root)) return null;
  const match = readdirSync(root).find(
    (name) =>
      (name === itemId || name.startsWith(`${itemId}.`) || name.startsWith(`${itemId}-`)) &&
      !name.endsWith(PARTIAL_SUFFIX),
  );
  return match ? join(root, match) : null;
}

/** An in-progress `.part` download marker for itemId, if one was left behind. */
function findPartialArtifact(root: string, itemId: string): string | null {
  if (!existsSync(root)) return null;
  const match = readdirSync(root).find((name) => name.startsWith(itemId) && name.endsWith(PARTIAL_SUFFIX));
  return match ? join(root, match) : null;
}

function reconcileItem(db: Db, item: ItemRow, roots: ReconcileRoots): void {
  // AD-7: the artifact move happens *before* the status commit, so a crash in
  // that gap leaves the file already in its terminal root while the row is
  // still non-terminal. That work was already validated — complete the
  // bookkeeping rather than redoing or discarding already-trusted work.
  if (findArtifact(roots.final, item.item_id)) {
    transitionItem(
      db,
      item.item_id,
      'stored',
      'reconciled_completed',
      'artifact already in final/; status completed to stored',
    );
    return;
  }
  if (findArtifact(roots.quarantine, item.item_id)) {
    transitionItem(
      db,
      item.item_id,
      'quarantined',
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
      transitionItem(
        db,
        item.item_id,
        'received',
        'reconciled_requeued',
        `${item.status} -> received (no artifact expected)`,
      );
      return;

    case 'downloading': {
      // An in-progress download can never be trusted as complete — discard
      // any bytes (partial or, if status lagged, complete) and re-fetch.
      const artifact = findPartialArtifact(roots.staging, item.item_id) ?? findArtifact(roots.staging, item.item_id);
      if (artifact) rmSync(artifact, { recursive: true, force: true });
      transitionItem(
        db,
        item.item_id,
        'received',
        'reconciled_requeued',
        'downloading -> received (partial download discarded)',
      );
      return;
    }

    case 'scanning': {
      // The file finished downloading before the crash (that's what advanced
      // it to `scanning`) and sits intact in staging/, matching the
      // invariant — re-run the scan rather than re-fetch. A `.part` file
      // alone is not that artifact, no matter how it got there.
      const staged = findArtifact(roots.staging, item.item_id);
      if (staged) {
        transitionItem(
          db,
          item.item_id,
          'scanning',
          'reconciled_requeued',
          'scanning -> scanning (artifact intact, scan re-run)',
        );
        return;
      }
      const partial = findPartialArtifact(roots.staging, item.item_id);
      if (partial) rmSync(partial, { recursive: true, force: true });
      transitionItem(
        db,
        item.item_id,
        'received',
        'reconciled_requeued',
        partial
          ? 'scanning -> received (only a partial download found, discarded)'
          : 'scanning -> received (artifact missing, re-fetch)',
      );
      return;
    }

    case 'extracting':
    default: {
      // A mid-extraction state can't be trusted partially applied — bomb
      // caps and canonical-path symlink checks may not have finished —  so
      // fail closed to quarantine and drop whatever extract/ holds.
      const extracted = findArtifact(roots.extract, item.item_id);
      if (extracted) rmSync(extracted, { recursive: true, force: true });
      transitionItem(
        db,
        item.item_id,
        'quarantined',
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
