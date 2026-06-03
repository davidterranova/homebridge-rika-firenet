# Testing the plugin

This document describes how to practically test `@davidterranova/homebridge-rika-firenet`,
from the fastest feedback loop to a full production-like setup.

There are four complementary layers:

1. [Unit tests](#1-unit-tests) — logic, no network, runs in CI.
2. [API smoke test](#2-api-smoke-test) — verifies your credentials and the real RIKA API contract.
3. [Local Homebridge dev instance](#3-local-homebridge-dev-instance) — verifies the HomeKit wiring.
4. [Homebridge UI child bridge](#4-homebridge-ui-child-bridge) — closest to how end users run it.

Start with layer 1, then 2. Layers 3 and 4 are about validating the HomeKit
experience once you trust the underlying logic.

---

## 1. Unit tests

The fastest loop. No network access, deterministic, and they cover the domain
mappers, the API client (mocked `fetch`), the poller (fake timers), and the
HomeKit service modules (real HAP service objects).

```bash
make test            # run once
make test-watch      # re-run on change
make coverage        # generate a coverage report (coverage/index.html)
make lint            # eslint
make build           # type-check + emit dist/
```

Use these while developing logic. They will not catch a mismatch between the
assumed API shape and *your* stove model — that is what the smoke test is for.

---

## 2. API smoke test

This is the single most valuable real-world test: everything downstream depends
on the client correctly talking to the RIKA Firenet API for *your* stove model.
Field names, casing and the `revision` round-trip vary slightly between models,
so confirm them against real hardware before touching HomeKit.

The `RikaFirenetClient` is dependency-free and runs standalone, so you can hit
the real API in seconds without Homebridge.

The smoke test is automated as the `make smoke` target and is also run
automatically at the end of `make test` whenever the required credentials are
present (it is skipped — with a message — otherwise).

### Steps

1. Provide your RIKA Firenet credentials. The targets read them either from your
   shell environment or from a (git-ignored) `.env` file in the project root:

   ```bash
   # .env
   STOVE_ID=1234567        # optional: pin a specific stove
   RIKA_EMAIL=your-account@example.com
   RIKA_PASSWORD=your-password
   ```

   Or export them in your shell (avoid the command line so they don't end up in
   your shell history):

   ```bash
   read -rs RIKA_EMAIL;    export RIKA_EMAIL
   read -rs RIKA_PASSWORD; export RIKA_PASSWORD
   export STOVE_ID=1234567 # optional: pin a specific stove
   ```

2. Run the read-only smoke test. It builds the project, logs in, lists your
   stoves, and prints the decoded status:

   ```bash
   make smoke
   ```

   `make test` also runs it automatically after the unit tests when
   `STOVE_ID`, `RIKA_EMAIL` and `RIKA_PASSWORD` are all set; if any are missing
   it prints which ones and skips the smoke test.

   Under the hood this runs `scripts/smoke-test.mjs` against the compiled client
   in `dist/`. The equivalent inline command is:

   ```bash
   node --input-type=module -e '
   import { RikaFirenetClient } from "./dist/api/client.js";
   import { deriveStatus } from "./dist/domain/status.js";
   import { getCurrentTemperature, getTargetTemperature, getHeatingPower, getOperatingMode, isOn } from "./dist/domain/state.js";

   const client = new RikaFirenetClient({
     email: process.env.RIKA_EMAIL,
     password: process.env.RIKA_PASSWORD,
     logger: console,
   });

   const stoves = await client.login();
   console.log("Stoves:", stoves);

   const id = process.env.STOVE_ID ?? stoves[0].id;
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
   '
   ```

### What to verify

- **Authentication** succeeds and the stove list is non-empty.
- The **field names and casing** in the raw status match `src/api/types.ts`
  (`inputRoomTemperature`, `targetTemperature`, `heatingPower`, `revision`, ...).
  If anything is missing, log the full `status` object and reconcile the types.
- The decoded `status` from `deriveStatus()` matches what the rika-firenet.com
  web UI shows (running / standby / cleaning / error, etc.). If your stove
  emits `statusMainState`/`statusSubState` values that map to `Unknown`, capture
  them and extend `src/domain/status.ts`.

### Optional: test a write (changes your stove)

> Caution: this actually controls your stove. Use a harmless change such as
> nudging the target temperature by 1°C, and do it while you are present.

```bash
node --input-type=module -e '
import { RikaFirenetClient } from "./dist/api/client.js";
import { buildControlsPayload } from "./dist/domain/controls.js";

const client = new RikaFirenetClient({
  email: process.env.RIKA_EMAIL,
  password: process.env.RIKA_PASSWORD,
  logger: console,
});

await client.login();
const id = process.env.STOVE_ID ?? (await client.listStoves())[0].id;
const status = await client.getStatus(id);

const next = Number(status.controls.targetTemperature) + 1;
const payload = buildControlsPayload(status.controls, { targetTemperature: String(next) });
await client.setControls(id, payload);
console.log("Set target temperature to", next, "OK");

await client.logout();
'
```

Confirm:

- The call resolves without throwing (the API returned a body containing `OK`).
- A subsequent `getStatus` reflects the new value and a **new** `revision`.
- Re-sending the *old* revision raises `OutdatedRevisionError` (the poller's
  retry path handles this automatically in production).

---

## 3. Local Homebridge dev instance

Validates the HomeKit wiring: services, characteristics, get/set handlers and
that the plugin loads correctly under Homebridge v2 (ESM).

### Steps

1. Build and link the package so a global Homebridge can resolve it:

   ```bash
   make build
   npm link
   ```

2. Create an isolated Homebridge config directory so you don't disturb any
   existing instance:

   ```bash
   mkdir -p ~/rika-hb-dev
   ```

3. Add a minimal `~/rika-hb-dev/config.json`:

   ```json
   {
     "bridge": {
       "name": "Rika Dev Bridge",
       "username": "CC:22:3D:E3:CE:F6",
       "port": 51826,
       "pin": "031-45-154"
     },
     "platforms": [
       {
         "platform": "RikaFirenet",
         "name": "Rika Stove",
         "email": "your-account@example.com",
         "password": "your-password",
         "stoveID": "1234567",
         "pollingInterval": 60
       }
     ]
   }
   ```

4. Run Homebridge in debug mode against that directory:

   ```bash
   homebridge -D -U ~/rika-hb-dev
   ```

   - `-D` enables debug logging (you'll see every status refresh and control write).
   - `-U` points Homebridge at the isolated config/persist directory.

5. Pair the bridge in the Apple Home app (Add Accessory → enter the PIN from the
   config, or scan the QR code printed in the terminal).

6. Exercise the accessory in the Home app and watch the logs:
   - Set the thermostat to **Heat** (→ Comfort) and **Auto** (→ Automatic), and **Off**.
   - Change the **target temperature** (Comfort).
   - Turn the **Heating Power** fan on/off and change the rotation speed (Manual mode).
   - Confirm the **current temperature**, **fault** indicator and **filter
     maintenance** (cleaning) state reflect the real stove.

### Fast iteration

Run the compiler in watch mode in a second terminal, then restart Homebridge to
load changes:

```bash
npm run watch
```

To reset pairing state, stop Homebridge and delete `~/rika-hb-dev/persist` and
`~/rika-hb-dev/accessories`, then start again.

### Cleanup

```bash
npm unlink -g @davidterranova/homebridge-rika-firenet
```

---

## 4. Homebridge UI child bridge

The closest match to how end users run the plugin. It also validates that the
published artifact loads (ESM, `engines`) and that `config.schema.json` renders
a usable form in the UI.

### Steps

1. Produce the exact artifact that would be published and note the tarball name:

   ```bash
   make build
   npm pack            # creates davidterranova-homebridge-rika-firenet-<version>.tgz
   ```

2. In a Homebridge UI instance, install the tarball (Plugins → ⋮ → *Install from
   tarball/file*, or on the host):

   ```bash
   npm install -g ./davidterranova-homebridge-rika-firenet-1.0.0.tgz
   ```

3. Configure the platform through the **Settings** form (this exercises
   `config.schema.json`) and save.

4. Enable a **child bridge** for the platform (Plugin → ⋮ → *Bridge Settings*).
   Running in a child bridge isolates the plugin's process — the recommended way
   to run any plugin and the best way to confirm it survives restarts.

5. Pair the child bridge in the Home app and repeat the interaction checks from
   layer 3.

### What to verify

- The plugin loads without ESM/`require` errors under Homebridge v2.
- The config form shows all fields with correct types (password masked, polling
  interval numeric with a 60s minimum).
- The accessory persists across Homebridge restarts (the cached accessory is
  restored rather than duplicated).

---

## Pre-release checklist

| Check | Command / action |
| --- | --- |
| Logic tests pass | `make test` |
| Lint clean | `make lint` |
| Type-check / build | `make build` |
| Real API contract verified | [API smoke test](#2-api-smoke-test) against your stove |
| HomeKit interactions verified | [Local dev instance](#3-local-homebridge-dev-instance) |
| Loads as published artifact | [Child bridge](#4-homebridge-ui-child-bridge) from `npm pack` |
| No accessory duplication on restart | Restart Homebridge, confirm a single accessory |
| Polling respects RIKA's ≥60s guidance | Check debug logs for refresh cadence |
