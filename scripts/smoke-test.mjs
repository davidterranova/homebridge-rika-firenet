// Read-only API smoke test against a real RIKA Firenet stove.
//
// It logs in, lists the available stoves and prints the decoded status for the
// selected stove. It never writes to the stove. Run it via `make smoke`, which
// builds `dist/` first and loads credentials from `.env` when present.
//
// Required environment variables:
//   RIKA_EMAIL, RIKA_PASSWORD
// Optional:
//   STOVE_ID  - pin a specific stove (defaults to the first one found)

import { RikaFirenetClient } from '../dist/api/client.js';
import { deriveStatus } from '../dist/domain/status.js';
import {
  getCurrentTemperature,
  getTargetTemperature,
  getHeatingPower,
  getOperatingMode,
  isOn,
} from '../dist/domain/state.js';

const { RIKA_EMAIL, RIKA_PASSWORD, STOVE_ID } = process.env;

const client = new RikaFirenetClient({
  email: RIKA_EMAIL,
  password: RIKA_PASSWORD,
  logger: console,
});

const stoves = await client.login();
console.log('Stoves:', stoves);

if (stoves.length === 0) {
  throw new Error('Authentication succeeded but no stoves are registered for this account');
}

const id = STOVE_ID ?? stoves[0].id;
const status = await client.getStatus(id);

console.log({
  name: status.name,
  model: status.stoveType,
  on: isOn(status),
  mode: getOperatingMode(status),
  current: getCurrentTemperature(status),
  target: getTargetTemperature(status),
  power: getHeatingPower(status),
  status: deriveStatus(status),
  revision: status.controls.revision,
});

await client.logout();
console.log('Smoke test OK');
