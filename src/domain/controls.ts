import type { StoveControls } from '../api/types.js';

/**
 * Formats a temperature for the RIKA API, which expects a string. Whole
 * numbers are sent without a decimal part (e.g. `20`), half-degrees keep one
 * decimal (e.g. `20.5`).
 */
export function formatTemperature(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * Builds a complete controls payload to POST. The RIKA API rejects partial
 * updates, so the current controls object is cloned and overlaid with the
 * requested `patch`. The current `revision` is preserved (the server validates
 * it for optimistic concurrency).
 */
export function buildControlsPayload(
  current: StoveControls,
  patch: Partial<StoveControls>,
): StoveControls {
  return {
    ...current,
    ...patch,
    revision: current.revision,
  };
}
