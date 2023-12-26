import type { SmartHomeV1ExecuteRequestCommands, SmartHomeV1SyncDevices } from 'actions-on-google';
import { Characteristic } from '../hap-types';
import { HapService, AccessoryTypeExecuteResponse } from '../interfaces';
import { Hap } from '../hap';

export class TemperatureSensor {
  constructor(
    private hap: Hap,
  ) { }

  sync(service: HapService): SmartHomeV1SyncDevices {
    let traits = [
      'action.devices.traits.TemperatureControl',
    ];
    let attributes = {
      queryOnlyTemperatureControl: true,
      temperatureUnitForUX: this.hap.config.forceFahrenheit ? 'F' : 'C',
    } as any;
    if (service.characteristics.find(x => x.type === Characteristic.CurrentRelativeHumidity)) {
      traits.push('action.devices.traits.HumiditySetting');
      attributes['queryOnlyHumiditySetting'] = true;
    }
    //console.log(JSON.stringify(traits));
    //console.log(JSON.stringify(attributes, null, 2));
    
    return {
      id: service.uniqueId,
      type: 'action.devices.types.SENSOR',
      traits: traits,
      name: {
        defaultNames: [
          service.serviceName,
          service.accessoryInformation.Name,
        ],
        name: service.serviceName,
        nicknames: [],
      },
      willReportState: true,
      attributes: attributes,
      deviceInfo: {
        manufacturer: service.accessoryInformation.Manufacturer,
        model: service.accessoryInformation.Model,
        hwVersion: service.accessoryInformation.HardwareRevision,
        swVersion: service.accessoryInformation.SoftwareRevision,
      },
      customData: {
        aid: service.aid,
        iid: service.iid,
        instanceUsername: service.instance.username,
        instanceIpAddress: service.instance.ipAddress,
        instancePort: service.instance.port,
      },
    };
  }

  query(service: HapService) {
    let response = {
      online: true,
      temperatureSetpointCelsius: service.characteristics.find(x => x.type === Characteristic.CurrentTemperature)?.value,
      temperatureAmbientCelsius: service.characteristics.find(x => x.type === Characteristic.CurrentTemperature)?.value,
    } as any;
    if (service.characteristics.find(x => x.type === Characteristic.CurrentRelativeHumidity)) {
      response['humidityAmbientPercent'] = service.characteristics.find(x => x.type === Characteristic.CurrentRelativeHumidity)?.value;
    }
    //console.log(response);

    return response;
  }

  execute(service: HapService, command: SmartHomeV1ExecuteRequestCommands): AccessoryTypeExecuteResponse {
    return { payload: { characteristics: [] } };
  }

}
