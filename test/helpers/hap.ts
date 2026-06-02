import { Characteristic, Service } from '@homebridge/hap-nodejs';
import type { Logging, PlatformAccessory } from 'homebridge';
import { vi } from 'vitest';

import type { StoveControls, StoveStatus } from '../../src/api/types.js';
import type { ResolvedConfig, ServiceContext } from '../../src/accessory/context.js';

/**
 * Minimal accessory container backed by real HAP `Service` instances. Mirrors
 * the subset of the `PlatformAccessory` API the service modules rely on.
 */
class FakeAccessory {
  readonly services: Service[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getService(type: any): Service | undefined {
    return this.services.find((service) => service instanceof type);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getServiceById(type: any, subtype: string): Service | undefined {
    return this.services.find(
      (service) => service instanceof type && service.subtype === subtype,
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addService(type: any, ...args: unknown[]): Service {
    const service = typeof type === 'function' ? new type(...args) : type;
    this.services.push(service);
    return service;
  }
}

export interface FakePoller {
  getLatest: () => StoveStatus | null;
  onUpdate: (listener: (status: StoveStatus) => void) => () => void;
  applyPatch: ReturnType<typeof vi.fn>;
  emit: (status: StoveStatus) => void;
}

export function createFakePoller(initial: StoveStatus | null = null): FakePoller {
  let latest = initial;
  const listeners = new Set<(status: StoveStatus) => void>();
  return {
    getLatest: () => latest,
    onUpdate(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    applyPatch: vi.fn(async (patch: Partial<StoveControls>) => {
      if (latest) {
        latest = { ...latest, controls: { ...latest.controls, ...patch } };
      }
    }),
    emit(status) {
      latest = status;
      for (const listener of listeners) {
        listener(status);
      }
    },
  };
}

export function createLogger(): Logging {
  const log = vi.fn() as unknown as Logging;
  log.info = vi.fn();
  log.warn = vi.fn();
  log.error = vi.fn();
  log.debug = vi.fn();
  log.log = vi.fn();
  log.success = vi.fn();
  log.prefix = '';
  return log;
}

export function createConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    name: 'Test Stove',
    stoveId: '12345678',
    minTemperature: 14,
    maxTemperature: 28,
    ...overrides,
  };
}

export interface BuiltContext {
  ctx: ServiceContext;
  accessory: FakeAccessory;
  poller: FakePoller;
}

export function buildContext(
  poller: FakePoller,
  configOverrides: Partial<ResolvedConfig> = {},
): BuiltContext {
  const accessory = new FakeAccessory();
  const ctx: ServiceContext = {
    Service,
    Characteristic,
    accessory: accessory as unknown as PlatformAccessory,
    poller: poller as unknown as ServiceContext['poller'],
    log: createLogger(),
    config: createConfig(configOverrides),
  };
  return { ctx, accessory, poller };
}

export { Characteristic, Service };
