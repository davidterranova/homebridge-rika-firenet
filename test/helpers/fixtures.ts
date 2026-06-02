import type { StoveControls, StoveSensors, StoveStatus } from '../../src/api/types.js';

export function makeControls(overrides: Partial<StoveControls> = {}): StoveControls {
  return {
    revision: 1000,
    onOff: true,
    operatingMode: 2,
    targetTemperature: '21',
    heatingPower: 50,
    heatingTimesActiveForComfort: true,
    frostProtectionActive: false,
    frostProtectionTemperature: '4',
    ecoMode: false,
    temperatureOffset: '0',
    ...overrides,
  };
}

export function makeSensors(overrides: Partial<StoveSensors> = {}): StoveSensors {
  return {
    inputRoomTemperature: '19.5',
    statusMainState: 4,
    statusSubState: 1,
    statusError: 0,
    statusSubError: 0,
    statusWarning: 0,
    statusWifiStrength: -55,
    statusFrostStarted: false,
    statusHeatingTimesNotProgrammed: false,
    parameterEcoModePossible: true,
    ...overrides,
  };
}

export function makeStatus(overrides: {
  controls?: Partial<StoveControls>;
  sensors?: Partial<StoveSensors>;
  lastSeenMinutes?: number;
  stoveType?: string;
  oem?: string;
} = {}): StoveStatus {
  return {
    stoveID: '12345678',
    name: 'Living Room Stove',
    oem: 'RIKA',
    stoveType: 'DOMO',
    lastConfirmedRevision: 1000,
    lastSeenMinutes: overrides.lastSeenMinutes ?? 0,
    controls: makeControls(overrides.controls),
    sensors: makeSensors(overrides.sensors),
    stoveFeatures: {
      airFlaps: false,
      bakeMode: false,
      insertionMotor: false,
      logRuntime: false,
      multiAir1: true,
      multiAir2: false,
    },
  };
}
