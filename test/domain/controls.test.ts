import { describe, expect, it } from 'vitest';

import { buildControlsPayload, formatTemperature } from '../../src/domain/controls.js';
import { makeControls } from '../helpers/fixtures.js';

describe('formatTemperature', () => {
  it('omits decimals for whole numbers', () => {
    expect(formatTemperature(21)).toBe('21');
  });

  it('keeps one decimal for half degrees', () => {
    expect(formatTemperature(20.5)).toBe('20.5');
  });
});

describe('buildControlsPayload', () => {
  it('overlays the patch onto the full current controls', () => {
    const current = makeControls({ revision: 42, targetTemperature: '20', onOff: true });
    const payload = buildControlsPayload(current, { targetTemperature: '23', operatingMode: 2 });

    expect(payload.targetTemperature).toBe('23');
    expect(payload.operatingMode).toBe(2);
    // Untouched fields are preserved for the round-trip POST.
    expect(payload.heatingPower).toBe(current.heatingPower);
    expect(payload.frostProtectionTemperature).toBe(current.frostProtectionTemperature);
  });

  it('always preserves the current revision', () => {
    const current = makeControls({ revision: 99 });
    const payload = buildControlsPayload(current, { revision: 1 });
    expect(payload.revision).toBe(99);
  });

  it('does not mutate the input controls', () => {
    const current = makeControls({ onOff: true });
    buildControlsPayload(current, { onOff: false });
    expect(current.onOff).toBe(true);
  });
});
