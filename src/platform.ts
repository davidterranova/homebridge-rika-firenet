import type {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge';

import { RikaFirenetClient } from './api/client.js';
import type { ResolvedConfig } from './accessory/context.js';
import { StoveAccessory } from './accessory/stoveAccessory.js';
import { StovePoller } from './poller.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';

interface RikaFirenetPlatformConfig extends PlatformConfig {
  email?: string;
  password?: string;
  stoveID?: string;
  pollingInterval?: number;
  minTemperature?: number;
  maxTemperature?: number;
}

const DEFAULT_POLLING_SECONDS = 60;
const DEFAULT_MIN_TEMPERATURE = 14;
const DEFAULT_MAX_TEMPERATURE = 28;

/**
 * Dynamic platform that exposes a single RIKA Firenet stove as a HomeKit
 * accessory. All network access flows through one shared {@link RikaFirenetClient}
 * and one {@link StovePoller}, keeping the memory and connection footprint minimal.
 */
export class RikaFirenetPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  private readonly cachedAccessories: PlatformAccessory[] = [];
  private readonly config: RikaFirenetPlatformConfig;

  private client?: RikaFirenetClient;
  private poller?: StovePoller;

  constructor(
    private readonly log: Logging,
    config: PlatformConfig,
    private readonly api: API,
  ) {
    this.config = config as RikaFirenetPlatformConfig;
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    this.api.on('didFinishLaunching', () => {
      void this.bootstrap();
    });
    this.api.on('shutdown', () => {
      this.shutdown();
    });
  }

  /** Called by Homebridge for every accessory restored from disk cache. */
  configureAccessory(accessory: PlatformAccessory): void {
    this.log.debug(`Restoring cached accessory: ${accessory.displayName}`);
    this.cachedAccessories.push(accessory);
  }

  private async bootstrap(): Promise<void> {
    const { email, password } = this.config;
    if (!email || !password) {
      this.log.error('Missing "email" and/or "password" in the RIKA Firenet platform config.');
      return;
    }

    this.client = new RikaFirenetClient({ email, password, logger: this.log });

    try {
      const stoveId = await this.resolveStoveId();
      const config = this.resolveConfig(stoveId);

      this.poller = new StovePoller({
        client: this.client,
        stoveId,
        intervalMs: (this.config.pollingInterval ?? DEFAULT_POLLING_SECONDS) * 1000,
        logger: this.log,
      });

      const accessory = this.obtainAccessory(config);
      new StoveAccessory({
        Service: this.Service,
        Characteristic: this.Characteristic,
        accessory,
        poller: this.poller,
        log: this.log,
        config,
      });

      await this.poller.start();
      this.log.info(`RIKA Firenet stove "${config.name}" (${stoveId}) is ready.`);
    } catch (err) {
      this.log.error(`Failed to initialize RIKA Firenet plugin: ${stringifyError(err)}`);
    }
  }

  /** Resolves the stove id from config, or auto-detects a single stove. */
  private async resolveStoveId(): Promise<string> {
    const stoves = await this.client!.login();
    if (stoves.length === 0) {
      throw new Error('No stoves are associated with this RIKA Firenet account.');
    }

    const configured = this.config.stoveID?.toString().trim();
    if (configured) {
      const match = stoves.find((stove) => stove.id === configured);
      if (!match) {
        const ids = stoves.map((stove) => stove.id).join(', ');
        throw new Error(`Configured stoveID "${configured}" not found. Available: ${ids}`);
      }
      return match.id;
    }

    if (stoves.length > 1) {
      const ids = stoves.map((stove) => `${stove.name} (${stove.id})`).join(', ');
      throw new Error(`Multiple stoves found; set "stoveID" in the config. Available: ${ids}`);
    }

    return stoves[0]!.id;
  }

  private resolveConfig(stoveId: string): ResolvedConfig {
    const minTemperature = this.config.minTemperature ?? DEFAULT_MIN_TEMPERATURE;
    const maxTemperature = this.config.maxTemperature ?? DEFAULT_MAX_TEMPERATURE;
    return {
      name: typeof this.config.name === 'string' && this.config.name ? this.config.name : 'Rika Stove',
      stoveId,
      minTemperature,
      maxTemperature: Math.max(maxTemperature, minTemperature + 1),
    };
  }

  /** Returns a cached accessory matching the stove, or registers a new one. */
  private obtainAccessory(config: ResolvedConfig): PlatformAccessory {
    const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:${config.stoveId}`);

    // Remove any stale cached accessories that no longer match the configuration.
    const stale = this.cachedAccessories.filter((accessory) => accessory.UUID !== uuid);
    if (stale.length > 0) {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
    }

    const existing = this.cachedAccessories.find((accessory) => accessory.UUID === uuid);
    if (existing) {
      existing.displayName = config.name;
      this.api.updatePlatformAccessories([existing]);
      return existing;
    }

    const accessory = new this.api.platformAccessory(config.name, uuid);
    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    return accessory;
  }

  private shutdown(): void {
    this.poller?.stop();
    void this.client?.logout();
  }
}

function stringifyError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
