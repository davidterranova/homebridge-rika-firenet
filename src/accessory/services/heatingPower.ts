import type { CharacteristicValue } from 'homebridge';

import type { StoveStatus } from '../../api/types.js';
import { OperatingMode } from '../../domain/mode.js';
import { getHeatingPower, getOperatingMode, isOn } from '../../domain/state.js';
import type { ServiceContext, ServiceModule } from '../context.js';

const SERVICE_NAME = 'Heating Power';
const SERVICE_SUBTYPE = 'heating-power';

/**
 * Fan service representing RIKA Manual mode. `Active` reflects whether the
 * stove is on and in Manual mode; `RotationSpeed` is the manual heating power
 * in percent. Changing either switches the stove into Manual mode.
 */
export function createHeatingPowerService(ctx: ServiceContext): ServiceModule {
  const { Service, Characteristic, accessory, poller, log } = ctx;

  const service =
    accessory.getServiceById(Service.Fanv2, SERVICE_SUBTYPE) ??
    accessory.addService(Service.Fanv2, SERVICE_NAME, SERVICE_SUBTYPE);

  service.getCharacteristic(Characteristic.RotationSpeed).setProps({
    minValue: 0,
    maxValue: 100,
    minStep: 1,
  });

  service
    .getCharacteristic(Characteristic.Active)
    .onGet(() => activeValue(ctx, poller.getLatest()))
    .onSet(async (value: CharacteristicValue) => {
      if (value === Characteristic.Active.ACTIVE) {
        log.info('Switching stove to Manual mode (on)');
        await poller.applyPatch({ onOff: true, operatingMode: OperatingMode.Manual });
      } else {
        log.info('Turning stove off via Manual power switch');
        await poller.applyPatch({ onOff: false });
      }
    });

  service
    .getCharacteristic(Characteristic.RotationSpeed)
    .onGet(() => {
      const status = poller.getLatest();
      return status ? getHeatingPower(status) : 0;
    })
    .onSet(async (value: CharacteristicValue) => {
      const power = Math.round(Number(value));
      log.info(`Setting manual heating power to ${power}%`);
      await poller.applyPatch({
        onOff: true,
        operatingMode: OperatingMode.Manual,
        heatingPower: power,
      });
    });

  function update(status: StoveStatus): void {
    service.updateCharacteristic(Characteristic.Active, activeValue(ctx, status));
    service.updateCharacteristic(Characteristic.RotationSpeed, getHeatingPower(status));
  }

  return { update };
}

function activeValue(ctx: ServiceContext, status: StoveStatus | null): number {
  const { Characteristic } = ctx;
  if (status && isOn(status) && getOperatingMode(status) === OperatingMode.Manual) {
    return Characteristic.Active.ACTIVE;
  }
  return Characteristic.Active.INACTIVE;
}

export const __test = { activeValue };
