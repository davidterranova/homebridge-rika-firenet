import type { CharacteristicValue } from 'homebridge';

import type { StoveStatus } from '../../api/types.js';
import { formatTemperature } from '../../domain/controls.js';
import {
  OperatingMode,
  ThermostatMode,
  controlsForThermostatMode,
  toThermostatMode,
} from '../../domain/mode.js';
import { deriveStatus } from '../../domain/status.js';
import {
  getCurrentTemperature,
  getOperatingMode,
  getTargetTemperature,
  isHeating,
  isOn,
} from '../../domain/state.js';
import type { ServiceContext, ServiceModule } from '../context.js';

/**
 * Primary Thermostat service: current/target temperature, Off/Heat/Auto state
 * and a fault indicator. Heat maps to RIKA Comfort mode, Auto to the scheduled
 * Automatic mode.
 */
export function createThermostatService(ctx: ServiceContext): ServiceModule {
  const { Service, Characteristic, accessory, poller, log, config } = ctx;

  const service =
    accessory.getService(Service.Thermostat) ??
    accessory.addService(Service.Thermostat, config.name);

  service.setPrimaryService(true);

  const targetState = service.getCharacteristic(Characteristic.TargetHeatingCoolingState);
  targetState.setProps({
    validValues: [
      Characteristic.TargetHeatingCoolingState.OFF,
      Characteristic.TargetHeatingCoolingState.HEAT,
      Characteristic.TargetHeatingCoolingState.AUTO,
    ],
  });

  service.getCharacteristic(Characteristic.CurrentHeatingCoolingState).setProps({
    validValues: [
      Characteristic.CurrentHeatingCoolingState.OFF,
      Characteristic.CurrentHeatingCoolingState.HEAT,
    ],
  });

  service.getCharacteristic(Characteristic.TargetTemperature).setProps({
    minValue: config.minTemperature,
    maxValue: config.maxTemperature,
    minStep: 1,
  });

  service
    .getCharacteristic(Characteristic.TemperatureDisplayUnits)
    .setProps({ validValues: [Characteristic.TemperatureDisplayUnits.CELSIUS] })
    .updateValue(Characteristic.TemperatureDisplayUnits.CELSIUS);

  function latest(): StoveStatus | null {
    return poller.getLatest();
  }

  service.getCharacteristic(Characteristic.CurrentTemperature).onGet(() => {
    const status = latest();
    return status ? getCurrentTemperature(status) ?? 0 : 0;
  });

  service
    .getCharacteristic(Characteristic.TargetTemperature)
    .onGet(() => {
      const status = latest();
      return clampTemperature(status ? getTargetTemperature(status) : undefined, config);
    })
    .onSet(async (value: CharacteristicValue) => {
      const temperature = Number(value);
      log.info(`Setting target temperature to ${temperature}°C (Comfort mode)`);
      await poller.applyPatch({
        onOff: true,
        operatingMode: OperatingMode.Comfort,
        targetTemperature: formatTemperature(temperature),
      });
    });

  targetState
    .onGet(() => {
      const status = latest();
      return toHapTargetState(ctx, status);
    })
    .onSet(async (value: CharacteristicValue) => {
      const mode = fromHapTargetState(ctx, value);
      log.info(`Setting thermostat mode to ${mode}`);
      await poller.applyPatch(controlsForThermostatMode(mode));
    });

  service.getCharacteristic(Characteristic.CurrentHeatingCoolingState).onGet(() => {
    const status = latest();
    return status && isHeating(status)
      ? Characteristic.CurrentHeatingCoolingState.HEAT
      : Characteristic.CurrentHeatingCoolingState.OFF;
  });

  service.getCharacteristic(Characteristic.StatusFault).onGet(() => {
    const status = latest();
    return status && deriveStatus(status).fault
      ? Characteristic.StatusFault.GENERAL_FAULT
      : Characteristic.StatusFault.NO_FAULT;
  });

  function update(status: StoveStatus): void {
    const info = deriveStatus(status);
    service.updateCharacteristic(
      Characteristic.CurrentTemperature,
      getCurrentTemperature(status) ?? 0,
    );
    service.updateCharacteristic(
      Characteristic.TargetTemperature,
      clampTemperature(getTargetTemperature(status), config),
    );
    service.updateCharacteristic(Characteristic.TargetHeatingCoolingState, toHapTargetState(ctx, status));
    service.updateCharacteristic(
      Characteristic.CurrentHeatingCoolingState,
      isHeating(status)
        ? Characteristic.CurrentHeatingCoolingState.HEAT
        : Characteristic.CurrentHeatingCoolingState.OFF,
    );
    service.updateCharacteristic(
      Characteristic.StatusFault,
      info.fault
        ? Characteristic.StatusFault.GENERAL_FAULT
        : Characteristic.StatusFault.NO_FAULT,
    );
  }

  return { update };
}

function toHapTargetState(ctx: ServiceContext, status: StoveStatus | null): number {
  const { Characteristic } = ctx;
  if (!status) {
    return Characteristic.TargetHeatingCoolingState.OFF;
  }
  const mode = toThermostatMode(isOn(status), getOperatingMode(status));
  switch (mode) {
    case ThermostatMode.Heat:
      return Characteristic.TargetHeatingCoolingState.HEAT;
    case ThermostatMode.Auto:
      return Characteristic.TargetHeatingCoolingState.AUTO;
    case ThermostatMode.Off:
    default:
      return Characteristic.TargetHeatingCoolingState.OFF;
  }
}

function fromHapTargetState(ctx: ServiceContext, value: CharacteristicValue): ThermostatMode {
  const { Characteristic } = ctx;
  switch (value) {
    case Characteristic.TargetHeatingCoolingState.HEAT:
      return ThermostatMode.Heat;
    case Characteristic.TargetHeatingCoolingState.AUTO:
      return ThermostatMode.Auto;
    default:
      return ThermostatMode.Off;
  }
}

function clampTemperature(
  value: number | undefined,
  config: { minTemperature: number; maxTemperature: number },
): number {
  const fallback = config.minTemperature;
  const temperature = value ?? fallback;
  return Math.max(config.minTemperature, Math.min(config.maxTemperature, temperature));
}

// Re-exported for unit tests.
export const __test = { toHapTargetState, fromHapTargetState, clampTemperature };
