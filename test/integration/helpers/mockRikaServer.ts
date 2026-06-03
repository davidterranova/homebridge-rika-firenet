import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { StoveControls, StoveSensors, StoveStatus } from '../../../src/api/types.js';
import { makeStatus } from '../../helpers/fixtures.js';

const SESSION_TOKEN = 'integration-session';

/**
 * A small, stateful in-memory stand-in for the RIKA Firenet web API, sufficient
 * to drive the plugin end-to-end without touching the real service or any
 * credentials. It implements the four endpoints the {@link RikaFirenetClient}
 * uses (`/web/login`, `/web/summary`, `/api/client/:id/status`,
 * `/api/client/:id/controls`) plus a couple of `/__test/*` hooks the test suite
 * uses to mutate sensor readings the way a real stove would.
 */
export interface MockRikaServer {
  /** Base URL to feed into the plugin's `baseUrl` config. */
  readonly url: string;
  /** The id of the single stove this mock exposes. */
  readonly stoveId: string;
  /** Current controls as last persisted by a `setControls` call. */
  getControls(): StoveControls;
  /** Number of successful control writes received so far. */
  controlWrites(): number;
  /** Force a sensor override (e.g. to simulate cleaning or a fault). */
  patchSensors(patch: Partial<StoveSensors>): void;
  /** Clear any sensor override and bump the revision. */
  clearSensorOverride(): void;
  close(): Promise<void>;
}

interface MockOptions {
  stoveId?: string;
  stoveName?: string;
  initialControls?: Partial<StoveControls>;
  initialSensors?: Partial<StoveSensors>;
}

export async function startMockRikaServer(options: MockOptions = {}): Promise<MockRikaServer> {
  const stoveId = options.stoveId ?? '12345678';
  const stoveName = options.stoveName ?? 'Living Room Stove';

  const state: StoveStatus = makeStatus({
    controls: options.initialControls,
    sensors: options.initialSensors,
  });
  state.stoveID = stoveId;
  state.name = stoveName;

  let sensorOverride: Partial<StoveSensors> | null = null;
  let writes = 0;

  function bumpRevision(): void {
    state.controls.revision += 1;
    state.lastConfirmedRevision = state.controls.revision;
  }

  // Reflect on/off into a plausible main state unless an explicit override is
  // in effect (the override lets a test pin states like cleaning or a fault).
  function applyDerivedSensors(): void {
    if (sensorOverride) {
      state.sensors = { ...state.sensors, ...sensorOverride };
      return;
    }
    if (state.controls.onOff) {
      state.sensors.statusMainState = 4; // Running
      state.sensors.statusSubState = 1;
    } else {
      state.sensors.statusMainState = 1; // Off
      state.sensors.statusSubState = 0;
    }
    state.sensors.statusError = 0;
    state.sensors.statusSubError = 0;
    state.sensors.statusWarning = 0;
  }

  applyDerivedSensors();

  const server = createServer((req, res) => {
    void handle(req, res).catch((err) => {
      res.statusCode = 500;
      res.end(String(err));
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const method = req.method ?? 'GET';

    if (method === 'POST' && path === '/web/login') {
      await readBody(req); // credentials are accepted unconditionally
      res.statusCode = 302;
      res.setHeader('set-cookie', `connect.sid=${SESSION_TOKEN}; Path=/; HttpOnly`);
      res.setHeader('location', '/web/summary');
      res.end();
      return;
    }

    if (method === 'GET' && path === '/web/summary') {
      if (!hasSession(req)) {
        res.statusCode = 302;
        res.setHeader('location', '/web/');
        res.end();
        return;
      }
      res.statusCode = 200;
      res.setHeader('content-type', 'text/html');
      res.end(summaryHtml(stoveId, stoveName));
      return;
    }

    if (method === 'GET' && path === '/web/logout') {
      res.statusCode = 200;
      res.end('OK');
      return;
    }

    if (method === 'GET' && path === `/api/client/${stoveId}/status`) {
      if (!hasSession(req)) {
        res.statusCode = 401;
        res.end('Authorisation required!');
        return;
      }
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(state));
      return;
    }

    if (method === 'POST' && path === `/api/client/${stoveId}/controls`) {
      if (!hasSession(req)) {
        res.statusCode = 401;
        res.end('Authorisation required!');
        return;
      }
      const body = await readBody(req);
      const incoming = new URLSearchParams(body);
      const revision = Number(incoming.get('revision'));
      if (revision !== state.controls.revision) {
        res.statusCode = 404;
        res.end(`Revision ${revision} is outdated!`);
        return;
      }
      state.controls = mergeControls(state.controls, incoming);
      bumpRevision();
      applyDerivedSensors();
      writes += 1;
      res.statusCode = 200;
      res.end('OK');
      return;
    }

    // Test-only hooks (not part of the real API).
    if (method === 'POST' && path === '/__test/sensors') {
      const body = await readBody(req);
      sensorOverride = { ...(sensorOverride ?? {}), ...(JSON.parse(body || '{}') as Partial<StoveSensors>) };
      applyDerivedSensors();
      bumpRevision();
      res.statusCode = 200;
      res.end('OK');
      return;
    }
    if (method === 'POST' && path === '/__test/clear-sensors') {
      sensorOverride = null;
      applyDerivedSensors();
      bumpRevision();
      res.statusCode = 200;
      res.end('OK');
      return;
    }

    res.statusCode = 404;
    res.end(`No mock handler for ${method} ${path}`);
  }

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    stoveId,
    getControls: () => ({ ...state.controls }),
    controlWrites: () => writes,
    patchSensors(patch) {
      sensorOverride = { ...(sensorOverride ?? {}), ...patch };
      applyDerivedSensors();
      bumpRevision();
    },
    clearSensorOverride() {
      sensorOverride = null;
      applyDerivedSensors();
      bumpRevision();
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

function hasSession(req: IncomingMessage): boolean {
  return (req.headers.cookie ?? '').includes(`connect.sid=${SESSION_TOKEN}`);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function summaryHtml(id: string, name: string): string {
  return `<!doctype html><html><body><ul id="stoveList">
    <li><a href="/web/stove/${id}" data-ajax="false">${name}</a></li>
  </ul></body></html>`;
}

/** Merges a posted, urlencoded controls payload onto the persisted controls. */
function mergeControls(current: StoveControls, incoming: URLSearchParams): StoveControls {
  const next: StoveControls = { ...current };
  for (const [key, value] of incoming) {
    next[key] = decodeControlValue(key, value);
  }
  next.revision = current.revision; // server owns the revision
  return next;
}

const NUMERIC_KEYS = new Set(['operatingMode', 'heatingPower']);
const BOOLEAN_KEYS = new Set([
  'onOff',
  'heatingTimesActiveForComfort',
  'frostProtectionActive',
  'ecoMode',
]);

function decodeControlValue(key: string, value: string): unknown {
  if (BOOLEAN_KEYS.has(key)) {
    return value === 'true';
  }
  if (NUMERIC_KEYS.has(key)) {
    return Number(value);
  }
  return value;
}
