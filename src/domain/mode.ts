import type { StoveControls } from '../api/types.js';

/** RIKA `operatingMode` control values. */
export enum OperatingMode {
  /** User sets a fixed heating power; on/off is manual. */
  Manual = 0,
  /** Stove follows the configured heating-time schedule. */
  Automatic = 1,
  /** Thermostat: stove heats to reach a target room temperature. */
  Comfort = 2,
}

/**
 * Semantic thermostat mode, decoupled from HAP's numeric characteristic values.
 * The accessory layer maps these onto `TargetHeatingCoolingState`.
 */
export enum ThermostatMode {
  Off = 'off',
  /** Comfort (and Manual) modes are surfaced as Heat. */
  Heat = 'heat',
  /** Automatic schedule. */
  Auto = 'auto',
}

/** Derives the thermostat mode from the on/off flag and operating mode. */
export function toThermostatMode(onOff: boolean, operatingMode: OperatingMode): ThermostatMode {
  if (!onOff) {
    return ThermostatMode.Off;
  }
  if (operatingMode === OperatingMode.Automatic) {
    return ThermostatMode.Auto;
  }
  return ThermostatMode.Heat;
}

/**
 * Returns the controls patch needed to switch the stove to the given
 * thermostat mode.
 *
 * - `Off`  → power off (operating mode untouched).
 * - `Heat` → power on, Comfort mode.
 * - `Auto` → power on, Automatic (scheduled) mode.
 */
export function controlsForThermostatMode(mode: ThermostatMode): Partial<StoveControls> {
  switch (mode) {
    case ThermostatMode.Off:
      return { onOff: false };
    case ThermostatMode.Heat:
      return { onOff: true, operatingMode: OperatingMode.Comfort };
    case ThermostatMode.Auto:
      return { onOff: true, operatingMode: OperatingMode.Automatic };
  }
}
