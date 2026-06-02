import { describe, expect, it } from 'vitest';

import {
  OperatingMode,
  ThermostatMode,
  controlsForThermostatMode,
  toThermostatMode,
} from '../../src/domain/mode.js';

describe('toThermostatMode', () => {
  it('returns Off when the stove is off', () => {
    expect(toThermostatMode(false, OperatingMode.Comfort)).toBe(ThermostatMode.Off);
  });

  it('maps Automatic to Auto', () => {
    expect(toThermostatMode(true, OperatingMode.Automatic)).toBe(ThermostatMode.Auto);
  });

  it('maps Comfort and Manual to Heat when on', () => {
    expect(toThermostatMode(true, OperatingMode.Comfort)).toBe(ThermostatMode.Heat);
    expect(toThermostatMode(true, OperatingMode.Manual)).toBe(ThermostatMode.Heat);
  });
});

describe('controlsForThermostatMode', () => {
  it('turns the stove off for Off', () => {
    expect(controlsForThermostatMode(ThermostatMode.Off)).toEqual({ onOff: false });
  });

  it('switches to Comfort for Heat', () => {
    expect(controlsForThermostatMode(ThermostatMode.Heat)).toEqual({
      onOff: true,
      operatingMode: OperatingMode.Comfort,
    });
  });

  it('switches to Automatic for Auto', () => {
    expect(controlsForThermostatMode(ThermostatMode.Auto)).toEqual({
      onOff: true,
      operatingMode: OperatingMode.Automatic,
    });
  });
});
