/**
 * Homebridge Entry Point
 */

import * as path from 'path';
import * as fs from 'fs-extra';
import type { API, PlatformAccessory, CharacteristicValue, CharacteristicChange } from 'homebridge';
import { PluginConfig } from './interfaces';
import { PLUGIN_NAME } from './settings';
import { PLATFORM_NAME } from './settings';
import { hostname } from 'os';
import fakegato from 'fakegato-history';
import { EveHomeKitTypes } from 'homebridge-lib';
import { Plugin } from './main';

export class HomebridgeGoogleSmartHome {
  public accessory: PlatformAccessory;
  public plugin: Plugin;
  private cachedAccessories: PlatformAccessory[] = [];
  private fakegatoAPI: any;
  private eve: any;
  private historyService: any = null;

  constructor(
    public log,
    public config: PluginConfig,
    public api: API,
  ) {
    this.fakegatoAPI = fakegato(api);
    this.eve = new EveHomeKitTypes(api);

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
    //const { Plugin } = await import('./main');
    const google = 'Google Smart Home';
    const homebridgeConfig = await fs.readJson(path.resolve(this.api.user.configPath()));
    const uuid = this.api.hap.uuid.generate(`${google}`);
    const version = fs.readJsonSync(path.resolve(__dirname, '../package.json')).version;
    if (!(this.accessory = this.cachedAccessories.find(x => x.UUID === uuid))) {
      this.accessory = new this.api.platformAccessory(`${google}`, uuid);
      this.accessory.context.services = {};
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [this.accessory]);
    }
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME,
		   this.cachedAccessories.filter(x => x.UUID !== uuid));
    
    this.accessory
      .getService(this.api.hap.Service.AccessoryInformation)
      .setCharacteristic(this.api.hap.Characteristic.Manufacturer, PLATFORM_NAME)
      .setCharacteristic(this.api.hap.Characteristic.SerialNumber, hostname())
      .setCharacteristic(this.api.hap.Characteristic.FirmwareRevision, version);
    const sync = this.accessory.getService(this.api.hap.Service.Switch) ||
                 this.accessory.addService(this.api.hap.Service.Switch, `${google} Sync`);
    sync.getCharacteristic(this.api.hap.Characteristic.On)
      .onGet(() => false)
      .onSet(async (on: CharacteristicValue) => {
	if (on === true) {
	  for (const service of Object.values(this.plugin.hap.services)) {
	    if (service.isUnavailable) {
	      delete this.plugin.hap.services[service.uniqueId];
	      this.log.info(`Removed service ${service.serviceName} to sync. type:${service.serviceType} address:${service.instance.ipAddress}:${service.instance.port} aid:${service.aid} iid:${service.iid}.`);
	    }
	  }
	  await this.plugin.hap.requestSync();
	  setTimeout(() => {
	    this.accessory.getService(this.api.hap.Service.Switch)
	      .updateCharacteristic(this.api.hap.Characteristic.On, false);
	  }, 1000);
	}
      });

    const contact = this.accessory.getService(this.api.hap.Service.ContactSensor) ||
	            this.accessory.addService(this.api.hap.Service.ContactSensor, `${google} Contact`);
    contact.setCharacteristic(this.api.hap.Characteristic.ContactSensorState,
			     this.api.hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED);
    this.historyService = new this.fakegatoAPI('door', this.accessory,
	       {log: this.log, storage: 'fs',
		filename: `${hostname().split(".")[0]}_${PLUGIN_NAME}_persist.json`
	       });
    this.historyService.addEntry(
      {time: Math.round(new Date().valueOf()/1000),
       status: this.api.hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
      });
    
    contact.addOptionalCharacteristic(this.eve.Characteristics.OpenDuration);
    contact.getCharacteristic(this.eve.Characteristics.OpenDuration).onGet(() => 0);
    contact.addOptionalCharacteristic(this.eve.Characteristics.ClosedDuration);
    contact.getCharacteristic(this.eve.Characteristics.ClosedDuration).onGet(() => 0);
    contact.addOptionalCharacteristic(this.eve.Characteristics.TimesOpened);
    contact.getCharacteristic(this.eve.Characteristics.TimesOpened)
      .onGet(() => this.accessory.context.timesOpened || 0);
    contact.addOptionalCharacteristic(this.eve.Characteristics.LastActivation);
    contact.getCharacteristic(this.eve.Characteristics.LastActivation)
      .onGet(() => {
	const lastActivation = this.accessory.context.lastActivation ?
	      Math.max(0, this.accessory.context.lastActivation - this.historyService.getInitialTime()) : 0;
	//this.log.debug(`Get LastActivation ${this.accessory.displayName}: ${lastActivation}`);
	return lastActivation;
      });
    contact.addOptionalCharacteristic(this.eve.Characteristics.ResetTotal);
    contact.getCharacteristic(this.eve.Characteristics.ResetTotal)
      .onSet((reset: CharacteristicValue) => {
	const sensor = this.accessory.getService(this.api.hap.Service.ContactSensor);
        this.accessory.context.timesOpened = 0;
        this.accessory.context.lastReset = reset;
        sensor?.updateCharacteristic(this.eve.Characteristics.TimesOpened, 0);
        this.log.debug(`${this.accessory.displayName}: Reset TimesOpened to 0`);
        this.log.debug(`${this.accessory.displayName}: Set lastReset to ${reset}`);
      })
      .onGet(() => {
	return this.accessory.context.lastReset ??
	  (this.historyService.getInitialTime() - Math.round(Date.parse('01 Jan 2001 00:00:00 GMT')/1000));
      });
    contact.getCharacteristic(this.api.hap.Characteristic.ContactSensorState)
      .on('change', (event: CharacteristicChange) => {
	if (event.newValue !== event.oldValue) {
	  this.log.debug(`${this.accessory.displayName}: ContactSensor state on change: ${JSON.stringify(event)}`);
	  const sensor = this.accessory.getService(this.api.hap.Service.ContactSensor);
          const entry = {
            time: Math.round(new Date().valueOf()/1000),
            status: event.newValue
          };
          this.accessory.context.lastActivation = entry.time;
          sensor?.updateCharacteristic(this.eve.Characteristics.LastActivation, Math.max(0, this.accessory.context.lastActivation - this.historyService.getInitialTime()));
          if (entry.status) {
	    this.accessory.context.timesOpened = (this.accessory.context.timesOpened || 0) + 1;
            sensor?.updateCharacteristic(this.eve.Characteristics.TimesOpened, this.accessory.context.timesOpened);
          }
          this.historyService.addEntry(entry);
	}
      });

    this.plugin = new Plugin(this, homebridgeConfig);
  }
}
