import type { StoveStatus } from '../api/types.js';
import { OperatingMode } from './mode.js';

/** Main states in which the stove is actively producing heat. */
const HEATING_MAIN_STATES = new Set([2, 3, 4]);

/**
 * Parses a RIKA numeric value that may arrive as a `string` (e.g. "20.5",
 * "21,0") or a `number`. Returns `undefined` when it cannot be parsed.
 */
export function parseNumeric(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string') {
    const normalized = value.replace(',', '.').trim();
    if (normalized === '') {
      return undefined;
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/** Current room temperature in °C, or `undefined` if unavailable. */
export function getCurrentTemperature(status: StoveStatus): number | undefined {
  return parseNumeric(status.sensors.inputRoomTemperature);
}

/** Target (Comfort) temperature in °C, or `undefined` if unavailable. */
export function getTargetTemperature(status: StoveStatus): number | undefined {
  return parseNumeric(status.controls.targetTemperature);
}

/** The current operating mode. */
export function getOperatingMode(status: StoveStatus): OperatingMode {
  return status.controls.operatingMode as OperatingMode;
}

/** Whether the stove is switched on. */
export function isOn(status: StoveStatus): boolean {
  return Boolean(status.controls.onOff);
}

/** Whether the stove is currently igniting, starting up or burning. */
export function isHeating(status: StoveStatus): boolean {
  return isOn(status) && HEATING_MAIN_STATES.has(status.sensors.statusMainState);
}

/** Manual-mode heating power in percent (clamped to 0-100). */
export function getHeatingPower(status: StoveStatus): number {
  const power = parseNumeric(status.controls.heatingPower) ?? 0;
  return Math.max(0, Math.min(100, Math.round(power)));
}

/** Whether the stove is offline (not seen recently by RIKA Firenet). */
export function isOffline(status: StoveStatus): boolean {
  return status.lastSeenMinutes > 2;
}
