import { HAPNodeJSClient } from 'hap-node-client';
import { ServicesTypes, Service, Characteristic } from './hap-types';
import * as crypto from 'crypto';
import { Subject } from 'rxjs';
import { debounceTime, map } from 'rxjs/operators';

import { PluginConfig, HapInstance, HapService, HapCharacteristic, Instance } from './interfaces';
import { toLongFormUUID } from './uuid';
import { Log } from './logger';
import { Plugin } from './main'

import { Door } from './types/door';
import { Fan } from './types/fan';
import { Fanv2 } from './types/fan-v2';
import { GarageDoorOpener } from './types/garage-door-opener';
import { HeaterCooler } from './types/heater-cooler';
import { HumiditySensor } from './types/humidity-sensor';
import { Lightbulb } from './types/lightbulb';
import { LockMechanism } from './types/lock-mechanism';
import { SecuritySystem } from './types/security-system';
import { Switch } from './types/switch';
import { Television } from './types/television';
import { OccupancySensor } from './types/occupancy-sensor';
import { TemperatureSensor } from './types/temperature-sensor';
import { Thermostat } from './types/thermostat';
import { Window } from './types/window';
import { WindowCovering } from './types/window-covering';

export class Hap {
  plugin: Plugin;
  socket;
  log: Log;
  pin: string;
  config: PluginConfig;
  homebridge: HAPNodeJSClient;
  services: {[x: string]: HapService};

  public ready: boolean;

  /* init types */
  types = {
    Door: new Door(),
    Fan: new Fan(),
    Fanv2: new Fanv2(),
    GarageDoorOpener: new GarageDoorOpener(),
    HeaterCooler: new HeaterCooler(this),
    HumiditySensor: new HumiditySensor(),
    Lightbulb: new Lightbulb(),
    LockMechanism: new LockMechanism(),
    Outlet: new Switch('action.devices.types.OUTLET'),
    SecuritySystem: new SecuritySystem(),
    Switch: new Switch('action.devices.types.SWITCH'),
    Television: new Television(),
    TemperatureSensor: new TemperatureSensor(this),
    Thermostat: new Thermostat(this),
    Window: new Window(),
    WindowCovering: new WindowCovering(),
    Speaker: new Television(),
    InputSource: new Television(),
    OccupancySensor: new OccupancySensor(),
  };

  /* event tracking */
  evInstances: Instance[] = [];
  evServices: HapService[] = [];
  reportStateSubject = new Subject();
  pendingStateReport = [];

  /* types of characteristics to track */
  evTypes = [
    Characteristic.Active,
    Characteristic.On,
    Characteristic.CurrentPosition,
    Characteristic.TargetPosition,
    Characteristic.CurrentDoorState,
    Characteristic.TargetDoorState,
    Characteristic.Brightness,
    Characteristic.HeatingThresholdTemperature,
    Characteristic.Hue,
    Characteristic.Saturation,
    Characteristic.LockCurrentState,
    Characteristic.LockTargetState,
    Characteristic.TargetHeatingCoolingState,
    Characteristic.TargetTemperature,
    Characteristic.CoolingThresholdTemperature,
    Characteristic.CurrentTemperature,
    Characteristic.CurrentRelativeHumidity,
    Characteristic.SecuritySystemTargetState,
    Characteristic.SecuritySystemCurrentState,
    Characteristic.ActiveIdentifier,
    Characteristic.Mute,
    Characteristic.OccupancyDetected,
  ];

  instanceBlacklist: Array<string> = [];
  accessoryFilter: Array<string> = [];
  accessorySerialFilter: Array<string> = [];
  deviceNameMap: Array<{ replace: string; with: string }> = [];

  constructor(socket, plugin, pin: string, config: PluginConfig) {
    this.plugin = plugin;
    this.config = config;
    this.socket = socket;
    this.log = plugin.log;
    this.pin = pin;
    //this.services = {};
    this.services = this.plugin.platform.accessory.context.services;
    for (const service of Object.values(this.services)) {
      this.log.info(`Restored service ${service.serviceName}. type:${service.serviceType} address:${service.instance.ipAddress}:${service.instance.port} aid:${service.aid} iid:${service.iid}`);
    }

    this.accessoryFilter = config.accessoryFilter || [];
    this.accessorySerialFilter = config.accessorySerialFilter || [];
    this.instanceBlacklist = config.instanceBlacklist || [];

    this.log.debug('Waiting 15 seconds before starting instance discovery...');
    setTimeout(() => {
      this.discover();
    }, 15000);

    this.reportStateSubject
      .pipe(
        map((i) => {
          if (!this.pendingStateReport.includes(i)) {
            this.pendingStateReport.push(i);
          }
        }),
        debounceTime(1000),
      )
      .subscribe((data) => {
        const pendingStateReport = this.pendingStateReport;
        this.pendingStateReport = [];
        this.processPendingStateReports(pendingStateReport);
      });
  }

  /**
   * Homebridge Instance Discovery
   */
  async discover() {
    this.homebridge = new HAPNodeJSClient({
      debug: this.config.debug,
      pin: this.pin,
      timeout: 10,
    });

    this.homebridge.once('Ready', () => {
      this.ready = true;
      this.log.info('Finished instance discovery');

      setTimeout(() => {
        this.requestSync();
      }, 15000);
    });

    this.homebridge.on('Ready', () => {
      this.start();
    });

    this.homebridge.on('hapEvent', ((event) => {
      this.handleHapEvent(event);
    }));
  }

  /**
   * Start processing
   */
  async start() {
    // this.log.info(`Building service table ....`);
    await this.getAccessories();
    await this.buildSyncResponse();
    await this.registerCharacteristicEventHandlers();
    // this.log.info(`Found ${Object.keys(this.services).length} services.`)
  }

  /**
   * Build Google SYNC intent payload
   */
  async buildSyncResponse() {
    const devices = Object.values(this.services).map((service) => {
      return this.types[service.serviceType].sync(service);
    });
    return devices;
  }

  /**
   * Ask google to send a sync request
   */
  async requestSync() {
    this.log.info('Sending Sync Request');
    this.socket.sendJson({
      type: 'request-sync',
    });
  }

  /**
   * Process the QUERY intent
   * @param devices
   */
  async query(devices) {
    const response = {};

    for (const device of devices) {
      const service = this.services[device.id];
      if (service) {
        await this.getStatus(service);
        response[device.id] = this.types[service.serviceType].query(service);
      } else {
        response[device.id] = {};
      }
    }

    return response;
  }

  /**
   * Process the EXECUTE intent
   * @param commands
   */
  async execute(commands) {
    const response = [];

    for (const command of commands) {
      for (const device of command.devices) {

        const service = this.services[device.id];

        if (service) {

          // check if two factor auth is required, and if we have it
          if (this.config.twoFactorAuthPin && this.types[service.serviceType].twoFactorRequired &&
            this.types[service.serviceType].is2faRequired(command) &&
            !(command.execution.length && command.execution[0].challenge &&
              command.execution[0].challenge.pin === this.config.twoFactorAuthPin.toString()
            )
          ) {
            this.log.info('Requesting Two Factor Authentication Pin');
            response.push({
              ids: [device.id],
              status: 'ERROR',
              errorCode: 'challengeNeeded',
              challengeNeeded: {
                type: 'pinNeeded',
              },
            });
          } else {
            // process the request
            const { payload, states } = this.types[service.serviceType].execute(service, command);
	    if (!payload) {
	      this.log.error(`Failed to control an accessory on executing ${command.execution[0].command}.`);
	      response.push({
		ids: [device.id],
                status: 'ERROR',
	      });
	      continue;
	    }

            await new Promise((resolve, reject) => {
              this.homebridge.HAPcontrol(service.instance.ipAddress, service.instance.port, JSON.stringify(payload), (err) => {
                if (!err) {
                  response.push({
                    ids: [device.id],
                    status: 'SUCCESS',
                    states,
                  });
                } else {
                  this.log.error('Failed to control an accessory. Make sure all your Homebridge instances are using the same PIN.');
                  this.log.error(err.message);
                  response.push({
                    ids: [device.id],
                    status: 'ERROR',
                  });
                }
                return resolve(undefined);
              });
            });
          }

        }
      }
    }
    return response;
  }

  /**
   * Request a status update from an accessory
   * @param service
   */
  async getStatus(service) {
    const iids: number[] = service.characteristics.map(c => c.iid);

    const body = '?id=' + iids.map(iid => `${service.aid}.${iid}`).join(',');

    const characteristics = await new Promise((resolve, reject) => {
      this.homebridge.HAPstatus(service.instance.ipAddress, service.instance.port, body, (err, status) => {
        if (err) {
          return reject(err);
        }
        return resolve(status.characteristics);
      });
    }) as Array<HapCharacteristic>;

    for (const c of characteristics) {
      const characteristic = service.characteristics.find(x => x.iid === c.iid);
      characteristic.value = c.value;
    }
  }

  /**
   * Check that it's possible to connect to the instance
   */
  private async checkInstanceConnection(instance: HapInstance): Promise<boolean> {
    return new Promise((resolve) => {
      this.homebridge.HAPcontrol(instance.ipAddress, instance.instance.port, JSON.stringify(
        { characteristics: [{ aid: -1, iid: -1 }] },
      ), (err) => {
        if (err) {
          return resolve(false);
        }
        return resolve(true);
      });
    });
  }

  /**
   * Load accessories from Homebridge
   */
  async getAccessories() {
    return new Promise((resolve, reject) => {
      this.homebridge.HAPaccessories(async (instances: HapInstance[]) => {
        //this.services = {};
	for (const service of Object.values(this.services)) {
	  service.isUnavailable++;
	}

        for (const instance of instances) {
          if (!await this.checkInstanceConnection(instance)) {
            this.instanceBlacklist.push(instance.instance.txt.id);
          }

          if (!this.instanceBlacklist.find(x => x.toLowerCase() === instance.instance.txt.id.toLowerCase())) {
            await this.parseAccessories(instance);
          } else {
            this.log.debug(`Instance [${instance.instance.txt.id}] on instance blacklist, ignoring.`);
          }
        }
	
	for (const service of Object.values(this.services)) {
	  const lostlimit = 96;	// 1 day
	  if (service.isUnavailable) {
	    this.log.warn(`Lost service ${service.serviceName} last ${service.isUnavailable} attempts. type:${service.serviceType} address:${service.instance.ipAddress}:${service.instance.port} aid:${service.aid} iid:${service.iid}.`);
	    if (service.isUnavailable > lostlimit) {
	      this.log.error(`Removed service ${service.serviceName} due to exceeding lost count limit. type:${service.serviceType} address:${service.instance.ipAddress}:${service.instance.port} aid:${service.aid} iid:${service.iid}.`);
	      delete this.services[service.uniqueId];
	    }
	  }
	}
        return resolve(true);
      });
    });
  }

  /**
   * Parse accessories from homebridge and filter out the ones we support
   * @param instance
   */
  async parseAccessories(instance: HapInstance) {
    instance.accessories.accessories.forEach((accessory) => {
      let televisions: HapService[] = [];
      let speakers: HapService[] = [];
      let inputs: HapService[] = [];
      /** Ensure UUIDs are long form */
      for (const service of accessory.services) {
        service.type = toLongFormUUID(service.type);
        for (const characteristic of service.characteristics) {
          characteristic.type = toLongFormUUID(characteristic.type);
        }
      }

      // get accessory information service
      const accessoryInformationService = accessory.services.find(x => x.type === Service.AccessoryInformation);
      const accessoryInformation = {};

      if (accessoryInformationService && accessoryInformationService.characteristics) {
        accessoryInformationService.characteristics.forEach((c) => {
          if (c.value) {
            accessoryInformation[c.description] = c.value;
          }
        });
      }

      // discover the service type
      accessory.services
        .filter(x => x.type !== Service.AccessoryInformation)
        .filter(x => ServicesTypes[x.type])
        .filter(x => Object.prototype.hasOwnProperty.call(this.types, ServicesTypes[x.type]))
        .forEach((service) => {
          service.accessoryInformation = accessoryInformation;
          service.aid = accessory.aid;
          service.serviceType = ServicesTypes[service.type];
          service.isUnavailable = 0;

          service.instance = {
            ipAddress: instance.ipAddress,
            port: instance.instance.port,
            username: instance.instance.txt.id,
          };

          // generate unique id for service
          //service.uniqueId = crypto.createHash('sha256')
          const uniqueId = crypto.createHash('sha256')
            .update(`${service.instance.username}${service.aid}${service.iid}${service.type}`)
            .digest('hex');
	  service.uniqueId = uniqueId;

          // discover name of service
          const serviceNameCharacteristic = service.characteristics.find(x => [
            Characteristic.Name,
            Characteristic.ConfiguredName,
          ].includes(x.type));

          service.serviceName = (serviceNameCharacteristic && serviceNameCharacteristic.value.length) ?
            serviceNameCharacteristic.value : service.accessoryInformation.Name || service.serviceType;

          // perform user-defined name replacements
          const nameMap = this.deviceNameMap.find(x => x.replace === service.serviceName);
          if (nameMap) {
            service.serviceName = nameMap.with;
          }

          // perform user-defined service filters based on name
          // if (this.accessoryFilter.includes(service.serviceName)) {
          //   this.log.debug(`Skipping ${service.serviceName} ${service.accessoryInformation['Serial Number']} - matches accessoryFilter`);
          //   return;
          // }
	  for (const x of this.accessoryFilter) {
	    if (service.serviceName.search(x) !== -1) {
              this.log.debug(`Skipping ${service.serviceName} ${service.accessoryInformation['Serial Number']} - matches accessoryFilter`);
              return;
	    }
	  }

          // perform user-defined service filters based on serial number
          if (this.accessorySerialFilter.includes(service.accessoryInformation['Serial Number'])) {
            this.log.debug(`Skipping ${service.serviceName} ${service.accessoryInformation['Serial Number']} - matches accessorySerialFilter'`);
            return;
          }

          // if 2fa is forced for this service type, but a pin has not been set ignore the service
          if (this.types[service.serviceType].twoFactorRequired && !this.config.twoFactorAuthPin && !this.config.disablePinCodeRequirement) {
            this.log.warn(`Not registering ${service.serviceName} - Pin cide has not been set and is required for secure ` +
              `${service.serviceType} accessory types. See https://git.io/JUQWX`);
            return;
          }

          // Skip television and related services to handle later
	  if (service.type === Service.Television) {
	    televisions.push(service)
	    return;
	  }
	  if (service.type === Service.Speaker) {
	    speakers.push(service)
	    return;
	  }
	  if (service.type === Service.InputSource) {
	    inputs.push(service)
	    return;
	  }

	  if (!this.services[uniqueId]) {
	    this.log.info(`Found service ${service.serviceName}. type:${service.serviceType} address:${service.instance.ipAddress}:${service.instance.port} aid:${service.aid} iid:${service.iid}`);
	  }
          this.services[uniqueId] = service;
        });
      // Merge television services into single service. 
      if (televisions.length > 0) {	// should be only one.
	if (speakers.length > 0) {	// should be only one.
	  let c;
	  if (c = speakers[0].characteristics.find(x => x.type == Characteristic.Mute)) {
	    televisions[0].characteristics.push(c);
	  }
	  if (c = speakers[0].characteristics.find(x => x.type == Characteristic.VolumeSelector)) {
	    televisions[0].characteristics.push(c);
	  }
	}
	if (inputs.length > 0) {
	  televisions[0].extras = {};
	  televisions[0].extras.channels = [];
	  televisions[0].extras.channelAliases = this.config?.channelAliases;
	  televisions[0].extras.inputs = [];
	  for (const service of inputs) {
	    let s = service.characteristics.find(x => x.type == Characteristic.ConfiguredName).value;
	    let c = {	// better to iterate by characteristics.
	      Name: service.characteristics.find(x => x.type == Characteristic.Name).value,
	      Identifier: service.characteristics.find(x => x.type == Characteristic.Identifier).value,
	      InputSourceType: service.characteristics.find(x => x.type == Characteristic.InputSourceType).value,
	    } as any;
	    if (s.substring(0, 10) ===  'Station - ') {
	      c.ConfiguredName = s.substring(10);
	      televisions[0].extras.channels.push(c);
	    } else {
	      c.ConfiguredName = s;
	      televisions[0].extras.inputs.push(c);
	    }
	  }
	  //this.log.info(televisions[0].extras);
	}
	//console.log(`Found television Service: ${JSON.stringify(televisions[0])}`);
	if (!this.services[televisions[0].uniqueId]) {
	  this.log.info(`Found service ${televisions[0].serviceName}. type:${televisions[0].serviceType} address:${televisions[0].instance.ipAddress}:{televisions[0].instance.port} aid:${televisions[0].aid} iid:${televisions[0].iid}`);
	}
        this.services[televisions[0].uniqueId] = televisions[0];
      }
    });
  }

  /**
   * Register hap characteristic event handlers
   */
  async registerCharacteristicEventHandlers() {
    for (const service of Object.values(this.services)) {
      // get a list of characteristics we can watch
      const evCharacteristics = service.characteristics.filter(x => x.perms.includes('ev') && this.evTypes.includes(x.type));

      if (evCharacteristics.length) {
        // register the instance if it's not already there
        if (!this.evInstances.find(x => x.username === service.instance.username)) {
          const newInstance = Object.assign({}, service.instance);
          newInstance.evCharacteristics = [];
          this.evInstances.push(newInstance);
        }

        const instance = this.evInstances.find(x => x.username === service.instance.username);

        for (const evCharacteristic of evCharacteristics) {
          if (!instance.evCharacteristics.find(x => x.aid === service.aid && x.iid === evCharacteristic.iid)) {
            instance.evCharacteristics.push({ aid: service.aid, iid: evCharacteristic.iid, ev: true });
          }
        }
      }
    }

    // start listeners
    for (const instance of this.evInstances) {
      const unregistered = instance.evCharacteristics.filter(x => !x.registered);
      if (unregistered.length) {
        this.homebridge.HAPevent(instance.ipAddress, instance.port, JSON.stringify({
          characteristics: instance.evCharacteristics.filter(x => !x.registered),
        }), (err, response) => {
          if (err) {
            this.log.error(err.message);
            this.instanceBlacklist.push(instance.username);
            this.evInstances.splice(this.evInstances.indexOf(instance), 1);
          } else {
            instance.evCharacteristics.forEach((c) => {
              c.registered = true;
            });
            this.log.debug('HAP Event listeners registered succesfully');
          }
        });
      }
    }
  }

  /**
   * Handle events from HAP
   * @param event
   */
  async handleHapEvent(events) {
    for (const event of events) {
      const accessories = Object.values(this.services).filter(s =>
        s.instance.ipAddress === event.host && s.instance.port === event.port && s.aid === event.aid);
      const service = accessories.find(x => x.characteristics.find(c => c.iid === event.iid));
      if (service) {
        const characteristic = service.characteristics.find(c => c.iid === event.iid);
        characteristic.value = event.value;
        this.reportStateSubject.next(service.uniqueId);
      }
    }
  }

  /**
   * Generate a state report from the list pending
   * @param pendingStateReport
   */
  async processPendingStateReports(pendingStateReport) {
    const states = {};

    for (const uniqueId of pendingStateReport) {
      const service = this.services[uniqueId];
      states[service.uniqueId] = this.types[service.serviceType].query(service);
    }

    return await this.sendStateReport(states);
  }

  async sendFullStateReport() {
    const states = {};

    // don't report state if there are no services
    if (!Object.keys(this.services).length) {
      return;
    }

    for (const service of Object.values(this.services)) {
      states[service.uniqueId] = this.types[service.serviceType].query(service);
    }
    return await this.sendStateReport(states);
  }

  /**
   * Send the state report back to Google
   * @param states
   * @param requestId
   */
  async sendStateReport(states, requestId?) {
    // this.plugin.platform.accessory.getService(this.plugin.platform.api.hap.Service.Switch)
    //   .updateCharacteristic(this.plugin.platform.api.hap.Characteristic.On, true);
    
    const payload = {
      requestId,
      type: 'report-state',
      body: states,
    };
    this.log.debug('Sending State Report');
    this.log.debug(JSON.stringify(payload, null, 2));
    this.socket.sendJson(payload);
  }
}
