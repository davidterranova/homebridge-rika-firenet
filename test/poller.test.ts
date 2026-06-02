import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RikaFirenetClient } from '../src/api/client.js';
import { OutdatedRevisionError } from '../src/api/errors.js';
import type { StoveControls, StoveStatus } from '../src/api/types.js';
import { StovePoller } from '../src/poller.js';
import { makeStatus } from './helpers/fixtures.js';

interface FakeClient {
  getStatus: ReturnType<typeof vi.fn>;
  setControls: ReturnType<typeof vi.fn>;
}

function fakeClient(status: StoveStatus): FakeClient {
  return {
    getStatus: vi.fn(async () => makeStatus({ controls: { revision: status.controls.revision } })),
    setControls: vi.fn(async () => {}),
  };
}

function newPoller(client: FakeClient, overrides: Partial<{ intervalMs: number; coalesceMs: number }> = {}) {
  return new StovePoller({
    client: client as unknown as RikaFirenetClient,
    stoveId: '12345678',
    intervalMs: overrides.intervalMs ?? 60_000,
    coalesceMs: overrides.coalesceMs ?? 50,
  });
}

describe('StovePoller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('performs an initial refresh and notifies subscribers', async () => {
    const client = fakeClient(makeStatus());
    const poller = newPoller(client);
    const listener = vi.fn();
    poller.onUpdate(listener);

    await poller.start();

    expect(client.getStatus).toHaveBeenCalledTimes(1);
    expect(poller.getLatest()).not.toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    poller.stop();
  });

  it('enforces a minimum 60s polling interval', async () => {
    const client = fakeClient(makeStatus());
    const poller = newPoller(client, { intervalMs: 1_000 });

    await poller.start();
    expect(client.getStatus).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(59_000);
    expect(client.getStatus).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(client.getStatus).toHaveBeenCalledTimes(2);
    poller.stop();
  });

  it('applies optimistic updates immediately', async () => {
    const client = fakeClient(makeStatus({ controls: { targetTemperature: '20' } }));
    const poller = newPoller(client);
    await poller.start();

    void poller.applyPatch({ targetTemperature: '24' });
    expect(poller.getLatest()?.controls.targetTemperature).toBe('24');
    poller.stop();
  });

  it('coalesces a burst of writes into a single POST', async () => {
    const client = fakeClient(makeStatus({ controls: { revision: 10 } }));
    const poller = newPoller(client, { coalesceMs: 50 });
    await poller.start();

    const p1 = poller.applyPatch({ targetTemperature: '22' });
    const p2 = poller.applyPatch({ heatingPower: 70 });

    await vi.advanceTimersByTimeAsync(60);
    await Promise.all([p1, p2]);

    expect(client.setControls).toHaveBeenCalledTimes(1);
    const payload = client.setControls.mock.calls[0]![1] as StoveControls;
    expect(payload.targetTemperature).toBe('22');
    expect(payload.heatingPower).toBe(70);
    expect(payload.revision).toBe(10);
    poller.stop();
  });

  it('retries with a refreshed revision when the write is outdated', async () => {
    const client = fakeClient(makeStatus({ controls: { revision: 10 } }));
    client.setControls
      .mockRejectedValueOnce(new OutdatedRevisionError())
      .mockResolvedValueOnce(undefined);

    const poller = newPoller(client, { coalesceMs: 50 });
    await poller.start();
    const initialGetCalls = client.getStatus.mock.calls.length;

    const promise = poller.applyPatch({ targetTemperature: '22' });
    await vi.advanceTimersByTimeAsync(60);
    await promise;

    expect(client.setControls).toHaveBeenCalledTimes(2);
    // One refresh for the retry + one final refresh after success.
    expect(client.getStatus.mock.calls.length).toBe(initialGetCalls + 2);
    poller.stop();
  });

  it('rejects applyPatch before the first status is available', async () => {
    const client = fakeClient(makeStatus());
    const poller = newPoller(client);
    await expect(poller.applyPatch({ onOff: true })).rejects.toThrow();
    poller.stop();
  });
});
