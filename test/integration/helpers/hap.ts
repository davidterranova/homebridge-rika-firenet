import { Characteristic, Service } from 'hap-controller';
import type HttpClient from 'hap-controller/lib/transport/ip/http-client.js';
import type { AccessoryObject } from 'hap-controller/lib/model/accessory.js';

/** Short HAP service UUIDs used by the plugin. */
export const SERVICE = {
  AccessoryInformation: '3E',
  Thermostat: '4A',
  Fanv2: 'B7',
  FilterMaintenance: 'BA',
} as const;

/** Short HAP characteristic UUIDs used by the plugin. */
export const CHAR = {
  Manufacturer: '20',
  Model: '21',
  SerialNumber: '30',
  CurrentTemperature: '11',
  TargetTemperature: '35',
  TargetHeatingCoolingState: '33',
  CurrentHeatingCoolingState: 'F',
  StatusFault: '77',
  Active: 'B0',
  RotationSpeed: '29',
  FilterChangeIndication: 'AC',
} as const;

/** HomeKit enum values mirrored from HAP so tests read clearly. */
export const TargetHeatingCoolingState = { OFF: 0, HEAT: 1, COOL: 2, AUTO: 3 } as const;
export const CurrentHeatingCoolingState = { OFF: 0, HEAT: 1, COOL: 2 } as const;
export const Active = { INACTIVE: 0, ACTIVE: 1 } as const;
export const StatusFault = { NO_FAULT: 0, GENERAL_FAULT: 1 } as const;
export const FilterChangeIndication = { FILTER_OK: 0, CHANGE_FILTER: 1 } as const;

/**
 * Thin convenience wrapper around a paired {@link HttpClient} that resolves
 * `aid.iid` addresses by HAP type so tests can read/write characteristics by
 * name instead of juggling instance ids.
 */
export class PairedAccessory {
  private constructor(
    private readonly client: HttpClient,
    private readonly stove: AccessoryObject,
  ) {}

  static async load(client: HttpClient): Promise<PairedAccessory> {
    const db = await client.getAccessories();
    const thermostat = Service.ensureServiceUuid(SERVICE.Thermostat);
    // The stove is the bridged accessory that owns the Thermostat service; the
    // bridge accessory itself only carries AccessoryInformation/Protocol.
    const stove = db.accessories.find((acc) =>
      acc.services.some((svc) => Service.ensureServiceUuid(svc.type) === thermostat),
    );
    if (!stove) {
      throw new Error('No accessory exposing a Thermostat service was found');
    }
    return new PairedAccessory(client, stove);
  }

  /** True when the stove accessory exposes a service of the given short type. */
  hasService(serviceType: string): boolean {
    const wanted = Service.ensureServiceUuid(serviceType);
    return this.stove.services.some((svc) => Service.ensureServiceUuid(svc.type) === wanted);
  }

  /** Resolves the `aid.iid` address of a characteristic within a service. */
  address(serviceType: string, charType: string): string {
    const wantedSvc = Service.ensureServiceUuid(serviceType);
    const wantedChar = Characteristic.ensureCharacteristicUuid(charType);
    for (const svc of this.stove.services) {
      if (Service.ensureServiceUuid(svc.type) !== wantedSvc) {
        continue;
      }
      for (const char of svc.characteristics) {
        if (char.type && Characteristic.ensureCharacteristicUuid(char.type) === wantedChar) {
          return `${this.stove.aid}.${char.iid}`;
        }
      }
    }
    throw new Error(`Characteristic ${charType} not found in service ${serviceType}`);
  }

  async read(serviceType: string, charType: string): Promise<unknown> {
    const id = this.address(serviceType, charType);
    const res = await this.client.getCharacteristics([id]);
    return res.characteristics[0]?.value;
  }

  async write(serviceType: string, charType: string, value: unknown): Promise<void> {
    const id = this.address(serviceType, charType);
    await this.client.setCharacteristics({ [id]: value });
  }
}
