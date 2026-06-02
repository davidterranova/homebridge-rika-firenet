import type { RikaFirenetClient, ClientLogger } from './api/client.js';
import { OutdatedRevisionError } from './api/errors.js';
import type { StoveControls, StoveStatus } from './api/types.js';
import { buildControlsPayload } from './domain/controls.js';

export type StatusListener = (status: StoveStatus) => void;

export interface StovePollerOptions {
  client: RikaFirenetClient;
  stoveId: string;
  /** Polling interval in milliseconds (enforced minimum 60s). */
  intervalMs: number;
  logger?: ClientLogger;
  /** Debounce window (ms) used to coalesce rapid control writes. */
  coalesceMs?: number;
  /** Maximum retries when the controls revision is reported outdated. */
  maxRevisionRetries?: number;
}

const MIN_INTERVAL_MS = 60_000;
const DEFAULT_COALESCE_MS = 400;
const DEFAULT_MAX_REVISION_RETRIES = 3;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const noopLogger: ClientLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * Owns the single polling loop and the single in-memory {@link StoveStatus}
 * snapshot for one stove. Subscribers are notified on every refresh and on
 * optimistic control updates. Control writes are coalesced so that a burst of
 * HomeKit changes collapses into a single `POST`.
 */
export class StovePoller {
  private readonly client: RikaFirenetClient;
  private readonly stoveId: string;
  private readonly intervalMs: number;
  private readonly coalesceMs: number;
  private readonly maxRevisionRetries: number;
  private readonly log: ClientLogger;

  private readonly listeners = new Set<StatusListener>();

  private latest: StoveStatus | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  private pendingPatch: Partial<StoveControls> = {};
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushDeferred: Deferred<void> | null = null;

  constructor(options: StovePollerOptions) {
    this.client = options.client;
    this.stoveId = options.stoveId;
    this.intervalMs = Math.max(MIN_INTERVAL_MS, options.intervalMs);
    this.coalesceMs = options.coalesceMs ?? DEFAULT_COALESCE_MS;
    this.maxRevisionRetries = options.maxRevisionRetries ?? DEFAULT_MAX_REVISION_RETRIES;
    this.log = options.logger ?? noopLogger;
  }

  /** The latest known status, or `null` until the first refresh succeeds. */
  getLatest(): StoveStatus | null {
    return this.latest;
  }

  /** Subscribes to status updates. Returns an unsubscribe function. */
  onUpdate(listener: StatusListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Performs an initial refresh and starts the periodic polling loop. */
  async start(): Promise<void> {
    await this.refresh();
    this.timer = setInterval(() => {
      void this.refresh();
    }, this.intervalMs);
    // Do not keep the event loop alive solely for polling.
    this.timer.unref?.();
  }

  /** Stops the polling loop and cancels any pending control flush. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.listeners.clear();
  }

  /** Fetches the latest status from the API and notifies subscribers. */
  async refresh(): Promise<StoveStatus | null> {
    try {
      const status = await this.client.getStatus(this.stoveId);
      this.latest = status;
      this.notify();
      return status;
    } catch (err) {
      this.log.warn(`Failed to refresh stove ${this.stoveId} status: ${stringifyError(err)}`);
      return null;
    }
  }

  /**
   * Applies a controls patch. The change is reflected locally immediately
   * (optimistic update) and the actual `POST` is debounced/coalesced. Resolves
   * once the coalesced write has been sent and the authoritative status
   * refreshed.
   */
  applyPatch(patch: Partial<StoveControls>): Promise<void> {
    if (!this.latest) {
      return Promise.reject(new Error('Cannot apply controls before the first status is loaded'));
    }

    this.applyOptimistic(patch);
    Object.assign(this.pendingPatch, patch);

    if (!this.flushDeferred) {
      this.flushDeferred = createDeferred<void>();
    }
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }
    this.flushTimer = setTimeout(() => {
      void this.flush();
    }, this.coalesceMs);

    return this.flushDeferred.promise;
  }

  private applyOptimistic(patch: Partial<StoveControls>): void {
    if (!this.latest) {
      return;
    }
    this.latest = {
      ...this.latest,
      controls: { ...this.latest.controls, ...patch },
    };
    this.notify();
  }

  private async flush(): Promise<void> {
    this.flushTimer = null;
    const deferred = this.flushDeferred;
    this.flushDeferred = null;
    const patch = this.pendingPatch;
    this.pendingPatch = {};

    if (!deferred) {
      return;
    }

    try {
      await this.writeControls(patch);
      await this.refresh();
      deferred.resolve();
    } catch (err) {
      this.log.error(`Failed to update stove ${this.stoveId} controls: ${stringifyError(err)}`);
      // Re-sync so HomeKit reflects the true state after a failed write.
      await this.refresh();
      deferred.reject(err);
    }
  }

  private async writeControls(patch: Partial<StoveControls>): Promise<void> {
    for (let attempt = 0; attempt <= this.maxRevisionRetries; attempt++) {
      const current = this.latest?.controls;
      if (!current) {
        throw new Error('No controls available to build the update payload');
      }
      const payload = buildControlsPayload(current, patch);
      try {
        await this.client.setControls(this.stoveId, payload);
        return;
      } catch (err) {
        if (err instanceof OutdatedRevisionError && attempt < this.maxRevisionRetries) {
          this.log.debug(`Revision outdated for stove ${this.stoveId}, refreshing and retrying`);
          await this.refresh();
          continue;
        }
        throw err;
      }
    }
  }

  private notify(): void {
    if (!this.latest) {
      return;
    }
    for (const listener of this.listeners) {
      try {
        listener(this.latest);
      } catch (err) {
        this.log.error(`Status listener threw: ${stringifyError(err)}`);
      }
    }
  }
}

function stringifyError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
