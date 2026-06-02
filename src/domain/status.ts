import type { StoveStatus } from '../api/types.js';

/** A normalized, human-meaningful stove status. */
export enum StoveStatusCode {
  Offline = 'offline',
  Off = 'off',
  Standby = 'standby',
  ExternalRequest = 'external_request',
  Igniting = 'igniting',
  StartingUp = 'starting_up',
  Running = 'running',
  Cleaning = 'cleaning',
  DeepCleaning = 'deep_cleaning',
  BurnOff = 'burn_off',
  FrostProtection = 'frost_protection',
  PelletLidOpen = 'pellet_lid_open',
  EmptyTank = 'empty_tank',
  NotIgnited = 'not_ignited',
  SmokeFan = 'smoke_fan',
  Error = 'error',
  SplitLog = 'split_log',
  Unknown = 'unknown',
}

export interface StoveStatusInfo {
  code: StoveStatusCode;
  /** Short, human-readable label suitable for logs / accessory naming. */
  label: string;
  /** Whether this is a fault condition (surfaced as HomeKit `StatusFault`). */
  fault: boolean;
  /** Whether the stove requests cleaning / service. */
  needsCleaning: boolean;
  /** Whether the stove ran out of pellets. */
  lackOfPellet: boolean;
  /** Whether the stove is unreachable. */
  offline: boolean;
}

const LABELS: Record<StoveStatusCode, string> = {
  [StoveStatusCode.Offline]: 'Offline',
  [StoveStatusCode.Off]: 'Off',
  [StoveStatusCode.Standby]: 'Standby',
  [StoveStatusCode.ExternalRequest]: 'External request',
  [StoveStatusCode.Igniting]: 'Igniting',
  [StoveStatusCode.StartingUp]: 'Starting up',
  [StoveStatusCode.Running]: 'Running',
  [StoveStatusCode.Cleaning]: 'Cleaning',
  [StoveStatusCode.DeepCleaning]: 'Deep cleaning',
  [StoveStatusCode.BurnOff]: 'Burning off',
  [StoveStatusCode.FrostProtection]: 'Frost protection',
  [StoveStatusCode.PelletLidOpen]: 'Pellet lid open',
  [StoveStatusCode.EmptyTank]: 'Out of pellets',
  [StoveStatusCode.NotIgnited]: 'Failed to ignite',
  [StoveStatusCode.SmokeFan]: 'Smoke fan running',
  [StoveStatusCode.Error]: 'Error',
  [StoveStatusCode.SplitLog]: 'Split log mode',
  [StoveStatusCode.Unknown]: 'Unknown',
};

function info(
  code: StoveStatusCode,
  flags: Partial<Pick<StoveStatusInfo, 'fault' | 'needsCleaning' | 'lackOfPellet' | 'offline'>> = {},
): StoveStatusInfo {
  return {
    code,
    label: LABELS[code],
    fault: flags.fault ?? false,
    needsCleaning: flags.needsCleaning ?? false,
    lackOfPellet: flags.lackOfPellet ?? false,
    offline: flags.offline ?? false,
  };
}

/**
 * Derives a normalized status from the raw sensor block, ported (and
 * simplified) from the community Home Assistant component's `STATUS_RULES`.
 * Rules are evaluated in priority order: connectivity and faults first, then
 * operational states.
 */
export function deriveStatus(status: StoveStatus): StoveStatusInfo {
  const s = status.sensors;
  const mainState = s.statusMainState;
  const subState = s.statusSubState;

  // Priority 1: connectivity and faults.
  if (status.lastSeenMinutes > 2) {
    return info(StoveStatusCode.Offline, { offline: true, fault: true });
  }
  if (s.statusWarning === 2) {
    return info(StoveStatusCode.PelletLidOpen, { fault: true });
  }
  if (s.statusError === 1 && s.statusSubError === 2) {
    return info(StoveStatusCode.EmptyTank, { fault: true, lackOfPellet: true });
  }
  if (s.statusError === 8 && s.statusSubError === 16) {
    return info(StoveStatusCode.NotIgnited, { fault: true });
  }
  if (s.statusError === 32768) {
    return info(StoveStatusCode.SmokeFan, { fault: true });
  }
  if (s.statusError === 1 || s.statusError > 0) {
    return info(StoveStatusCode.Error, { fault: true });
  }
  if (s.statusFrostStarted) {
    return info(StoveStatusCode.FrostProtection);
  }

  // Priority 2: operational states.
  switch (mainState) {
    case 1:
      if (subState === 0) {
        return info(StoveStatusCode.Off);
      }
      if (subState === 2) {
        return info(StoveStatusCode.ExternalRequest);
      }
      return info(StoveStatusCode.Standby);
    case 2:
      return info(StoveStatusCode.Igniting);
    case 3:
      return info(StoveStatusCode.StartingUp);
    case 4:
      return info(StoveStatusCode.Running);
    case 5:
      return subState === 3 || subState === 4
        ? info(StoveStatusCode.DeepCleaning, { needsCleaning: true })
        : info(StoveStatusCode.Cleaning, { needsCleaning: true });
    case 6:
      return info(StoveStatusCode.BurnOff);
    default:
      break;
  }

  // Priority 3: split-log / pellet-or-log special modes.
  if ([11, 13, 14, 16, 17, 20, 21, 50].includes(mainState)) {
    return info(StoveStatusCode.SplitLog);
  }

  return info(StoveStatusCode.Unknown);
}
