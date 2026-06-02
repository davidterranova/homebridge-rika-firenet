import type { Characteristic, Logging, PlatformAccessory, Service } from 'homebridge';

import type { StoveStatus } from '../api/types.js';
import type { StovePoller } from '../poller.js';

/** Configuration resolved and normalized from the Homebridge platform config. */
export interface ResolvedConfig {
  name: string;
  stoveId: string;
  minTemperature: number;
  maxTemperature: number;
}

/** Everything a composable service module needs to wire itself up. */
export interface ServiceContext {
  /** HAP `Service` constructor (with the service type constants). */
  readonly Service: typeof Service;
  /** HAP `Characteristic` constructor (with the characteristic constants). */
  readonly Characteristic: typeof Characteristic;
  readonly accessory: PlatformAccessory;
  readonly poller: StovePoller;
  readonly log: Logging;
  readonly config: ResolvedConfig;
}

/**
 * A composed service. Each module owns one HomeKit service, registers its own
 * get/set handlers and exposes an {@link update} hook that the accessory calls
 * whenever a fresh status arrives.
 */
export interface ServiceModule {
  update(status: StoveStatus): void;
}

export type ServiceFactory = (ctx: ServiceContext) => ServiceModule;
