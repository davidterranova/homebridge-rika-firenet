import type { StoveStatus } from '../../api/types.js';
import { deriveStatus } from '../../domain/status.js';
import type { ServiceContext, ServiceModule } from '../context.js';

const SERVICE_NAME = 'Stove Maintenance';

/**
 * Filter Maintenance service used to surface the stove's cleaning/service
 * request in the Home app. `FilterChangeIndication` flips to `CHANGE_FILTER`
 * when the stove reports it needs cleaning.
 */
export function createMaintenanceService(ctx: ServiceContext): ServiceModule {
  const { Service, Characteristic, accessory, poller } = ctx;

  const service =
    accessory.getService(Service.FilterMaintenance) ??
    accessory.addService(Service.FilterMaintenance, SERVICE_NAME);

  service.getCharacteristic(Characteristic.FilterChangeIndication).onGet(() => {
    const status = poller.getLatest();
    return indication(ctx, status);
  });

  function update(status: StoveStatus): void {
    service.updateCharacteristic(Characteristic.FilterChangeIndication, indication(ctx, status));
  }

  return { update };
}

function indication(ctx: ServiceContext, status: StoveStatus | null): number {
  const { Characteristic } = ctx;
  if (status && deriveStatus(status).needsCleaning) {
    return Characteristic.FilterChangeIndication.CHANGE_FILTER;
  }
  return Characteristic.FilterChangeIndication.FILTER_OK;
}

export const __test = { indication };
