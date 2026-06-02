import { describe, expect, it } from 'vitest';

import { StoveStatusCode, deriveStatus } from '../../src/domain/status.js';
import { makeStatus } from '../helpers/fixtures.js';

describe('deriveStatus', () => {
  it('flags offline when not seen recently', () => {
    const info = deriveStatus(makeStatus({ lastSeenMinutes: 10 }));
    expect(info.code).toBe(StoveStatusCode.Offline);
    expect(info.offline).toBe(true);
    expect(info.fault).toBe(true);
  });

  it('detects pellet lid open warning', () => {
    const info = deriveStatus(makeStatus({ sensors: { statusWarning: 2 } }));
    expect(info.code).toBe(StoveStatusCode.PelletLidOpen);
    expect(info.fault).toBe(true);
  });

  it('detects empty pellet tank', () => {
    const info = deriveStatus(
      makeStatus({ sensors: { statusError: 1, statusSubError: 2 } }),
    );
    expect(info.code).toBe(StoveStatusCode.EmptyTank);
    expect(info.lackOfPellet).toBe(true);
    expect(info.fault).toBe(true);
  });

  it('detects ignition failure', () => {
    const info = deriveStatus(
      makeStatus({ sensors: { statusError: 8, statusSubError: 16 } }),
    );
    expect(info.code).toBe(StoveStatusCode.NotIgnited);
  });

  it('reports running when burning', () => {
    const info = deriveStatus(makeStatus({ sensors: { statusMainState: 4 } }));
    expect(info.code).toBe(StoveStatusCode.Running);
    expect(info.fault).toBe(false);
  });

  it('reports off vs standby based on sub state', () => {
    expect(
      deriveStatus(makeStatus({ sensors: { statusMainState: 1, statusSubState: 0 } })).code,
    ).toBe(StoveStatusCode.Off);
    expect(
      deriveStatus(makeStatus({ sensors: { statusMainState: 1, statusSubState: 1 } })).code,
    ).toBe(StoveStatusCode.Standby);
    expect(
      deriveStatus(makeStatus({ sensors: { statusMainState: 1, statusSubState: 2 } })).code,
    ).toBe(StoveStatusCode.ExternalRequest);
  });

  it('flags cleaning states as needing maintenance', () => {
    const clean = deriveStatus(makeStatus({ sensors: { statusMainState: 5, statusSubState: 1 } }));
    expect(clean.code).toBe(StoveStatusCode.Cleaning);
    expect(clean.needsCleaning).toBe(true);

    const deep = deriveStatus(makeStatus({ sensors: { statusMainState: 5, statusSubState: 3 } }));
    expect(deep.code).toBe(StoveStatusCode.DeepCleaning);
    expect(deep.needsCleaning).toBe(true);
  });

  it('falls back to unknown for unrecognized states', () => {
    const info = deriveStatus(makeStatus({ sensors: { statusMainState: 99 } }));
    expect(info.code).toBe(StoveStatusCode.Unknown);
  });
});
