import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, runMigrations } from '@wadl/shared';
import { MIGRATIONS_DIR } from './paths.ts';
import { DownloadQueue } from './concurrency.ts';

// Task 16 self-check (FR-3/FR-5/AD-13/AD-17): downloads run at max
// max_concurrent at a time; a sender past per_sender_rate_per_min queues
// (never runs) even when a concurrency slot is free; both read live.
// Run: npx tsx src/check-concurrency.ts

const root = mkdtempSync(join(tmpdir(), 'wadl-concurrency-'));
const db = openDb(join(root, 'app.db'));
runMigrations(db, MIGRATIONS_DIR);

try {
  let clock = 0;
  const queue = new DownloadQueue(db, { now: () => clock });

  function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  // case 1: max_concurrent=2 (default) -> a 3rd task from distinct senders overflows to pending, not run.
  {
    const gates = [deferred(), deferred(), deferred()];
    const started: number[] = [];
    const results = [0, 1, 2].map((i) =>
      queue.enqueue(`sender-${i}@s.whatsapp.net`, async () => {
        started.push(i);
        await gates[i]!.promise;
      }),
    );
    // synchronous enqueue calls have all run drain(); give the microtask queue a tick.
    await Promise.resolve();
    assert.equal(queue.runningCount, 2, 'only max_concurrent tasks run at once');
    assert.equal(queue.pendingCount, 1, 'overflow queues rather than runs');
    assert.deepEqual(started.slice().sort(), [0, 1]);

    gates[0]!.resolve();
    await results[0];
    await Promise.resolve();
    assert.equal(queue.runningCount, 2, 'a freed slot is immediately backfilled from the pending queue');
    assert.deepEqual(started.slice().sort(), [0, 1, 2]);

    gates[1]!.resolve();
    gates[2]!.resolve();
    await Promise.all(results);
  }

  // case 1b: max_concurrent is read live, not hardcoded to the seeded default of 2.
  {
    db.prepare('UPDATE settings SET value = ? WHERE key = ?').run('1', 'max_concurrent');
    const gates = [deferred(), deferred()];
    const results = [0, 1].map((i) =>
      queue.enqueue(`live-${i}@s.whatsapp.net`, async () => {
        await gates[i]!.promise;
      }),
    );
    await Promise.resolve();
    assert.equal(queue.runningCount, 1, 'lowered max_concurrent is enforced without a restart');
    assert.equal(queue.pendingCount, 1);
    gates[0]!.resolve();
    gates[1]!.resolve();
    await Promise.all(results);
    db.prepare('UPDATE settings SET value = ? WHERE key = ?').run('2', 'max_concurrent');
  }

  // case 2: per_sender_rate_per_min exceeded -> same sender queues even with a free concurrency slot.
  {
    db.prepare('UPDATE settings SET value = ? WHERE key = ?').run('1', 'per_sender_rate_per_min');
    const gate = deferred();
    const first = queue.enqueue('flooder@s.whatsapp.net', async () => {
      await gate.promise;
    });
    await Promise.resolve();
    assert.equal(queue.runningCount, 1);

    let secondStarted = false;
    const second = queue.enqueue('flooder@s.whatsapp.net', async () => {
      secondStarted = true;
    });
    await Promise.resolve();
    assert.equal(secondStarted, false, 'second task from the same sender queues instead of running over its rate cap');
    assert.equal(queue.pendingCount, 1);

    gate.resolve();
    await first;
    await Promise.resolve();
    assert.equal(secondStarted, false, 'still held: the first task counts against the rate window until it elapses');

    // advance the clock past the rate window -> the queued task is now allowed.
    clock += 60_000;
    queue.enqueue('unrelated@s.whatsapp.net', async () => {}); // any enqueue re-triggers drain()
    await second;
    await Promise.resolve();
    assert.equal(secondStarted, true);
    db.prepare('UPDATE settings SET value = ? WHERE key = ?').run('10', 'per_sender_rate_per_min');
  }

  console.log('check-concurrency: ok');
} finally {
  db.close();
  rmSync(root, { recursive: true, force: true });
}
