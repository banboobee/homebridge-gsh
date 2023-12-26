import type { SmartHomeV1ExecuteRequestCommands, SmartHomeV1SyncDevices } from 'actions-on-google';
import { Characteristic } from '../hap-types';
import { HapService, AccessoryTypeExecuteResponse } from '../interfaces';

export class OccupancySensor {
  sync(service: HapService): SmartHomeV1SyncDevices {
    //const response = {
    return {
      id: service.uniqueId,
      type: 'action.devices.types.SENSOR',
      traits: [
        'action.devices.traits.OccupancySensing',
      ],
      name: {
        defaultNames: [
          service.serviceName,
          service.accessoryInformation.Name,
        ],
        name: service.serviceName,
        nicknames: [],
      },
      willReportState: true,
      attributes: {
	occupancySensorConfiguration: [{
	  occupancySensorType:'PIR',
	}]
      },
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
    
    // console.log(JSON.stringify(response, null, 2));
    // return response;
  }

  query(service: HapService) {
    // const response = {
    return {
      online: true,
      occupancy: service.characteristics.find(x => x.type === Characteristic.OccupancyDetected)?.value ? 'OCCUPIED': 'UNOCCUPIED',
    } as any;

    // console.log(`[${new Date().toLocaleString()}] ${JSON.stringify(response)}`)
    // return response;
  }

  execute(service: HapService, command: SmartHomeV1ExecuteRequestCommands): AccessoryTypeExecuteResponse {
    return { payload: { characteristics: [] } };
  }

}
