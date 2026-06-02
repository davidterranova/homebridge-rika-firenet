/**
 * Type definitions mirroring the RIKA Firenet API
 * (`GET /api/client/{stoveId}/status`).
 *
 * Only the fields relevant to this plugin are strongly typed; the rest are
 * preserved as an index signature so that the full `controls` object can be
 * re-sent verbatim on `POST /api/client/{stoveId}/controls` (the API requires
 * the whole object, not a partial patch).
 */

export interface StoveControls {
  revision: number;
  onOff: boolean;
  /** 0 = Manual, 1 = Automatic (heating times), 2 = Comfort (thermostat). */
  operatingMode: number;
  /** Target room temperature in °C, encoded as a string (e.g. "20"). */
  targetTemperature: string;
  /** Heating power in percent (manual mode). */
  heatingPower: number;
  heatingTimesActiveForComfort?: boolean;
  setBackTemperature?: string;
  frostProtectionActive?: boolean;
  frostProtectionTemperature?: string;
  ecoMode?: boolean;
  temperatureOffset?: string;
  // Other control fields are preserved verbatim for the round-trip POST.
  [key: string]: unknown;
}

export interface StoveSensors {
  /** Current room temperature in °C, encoded as a string. */
  inputRoomTemperature: string;
  /** Coarse stove state (1 = off/standby, 4 = running, 5 = cleaning, ...). */
  statusMainState: number;
  statusSubState: number;
  statusError: number;
  statusSubError: number;
  statusWarning: number;
  statusWifiStrength?: number;
  statusFrostStarted?: boolean;
  statusHeatingTimesNotProgrammed?: boolean;
  parameterEcoModePossible?: boolean;
  [key: string]: unknown;
}

export interface StoveFeatures {
  airFlaps: boolean;
  bakeMode: boolean;
  insertionMotor: boolean;
  logRuntime: boolean;
  multiAir1: boolean;
  multiAir2: boolean;
}

export interface StoveStatus {
  stoveID: string;
  name: string;
  oem: string;
  stoveType: string;
  lastConfirmedRevision: number;
  lastSeenMinutes: number;
  controls: StoveControls;
  sensors: StoveSensors;
  stoveFeatures: StoveFeatures;
}

/** A discovered stove (id + display name) from `GET /web/summary`. */
export interface StoveSummary {
  id: string;
  name: string;
}
