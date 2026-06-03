import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  Active,
  CHAR,
  CurrentHeatingCoolingState,
  FilterChangeIndication,
  SERVICE,
  StatusFault,
  TargetHeatingCoolingState,
} from './helpers/hap.js';
import { startHomebridge, type Harness } from './helpers/homebridgeHarness.js';
import { startMockRikaServer, type MockRikaServer } from './helpers/mockRikaServer.js';

/**
 * End-to-end ("layer 3") test: a real headless Homebridge process loads the
 * plugin against a mock RIKA backend, and we drive it as a HomeKit controller
 * over HAP-IP — pairing, reading characteristics and writing them, then
 * asserting both the HomeKit-facing values and the control payloads that
 * reached the backend.
 */
describe('HomeKit integration', () => {
  let mock: MockRikaServer;
  let hb: Harness;

  beforeAll(async () => {
    mock = await startMockRikaServer();
    hb = await startHomebridge({ baseUrl: mock.url, stoveId: mock.stoveId });
  }, 60_000);

  afterAll(async () => {
    await hb?.stop();
    await mock?.close();
  });

  /** Writes a benign control change to force the poller to re-fetch status. */
  async function forceRefresh(): Promise<void> {
    await hb.accessory.write(SERVICE.Thermostat, CHAR.TargetTemperature, 22);
  }

  it('exposes the expected HomeKit services', () => {
    expect(hb.accessory.hasService(SERVICE.AccessoryInformation)).toBe(true);
    expect(hb.accessory.hasService(SERVICE.Thermostat)).toBe(true);
    expect(hb.accessory.hasService(SERVICE.Fanv2)).toBe(true);
    expect(hb.accessory.hasService(SERVICE.FilterMaintenance)).toBe(true);
  });

  it('reports accessory information from the stove status', async () => {
    expect(await hb.accessory.read(SERVICE.AccessoryInformation, CHAR.Manufacturer)).toBe('RIKA');
    expect(await hb.accessory.read(SERVICE.AccessoryInformation, CHAR.SerialNumber)).toBe(
      mock.stoveId,
    );
  });

  it('reflects the current and target temperature', async () => {
    expect(await hb.accessory.read(SERVICE.Thermostat, CHAR.CurrentTemperature)).toBe(19.5);
    expect(await hb.accessory.read(SERVICE.Thermostat, CHAR.TargetTemperature)).toBe(21);
    expect(await hb.accessory.read(SERVICE.Thermostat, CHAR.TargetHeatingCoolingState)).toBe(
      TargetHeatingCoolingState.HEAT,
    );
  });

  it('turns the stove off when the thermostat is set to Off', async () => {
    await hb.accessory.write(
      SERVICE.Thermostat,
      CHAR.TargetHeatingCoolingState,
      TargetHeatingCoolingState.OFF,
    );

    expect(mock.getControls().onOff).toBe(false);
    expect(await hb.accessory.read(SERVICE.Thermostat, CHAR.TargetHeatingCoolingState)).toBe(
      TargetHeatingCoolingState.OFF,
    );
    expect(await hb.accessory.read(SERVICE.Thermostat, CHAR.CurrentHeatingCoolingState)).toBe(
      CurrentHeatingCoolingState.OFF,
    );
  });

  it('sets Comfort mode and target temperature from HomeKit', async () => {
    await hb.accessory.write(SERVICE.Thermostat, CHAR.TargetTemperature, 23);

    const controls = mock.getControls();
    expect(controls.onOff).toBe(true);
    expect(controls.operatingMode).toBe(2); // Comfort
    expect(controls.targetTemperature).toBe('23');

    expect(await hb.accessory.read(SERVICE.Thermostat, CHAR.TargetTemperature)).toBe(23);
    expect(await hb.accessory.read(SERVICE.Thermostat, CHAR.TargetHeatingCoolingState)).toBe(
      TargetHeatingCoolingState.HEAT,
    );
  });

  it('switches to the scheduled Automatic mode for Auto', async () => {
    await hb.accessory.write(
      SERVICE.Thermostat,
      CHAR.TargetHeatingCoolingState,
      TargetHeatingCoolingState.AUTO,
    );

    const controls = mock.getControls();
    expect(controls.onOff).toBe(true);
    expect(controls.operatingMode).toBe(1); // Automatic

    expect(await hb.accessory.read(SERVICE.Thermostat, CHAR.TargetHeatingCoolingState)).toBe(
      TargetHeatingCoolingState.AUTO,
    );
  });

  it('drives Manual mode through the Heating Power fan', async () => {
    await hb.accessory.write(SERVICE.Fanv2, CHAR.Active, Active.ACTIVE);
    expect(mock.getControls().operatingMode).toBe(0); // Manual
    expect(mock.getControls().onOff).toBe(true);
    expect(await hb.accessory.read(SERVICE.Fanv2, CHAR.Active)).toBe(Active.ACTIVE);

    await hb.accessory.write(SERVICE.Fanv2, CHAR.RotationSpeed, 40);
    expect(mock.getControls().heatingPower).toBe(40);
    expect(await hb.accessory.read(SERVICE.Fanv2, CHAR.RotationSpeed)).toBe(40);
  });

  it('surfaces a cleaning request through Filter Maintenance', async () => {
    mock.patchSensors({ statusMainState: 5, statusSubState: 1, statusError: 0, statusSubError: 0 });
    await forceRefresh();

    expect(await hb.accessory.read(SERVICE.FilterMaintenance, CHAR.FilterChangeIndication)).toBe(
      FilterChangeIndication.CHANGE_FILTER,
    );
    expect(await hb.accessory.read(SERVICE.Thermostat, CHAR.StatusFault)).toBe(
      StatusFault.NO_FAULT,
    );

    mock.clearSensorOverride();
  });

  it('surfaces a backend fault through Status Fault', async () => {
    mock.patchSensors({
      statusMainState: 1,
      statusSubState: 0,
      statusError: 1,
      statusSubError: 2, // out of pellets
    });
    await forceRefresh();

    expect(await hb.accessory.read(SERVICE.Thermostat, CHAR.StatusFault)).toBe(
      StatusFault.GENERAL_FAULT,
    );

    mock.clearSensorOverride();
  });
});
