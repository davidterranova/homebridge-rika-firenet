import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HttpClient } from 'hap-controller';

import { PairedAccessory } from './hap.js';

const PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const HOMEBRIDGE_BIN = join(PROJECT_ROOT, 'node_modules', '.bin', 'homebridge');
const PIN = '031-45-154';

export interface HarnessOptions {
  /** Base URL of the mock RIKA server. */
  baseUrl: string;
  stoveId: string;
  /** Time to wait for Homebridge to come up before failing. */
  startupTimeoutMs?: number;
  /** Forward Homebridge logs to the console (handy when debugging). */
  verbose?: boolean;
}

export interface Harness {
  client: HttpClient;
  accessory: PairedAccessory;
  /** Reloads the accessory database (e.g. after a config-number change). */
  reload(): Promise<PairedAccessory>;
  logs(): string;
  stop(): Promise<void>;
}

/**
 * Boots a real, headless Homebridge process with this plugin loaded, pointed at
 * a mock RIKA backend, then pairs with it over HAP-IP as a HomeKit controller.
 * This exercises the same path the Apple Home app would: ESM plugin loading,
 * accessory registration, HAP publishing and the get/set characteristic
 * handlers — all without a human or the real Home app.
 */
export async function startHomebridge(options: HarnessOptions): Promise<Harness> {
  const startupTimeoutMs = options.startupTimeoutMs ?? 30_000;
  const userDir = await mkdtemp(join(tmpdir(), 'rika-hb-it-'));
  const username = randomUsername();
  const port = await freePort();

  const config = {
    bridge: { name: 'Rika IT Bridge', username, port, pin: PIN },
    platforms: [
      {
        platform: 'RikaFirenet',
        name: 'Rika Stove',
        email: 'integration@example.com',
        password: 'integration-secret',
        stoveID: options.stoveId,
        baseUrl: options.baseUrl,
        pollingInterval: 60,
      },
    ],
  };
  await writeFile(join(userDir, 'config.json'), JSON.stringify(config, null, 2));

  const child = spawn(
    HOMEBRIDGE_BIN,
    ['-U', userDir, '-P', PROJECT_ROOT, '--strict-plugin-resolution', '-D', '-Q', '-T'],
    { cwd: PROJECT_ROOT, env: process.env },
  ) as ChildProcessWithoutNullStreams;

  let log = '';
  const onData = (chunk: Buffer): void => {
    const text = chunk.toString();
    log += text;
    if (options.verbose) {
      process.stdout.write(text);
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);

  const stop = async (): Promise<void> => {
    if (!child.killed) {
      child.kill('SIGTERM');
      await Promise.race([once(child), delay(5000)]);
      if (child.exitCode === null) {
        child.kill('SIGKILL');
      }
    }
    await rm(userDir, { recursive: true, force: true });
  };

  try {
    await waitForReady(child, () => log, startupTimeoutMs);
    const client = new HttpClient(username, '127.0.0.1', port, undefined, {
      usePersistentConnections: true,
    });
    await pairWithRetry(client, PIN);
    const accessory = await PairedAccessory.load(client);

    return {
      client,
      accessory,
      reload: () => PairedAccessory.load(client),
      logs: () => log,
      stop: async () => {
        await client.close().catch(() => undefined);
        await stop();
      },
    };
  } catch (err) {
    await stop();
    throw new Error(`Homebridge failed to start/pair: ${(err as Error).message}\n--- logs ---\n${log}`);
  }
}

function waitForReady(
  child: ChildProcessWithoutNullStreams,
  getLog: () => string,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out after ${timeoutMs}ms waiting for Homebridge to be ready`));
    }, timeoutMs);

    const check = (): void => {
      const log = getLog();
      const hapUp = /is running on port \d+/.test(log) || /Homebridge is running on port/.test(log);
      const pluginReady = /is ready\./.test(log);
      if (hapUp && pluginReady) {
        cleanup();
        resolve();
      }
    };
    const onData = (): void => check();
    const onExit = (code: number | null): void => {
      cleanup();
      reject(new Error(`Homebridge exited early with code ${code}`));
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      child.stdout.off('data', onData);
      child.stderr.off('data', onData);
      child.off('exit', onExit);
    };

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', onExit);
    check();
  });
}

async function pairWithRetry(client: HttpClient, pin: string): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await client.pairSetup(pin);
      return;
    } catch (err) {
      lastErr = err;
      await delay(1000);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function randomUsername(): string {
  const octet = (): string =>
    Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, '0')
      .toUpperCase();
  return `CC:22:3D:${octet()}:${octet()}:${octet()}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function once(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolve) => child.once('exit', () => resolve()));
}
