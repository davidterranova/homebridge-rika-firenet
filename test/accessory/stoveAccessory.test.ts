import { describe, expect, it } from 'vitest';

import { StoveAccessory } from '../../src/accessory/stoveAccessory.js';
import { OperatingMode } from '../../src/domain/mode.js';
import { makeStatus } from '../helpers/fixtures.js';
import { Characteristic, Service, buildContext, createFakePoller } from '../helpers/hap.js';

describe('StoveAccessory', () => {
  it('registers all services and primes them from the initial status', () => {
    const status = makeStatus({
      controls: { onOff: true, operatingMode: OperatingMode.Comfort, targetTemperature: '21' },
      sensors: { inputRoomTemperature: '20', statusMainState: 4 },
    });
    const poller = createFakePoller(status);
    const { ctx, accessory } = buildContext(poller);

    new StoveAccessory(ctx);

    expect(accessory.getService(Service.Thermostat)).toBeDefined();
    expect(accessory.getServiceById(Service.Fanv2, 'heating-power')).toBeDefined();
    expect(accessory.getService(Service.FilterMaintenance)).toBeDefined();

    const info = accessory.getService(Service.AccessoryInformation)!;
    expect(info.getCharacteristic(Characteristic.SerialNumber).value).toBe('12345678');
    expect(info.getCharacteristic(Characteristic.Model).value).toBe('DOMO');

    const thermostat = accessory.getService(Service.Thermostat)!;
    expect(thermostat.getCharacteristic(Characteristic.CurrentTemperature).value).toBe(20);
  });

  it('propagates poller updates to the services', () => {
    const initial = makeStatus({ sensors: { inputRoomTemperature: '18' } });
    const poller = createFakePoller(initial);
    const { ctx, accessory } = buildContext(poller);
    new StoveAccessory(ctx);

    poller.emit(makeStatus({ sensors: { inputRoomTemperature: '23.5' } }));

    const thermostat = accessory.getService(Service.Thermostat)!;
    expect(thermostat.getCharacteristic(Characteristic.CurrentTemperature).value).toBe(23.5);
  });
});
