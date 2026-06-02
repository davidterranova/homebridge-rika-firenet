import type { API } from 'homebridge';

import { RikaFirenetPlatform } from './platform.js';
import { PLATFORM_NAME } from './settings.js';

/**
 * Homebridge entry point. Registers the dynamic platform.
 */
export default (api: API): void => {
  api.registerPlatform(PLATFORM_NAME, RikaFirenetPlatform);
};
