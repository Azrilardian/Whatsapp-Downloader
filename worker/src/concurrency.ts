import type { Db } from '@wadl/shared';

function getSetting(db: Db, key: string, fallback: string): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? fallback;
}

function resolveBoundedInt(raw: string, fallback: number): number {
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const RATE_WINDOW_MS = 60_000;
// ponytail: fixed cap on in-memory overflow — items rows are the durable
// queue (AD-15 rebuilds them on restart), this just stops one flooding
// sender from growing `pending` unbounded before the rate window frees up.
const MAX_PENDING = 1000;

interface QueuedTask {
  senderJid: string;
  run: () => Promise<void>;
  resolve: () => void;
  reject: (err: unknown) => void;
}

export interface QueueDeps {
  now?: () => number;
}

/**
 * AD-13/17: bounds simultaneous downloads (`max_concurrent`) and caps each
 * sender's throughput (`per_sender_rate_per_min`), both read live from
 * `settings` on every scheduling decision — no restart needed to retune.
 * Overflow queues (FIFO, skipping over a sender currently at its cap so one
 * flooding sender can't starve the rest) rather than running over either
 * limit.
 *
 * ponytail: the queue itself holds no persisted state — `items` rows already
 * are the durable queue (AD-15's startup reconciliation rebuilds in-flight
 * work from them), so this class only needs to exist in memory for the
 * lifetime of the worker process.
 */
export class DownloadQueue {
  private running = 0;
  private pending: QueuedTask[] = [];
  private senderTimestamps = new Map<string, number[]>();
  private timer: NodeJS.Timeout | null = null;
  private readonly now: () => number;

  constructor(private readonly db: Db, deps?: QueueDeps) {
    this.now = deps?.now ?? Date.now;
  }

  get runningCount(): number {
    return this.running;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  enqueue(senderJid: string, run: () => Promise<void>): Promise<void> {
    if (this.pending.length >= MAX_PENDING) {
      return Promise.reject(new Error(`download queue overflow: ${MAX_PENDING} pending`));
    }
    return new Promise((resolve, reject) => {
      this.pending.push({ senderJid, run, resolve, reject });
      this.drain();
    });
  }

  private maxConcurrent(): number {
    return resolveBoundedInt(getSetting(this.db, 'max_concurrent', '2'), 2);
  }

  private perSenderRate(): number {
    return resolveBoundedInt(getSetting(this.db, 'per_sender_rate_per_min', '10'), 10);
  }

  /** now if the sender has room in its rate window, else the timestamp the window next frees up. */
  private nextAllowedAt(senderJid: string, now: number): number {
    const limit = this.perSenderRate();
    const timestamps = (this.senderTimestamps.get(senderJid) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
    this.senderTimestamps.set(senderJid, timestamps);
    if (timestamps.length < limit) return now;
    return timestamps[0]! + RATE_WINDOW_MS;
  }

  private start(task: QueuedTask, now: number): void {
    this.running += 1;
    const timestamps = this.senderTimestamps.get(task.senderJid) ?? [];
    timestamps.push(now);
    this.senderTimestamps.set(task.senderJid, timestamps);

    Promise.resolve()
      .then(() => task.run())
      .then(
        () => {
          this.running -= 1;
          task.resolve();
          this.drain();
        },
        (err: unknown) => {
          this.running -= 1;
          task.reject(err);
          this.drain();
        },
      );
  }

  private drain(): void {
    const maxConcurrent = this.maxConcurrent();
    const now = this.now();
    let earliestRetry: number | null = null;

    for (let i = 0; i < this.pending.length && this.running < maxConcurrent; ) {
      const task = this.pending[i];
      if (!task) break;
      const nextAllowedAt = this.nextAllowedAt(task.senderJid, now);
      if (nextAllowedAt > now) {
        earliestRetry = earliestRetry === null ? nextAllowedAt : Math.min(earliestRetry, nextAllowedAt);
        i += 1;
        continue;
      }
      this.pending.splice(i, 1);
      this.start(task, now);
    }

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (earliestRetry !== null) {
      const delay = Math.max(0, earliestRetry - now);
      this.timer = setTimeout(() => {
        this.timer = null;
        this.drain();
      }, delay);
      this.timer.unref?.();
    }
  }
}
