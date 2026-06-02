import { describe, expect, it } from 'vitest';

import { createHeatingPowerService } from '../../src/accessory/services/heatingPower.js';
import { createMaintenanceService } from '../../src/accessory/services/maintenance.js';
import { createThermostatService } from '../../src/accessory/services/thermostat.js';
import { OperatingMode } from '../../src/domain/mode.js';
import { makeStatus } from '../helpers/fixtures.js';
import { Characteristic, Service, buildContext, createFakePoller } from '../helpers/hap.js';

describe('thermostat service', () => {
  it('reflects the current status on its characteristics', () => {
    const status = makeStatus({
      controls: { onOff: true, operatingMode: OperatingMode.Comfort, targetTemperature: '21' },
      sensors: { inputRoomTemperature: '19.5', statusMainState: 4 },
    });
    const poller = createFakePoller(status);
    const { ctx, accessory } = buildContext(poller);

    const module = createThermostatService(ctx);
    module.update(status);

    const service = accessory.getService(Service.Thermostat)!;
    expect(service.getCharacteristic(Characteristic.CurrentTemperature).value).toBe(19.5);
    expect(service.getCharacteristic(Characteristic.TargetTemperature).value).toBe(21);
    expect(service.getCharacteristic(Characteristic.TargetHeatingCoolingState).value).toBe(
      Characteristic.TargetHeatingCoolingState.HEAT,
    );
    expect(service.getCharacteristic(Characteristic.CurrentHeatingCoolingState).value).toBe(
      Characteristic.CurrentHeatingCoolingState.HEAT,
    );
  });

  it('surfaces a fault when the stove reports an error', () => {
    const status = makeStatus({ sensors: { statusError: 1, statusSubError: 2 } });
    const poller = createFakePoller(status);
    const { ctx, accessory } = buildContext(poller);
    createThermostatService(ctx).update(status);

    const service = accessory.getService(Service.Thermostat)!;
    expect(service.getCharacteristic(Characteristic.StatusFault).value).toBe(
      Characteristic.StatusFault.GENERAL_FAULT,
    );
  });

  it('switches to Comfort mode when a target temperature is set', async () => {
    const poller = createFakePoller(makeStatus());
    const { ctx, accessory } = buildContext(poller);
    createThermostatService(ctx);

    const service = accessory.getService(Service.Thermostat)!;
    await service.getCharacteristic(Characteristic.TargetTemperature).setHandler!(23);

    expect(poller.applyPatch).toHaveBeenCalledWith({
      onOff: true,
      operatingMode: OperatingMode.Comfort,
      targetTemperature: '23',
    });
  });

  it('maps Off/Heat/Auto target state changes to controls', async () => {
    const poller = createFakePoller(makeStatus());
    const { ctx, accessory } = buildContext(poller);
    createThermostatService(ctx);
    const state = accessory
      .getService(Service.Thermostat)!
      .getCharacteristic(Characteristic.TargetHeatingCoolingState);

    await state.setHandler!(Characteristic.TargetHeatingCoolingState.AUTO);
    expect(poller.applyPatch).toHaveBeenLastCalledWith({
      onOff: true,
      operatingMode: OperatingMode.Automatic,
    });

    await state.setHandler!(Characteristic.TargetHeatingCoolingState.OFF);
    expect(poller.applyPatch).toHaveBeenLastCalledWith({ onOff: false });
  });
});

describe('heating power service', () => {
  it('reflects manual power and active state', () => {
    const status = makeStatus({
      controls: { onOff: true, operatingMode: OperatingMode.Manual, heatingPower: 60 },
    });
    const poller = createFakePoller(status);
    const { ctx, accessory } = buildContext(poller);
    createHeatingPowerService(ctx).update(status);

    const service = accessory.getServiceById(Service.Fanv2, 'heating-power')!;
    expect(service.getCharacteristic(Characteristic.Active).value).toBe(
      Characteristic.Active.ACTIVE,
    );
    expect(service.getCharacteristic(Characteristic.RotationSpeed).value).toBe(60);
  });

  it('is inactive when the stove is not in manual mode', () => {
    const status = makeStatus({ controls: { operatingMode: OperatingMode.Comfort } });
    const poller = createFakePoller(status);
    const { ctx, accessory } = buildContext(poller);
    createHeatingPowerService(ctx).update(status);

    const service = accessory.getServiceById(Service.Fanv2, 'heating-power')!;
    expect(service.getCharacteristic(Characteristic.Active).value).toBe(
      Characteristic.Active.INACTIVE,
    );
  });

  it('switches to manual mode when rotation speed is set', async () => {
    const poller = createFakePoller(makeStatus());
    const { ctx, accessory } = buildContext(poller);
    createHeatingPowerService(ctx);

    const service = accessory.getServiceById(Service.Fanv2, 'heating-power')!;
    await service.getCharacteristic(Characteristic.RotationSpeed).setHandler!(80);

    expect(poller.applyPatch).toHaveBeenCalledWith({
      onOff: true,
      operatingMode: OperatingMode.Manual,
      heatingPower: 80,
    });
  });

  it('turns the stove off when set inactive', async () => {
    const poller = createFakePoller(makeStatus());
    const { ctx, accessory } = buildContext(poller);
    createHeatingPowerService(ctx);

    const service = accessory.getServiceById(Service.Fanv2, 'heating-power')!;
    await service.getCharacteristic(Characteristic.Active).setHandler!(
      Characteristic.Active.INACTIVE,
    );

    expect(poller.applyPatch).toHaveBeenLastCalledWith({ onOff: false });
  });
});

describe('maintenance service', () => {
  it('requests a filter change when cleaning is needed', () => {
    const status = makeStatus({ sensors: { statusMainState: 5, statusSubState: 1 } });
    const poller = createFakePoller(status);
    const { ctx, accessory } = buildContext(poller);
    createMaintenanceService(ctx).update(status);

    const service = accessory.getService(Service.FilterMaintenance)!;
    expect(service.getCharacteristic(Characteristic.FilterChangeIndication).value).toBe(
      Characteristic.FilterChangeIndication.CHANGE_FILTER,
    );
  });

  it('reports filter ok during normal operation', () => {
    const status = makeStatus({ sensors: { statusMainState: 4 } });
    const poller = createFakePoller(status);
    const { ctx, accessory } = buildContext(poller);
    createMaintenanceService(ctx).update(status);

    const service = accessory.getService(Service.FilterMaintenance)!;
    expect(service.getCharacteristic(Characteristic.FilterChangeIndication).value).toBe(
      Characteristic.FilterChangeIndication.FILTER_OK,
    );
  });
});
