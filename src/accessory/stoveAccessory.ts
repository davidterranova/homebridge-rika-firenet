import type { StoveStatus } from '../api/types.js';
import type { ServiceContext, ServiceFactory, ServiceModule } from './context.js';
import { createHeatingPowerService } from './services/heatingPower.js';
import { createMaintenanceService } from './services/maintenance.js';
import { createThermostatService } from './services/thermostat.js';

const SERVICE_FACTORIES: ServiceFactory[] = [
  createThermostatService,
  createHeatingPowerService,
  createMaintenanceService,
];

/**
 * Wires the composable service modules to a single HomeKit accessory and keeps
 * them in sync with the {@link StovePoller}. Uses composition (a list of
 * factory functions) rather than inheritance.
 */
export class StoveAccessory {
  private readonly modules: ServiceModule[];

  constructor(private readonly ctx: ServiceContext) {
    this.setupAccessoryInformation();
    this.modules = SERVICE_FACTORIES.map((factory) => factory(ctx));

    ctx.poller.onUpdate((status) => this.handleUpdate(status));

    const initial = ctx.poller.getLatest();
    if (initial) {
      this.handleUpdate(initial);
    }
  }

  private setupAccessoryInformation(): void {
    const { Service, Characteristic, accessory, config } = this.ctx;
    const info =
      accessory.getService(Service.AccessoryInformation) ??
      accessory.addService(Service.AccessoryInformation);

    info
      .setCharacteristic(Characteristic.Manufacturer, 'RIKA')
      .setCharacteristic(Characteristic.Model, 'Firenet Stove')
      .setCharacteristic(Characteristic.Name, config.name)
      .setCharacteristic(Characteristic.SerialNumber, config.stoveId);
  }

  private handleUpdate(status: StoveStatus): void {
    const { Service, Characteristic, accessory } = this.ctx;
    const info = accessory.getService(Service.AccessoryInformation);
    if (info) {
      info.updateCharacteristic(Characteristic.Model, status.stoveType || 'Firenet Stove');
      if (status.oem) {
        info.updateCharacteristic(Characteristic.Manufacturer, status.oem);
      }
    }

    for (const module of this.modules) {
      module.update(status);
    }
  }
}
