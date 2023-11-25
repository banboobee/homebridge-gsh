/**
 * Homebridge Entry Point
 */

import * as path from 'path';
import * as fs from 'fs-extra';
import type { API, PlatformAccessory } from 'homebridge';
import { PluginConfig } from './interfaces';
import { PLUGIN_NAME } from './settings';
import { PLATFORM_NAME } from './settings';
import { hostname } from 'os';

export class HomebridgeGoogleSmartHome {
  public accessory: PlatformAccessory;
  private cachedAccessories: PlatformAccessory[] = [];

  constructor(
    public log,
    public config: PluginConfig,
    public api: API,
  ) {
    api.on('didFinishLaunching', async () => {
      if (this.config.token) {
	this.start();
      }
    })
  }
  
  async configureAccessory(cache) {
    this.log('Restoring existing accessory from cache:', cache.displayName);

    this.cachedAccessories.push(cache);
  }

  async start() {
    const { Plugin } = await import('./main');
    const homebridgeConfig = await fs.readJson(path.resolve(this.api.user.configPath()));
    const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}`);
    const version = fs.readJsonSync(path.resolve(__dirname, '../package.json')).version;
    this.accessory = this.cachedAccessories.find((x) => x.UUID == uuid);
    if (!this.accessory) {
      this.accessory = new this.api.platformAccessory(`${PLUGIN_NAME}`, uuid);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [this.accessory]);
    }

    this.accessory
      .getService(this.api.hap.Service.AccessoryInformation)
      .setCharacteristic(this.api.hap.Characteristic.Manufacturer, 'homebridge-gsh')
      .setCharacteristic(this.api.hap.Characteristic.SerialNumber, hostname())
      .setCharacteristic(this.api.hap.Characteristic.FirmwareRevision, version);
    const service = this.accessory
	  .getService(this.api.hap.Service.ContactSensor) || this.accessory.addService(this.api.hap.Service.ContactSensor);
    service.setCharacteristic(this.api.hap.Characteristic.ContactSensorState,
			      this.api.hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED);
    
    return new Plugin(this, homebridgeConfig);
  }
}
