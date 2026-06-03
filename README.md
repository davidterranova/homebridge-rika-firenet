# homebridge-rika-firenet

[![Homebridge](https://img.shields.io/badge/Homebridge-v1.8%20%7C%20v2-blue)](https://homebridge.io)
[![Node](https://img.shields.io/badge/node-22%20%7C%2024-green)](https://nodejs.org)

A memory-efficient, [Homebridge v2](https://github.com/homebridge/homebridge/wiki/Updating-To-Homebridge-v2.0) compatible plugin that exposes a [RIKA Firenet](https://www.rika-firenet.com) pellet stove to Apple Home (and any Matter platform bridged by Homebridge) as a HomeKit **thermostat**.

It is a modern, ESM, fully type-checked and unit-tested rewrite that replaces the older `rika-homebridge-firenet` plugin, which is not compatible with Homebridge v2 and is not memory efficient.

## Features

- **Thermostat** – current room temperature and target (Comfort) temperature.
- **Operating modes** mapped onto the HomeKit thermostat state:
  - **Off** – stove powered off.
  - **Heat** – RIKA *Comfort* mode (the stove heats to reach the target temperature).
  - **Auto** – RIKA *Automatic* mode (the stove follows its configured heating-time schedule).
- **Manual mode** – exposed as a *Heating Power* fan: turning it on switches the stove to Manual mode, and the rotation speed sets the heating power in percent.
- **Status & faults** – errors (out of pellets, ignition failure, offline, ...) are surfaced through the thermostat's *Status Fault* characteristic, and a cleaning request is surfaced via a *Filter Maintenance* service.

### HomeKit characteristics

| Service | Characteristic | RIKA mapping |
| --- | --- | --- |
| Thermostat | CurrentTemperature | `sensors.inputRoomTemperature` |
| Thermostat | TargetTemperature | `controls.targetTemperature` (Comfort) |
| Thermostat | TargetHeatingCoolingState | Off / Heat (Comfort) / Auto (Automatic) |
| Thermostat | CurrentHeatingCoolingState | Heat while igniting/running, otherwise Off |
| Thermostat | StatusFault | error / offline / out-of-pellets |
| Fan (Heating Power) | Active + RotationSpeed | Manual mode + `controls.heatingPower` |
| Filter Maintenance | FilterChangeIndication | cleaning/service requested |

## Requirements

- Homebridge `v1.8` or `v2`.
- Node.js `v22` or `v24`.
- A RIKA stove with the RIKA Firenet module and an account at <https://www.rika-firenet.com>.

## Installation

Install via the Homebridge UI (search for "Rika Firenet") or from the command line:

```bash
npm install -g @davidterranova/homebridge-rika-firenet
```

## Configuration

Add the platform through the Homebridge UI, or manually in `config.json`:

```json
{
  "platforms": [
    {
      "platform": "RikaFirenet",
      "name": "Rika Stove",
      "email": "your-account@example.com",
      "password": "your-password",
      "stoveID": "1234567",
      "pollingInterval": 60,
      "minTemperature": 14,
      "maxTemperature": 28
    }
  ]
}
```

| Field | Required | Default | Description |
| --- | --- | --- | --- |
| `email` | yes | – | Your rika-firenet.com account email. |
| `password` | yes | – | Your rika-firenet.com account password. |
| `stoveID` | no | auto | The numeric stove id (visible in the rika-firenet.com URL). If omitted and the account has exactly one stove, it is detected automatically. |
| `pollingInterval` | no | `60` | Status refresh interval in seconds. RIKA recommends a minimum of 60 seconds; lower values are clamped. |
| `minTemperature` | no | `14` | Minimum selectable target temperature (°C). |
| `maxTemperature` | no | `28` | Maximum selectable target temperature (°C). |

## How it works

```
Apple Home  ⇄  Homebridge  ⇄  RikaFirenetPlatform
                                   │
                                   ├── RikaFirenetClient  (single session cookie, native fetch)
                                   └── StovePoller        (single ≥60s loop, write coalescing)
                                           │
                                           └── StoveAccessory  →  Thermostat / Heating Power / Maintenance
```

- A **single** `RikaFirenetClient` holds one `connect.sid` session cookie and re-authenticates automatically when the session expires.
- A **single** `StovePoller` owns the only timer, caches one in-memory status snapshot, and pushes updates to the HomeKit characteristics (no per-characteristic polling).
- Control changes are applied optimistically and **coalesced** into a single API call; stale-revision conflicts are retried with a fresh revision.
- All HTTP uses the built-in Node `fetch`, so there are no heavy HTTP-client dependencies.

## Development

```bash
make install         # install dependencies
make build           # compile TypeScript to dist/
make test            # run the unit tests (Vitest), plus the smoke test if creds are set
make coverage        # run tests with a coverage report
make smoke           # read-only API smoke test against a real stove (STOVE_ID, RIKA_EMAIL, RIKA_PASSWORD)
make lint            # eslint
make update          # update dependencies within package.json ranges
```

Run `make` (or `make help`) to list all available targets. The codebase favors a composable architecture: pure domain functions in `src/domain/`, a dependency-injectable API client in `src/api/`, and small composable HomeKit service modules in `src/accessory/services/`.

## Testing

Testing happens in four complementary layers, ordered from fastest feedback to
the most production-like. Full step-by-step instructions are in
[`doc/testing.md`](doc/testing.md).

1. **Unit tests** — logic only, no network, runs in CI. Covers the domain
   mappers, the API client (mocked `fetch`), the poller (fake timers), and the
   HomeKit service modules. Run with `make test` / `make coverage`.
2. **API smoke test** — drives the real `RikaFirenetClient` against your stove
   to confirm credentials and that the API field names, status codes and
   `revision` round-trip match your stove model. Run it with `make smoke`; it
   also runs automatically at the end of `make test` when `STOVE_ID`,
   `RIKA_EMAIL` and `RIKA_PASSWORD` are set (and is skipped with a message
   otherwise). This is the most valuable real-world check; see
   [doc/testing.md](doc/testing.md#2-api-smoke-test).
3. **Local Homebridge dev instance** — `npm link` into an isolated
   `homebridge -D -U` instance to validate the HomeKit services, characteristics
   and v2 (ESM) loading. See [doc/testing.md](doc/testing.md#3-local-homebridge-dev-instance).
4. **Homebridge UI child bridge** — install the `npm pack` artifact and run it in
   a child bridge: the closest match to how end users run the plugin, and a check
   that `config.schema.json` renders correctly. See
   [doc/testing.md](doc/testing.md#4-homebridge-ui-child-bridge).

Before releasing, work through the
[pre-release checklist](doc/testing.md#pre-release-checklist).

## License

[MIT](LICENSE)
