import { describe, expect, it } from 'vitest';

import {
  getCurrentTemperature,
  getHeatingPower,
  getOperatingMode,
  getTargetTemperature,
  isHeating,
  isOffline,
  isOn,
  parseNumeric,
} from '../../src/domain/state.js';
import { OperatingMode } from '../../src/domain/mode.js';
import { makeStatus } from '../helpers/fixtures.js';

describe('parseNumeric', () => {
  it('parses plain numbers', () => {
    expect(parseNumeric(21)).toBe(21);
  });

  it('parses numeric strings with comma or dot separators', () => {
    expect(parseNumeric('19.5')).toBe(19.5);
    expect(parseNumeric('19,5')).toBe(19.5);
  });

  it('returns undefined for empty or non-numeric input', () => {
    expect(parseNumeric('')).toBeUndefined();
    expect(parseNumeric('abc')).toBeUndefined();
    expect(parseNumeric(undefined)).toBeUndefined();
    expect(parseNumeric(Number.NaN)).toBeUndefined();
  });
});

describe('state readers', () => {
  it('reads current and target temperatures', () => {
    const status = makeStatus({
      sensors: { inputRoomTemperature: '18.4' },
      controls: { targetTemperature: '22' },
    });
    expect(getCurrentTemperature(status)).toBe(18.4);
    expect(getTargetTemperature(status)).toBe(22);
  });

  it('reads operating mode and on/off', () => {
    const status = makeStatus({ controls: { operatingMode: 0, onOff: false } });
    expect(getOperatingMode(status)).toBe(OperatingMode.Manual);
    expect(isOn(status)).toBe(false);
  });

  it('treats igniting/startup/running main states as heating only when on', () => {
    expect(isHeating(makeStatus({ sensors: { statusMainState: 4 } }))).toBe(true);
    expect(isHeating(makeStatus({ sensors: { statusMainState: 2 } }))).toBe(true);
    expect(isHeating(makeStatus({ sensors: { statusMainState: 1 } }))).toBe(false);
    expect(
      isHeating(makeStatus({ controls: { onOff: false }, sensors: { statusMainState: 4 } })),
    ).toBe(false);
  });

  it('clamps heating power to 0-100 and rounds', () => {
    expect(getHeatingPower(makeStatus({ controls: { heatingPower: 150 } }))).toBe(100);
    expect(getHeatingPower(makeStatus({ controls: { heatingPower: -5 } }))).toBe(0);
    expect(getHeatingPower(makeStatus({ controls: { heatingPower: 33 } }))).toBe(33);
  });

  it('detects offline based on lastSeenMinutes', () => {
    expect(isOffline(makeStatus({ lastSeenMinutes: 0 }))).toBe(false);
    expect(isOffline(makeStatus({ lastSeenMinutes: 5 }))).toBe(true);
  });
});
