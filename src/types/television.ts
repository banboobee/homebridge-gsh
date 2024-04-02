import { Characteristic } from '../hap-types';
import { HapService, AccessoryTypeExecuteResponse } from '../interfaces';

export class Television {
  sync(service: HapService) {
    let traits = [
      'action.devices.traits.OnOff',
      'action.devices.traits.MediaState',
      //'action.devices.traits.Modes',
      //'action.devices.traits.Toggles',
      'action.devices.traits.AppSelector',
      'action.devices.traits.TransportControl',
    ];
    let attributes = {
      commandOnlyOnOff: false,	//OnOff
      queryOnlyOnOff: false,
      supportActivityState: false,//MediaState
      supportPlaybackState: false,
    } as any;
    attributes.availableApplications = [];
    attributes.transportControlSupportedCommands = [];
    if (service.characteristics.find(x => x.type === Characteristic.RemoteKey)) {
      attributes.transportControlSupportedCommands = [
	'STOP',
	'RESUME',
	'PAUSE',
	'NEXT',
	'PREVIOUS',
      ];
    }
    if (service.characteristics.find(x => x.type === Characteristic.VolumeSelector)) {
      traits.push('action.devices.traits.Volume');
      attributes.volumeCanMuteAndUnmute = service.characteristics.find(x => x.type === Characteristic.Mute) ? true : false;
      attributes.volumeMaxLevel = 20;	//Volume. Just in case for a relative operations
      attributes.commandOnlyVolume = true;
    }
    if (service.extras?.channels && service.extras.channels.length > 0) {
      traits.push('action.devices.traits.Channel');
      attributes.commandOnlyChannels = true;
      attributes.availableChannels = [];
      for (const c of service.extras.channels) {
	let n = [c.ConfiguredName], a;
	if (a = service.extras.channelAlias?.find(x => x.channel === c.ConfiguredName)) {
	  for (const x of a.alias) {
	    n.push(x);
	  }
	}
	attributes.availableChannels.push({
	  key: c.Name,
	  names: n,
	  number: `${c.Identifier + 1}`,
	});
      }
    }
    if (service.extras?.inputs && service.extras.inputs.length > 0) {
      traits.push('action.devices.traits.InputSelector');
      attributes.commandOnlyInputSelector = false;
      attributes.orderedInputs = true;
      attributes.availableInputs = [{
	key: "_tv",	//dummy for stations
	names: [
	  {
	    lang: "en",
	    name_synonym: [
	      "_tv",
	    ]
	  }
	]
      }];
      for (const c of service.extras.inputs) {
	attributes.availableInputs.push({
	  key: c.Name,
	  names: [
	    {
	      lang: "en",
	      name_synonym: [
		c.ConfiguredName,
	      ]
	    }
	  ],
	});
      }
    }
    //console.log(JSON.stringify(traits));
    //console.log(JSON.stringify(attributes, null, 2));

    return {
      id: service.uniqueId,
      type: 'action.devices.types.TV',
      traits: traits,
      attributes: attributes,
      name: {
        defaultNames: [
          service.serviceName,
          service.accessoryInformation.Name,
        ],
        name: service.serviceName,
        nicknames: [],
      },
      willReportState: true,
      deviceInfo: {
        manufacturer: service.accessoryInformation.Manufacturer,
        model: service.accessoryInformation.Model,
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
    let c;
    let response = {
      on: service.characteristics.find(x => x.type === Characteristic.Active).value ? true : false,
      online: true,
    } as any;
    if (service.characteristics.find(x => x.type === Characteristic.VolumeSelector)) {
      response.currentVolume = 10;
    }
    if (c = service.characteristics.find(x => x.type === Characteristic.Mute)) {
      response.isMuted =  c.value ? true : false;
    }
    if (c = service.characteristics.find(x => x.type === Characteristic.ActiveIdentifier)) {
      let i;
      response.currentInput =  "_tv";
      if (i = service.extras.inputs.find(x => x.Identifier === c.value)) {
	response.currentInput =  i.Name;
      }
    }
    //console.log(response);
    
    return response;
    
    // return {
    //   on: service.characteristics.find(x => x.type === Characteristic.Active).value ? true : false,
    //   online: true,
    // };
  }

  execute(service: HapService, command): AccessoryTypeExecuteResponse {
    if (!command.execution.length) {
      return { payload: { characteristics: [] } };
    }

    switch (command.execution[0].command) {
      case ('action.devices.commands.OnOff'): {
        const payload = {
          characteristics: [{
            aid: service.aid,
            iid: service.characteristics.find(x => x.type === Characteristic.Active).iid,
            value: command.execution[0].params.on ? 1 : 0,
          }],
        };
        return { payload };
      }
      case ('action.devices.commands.mute'): {
        const payload = {
          characteristics: [{
            aid: service.aid,
            iid: service.characteristics.find(x => x.type === Characteristic.Mute).iid,
            value: command.execution[0].params.mute ? 1 : 0,
          }],
        };
        return { payload };
      }
   // case ('action.devices.commands.setVolume'): {	// No proper characteristic
   // }
      case ('action.devices.commands.volumeRelative'): {
	// Characteristic.VolumeSelector.INCREMENT = 0;
	// Characteristic.VolumeSelector.DECREMENT = 1;
        const payload = {
          characteristics: [{
            aid: service.aid,
            iid: service.characteristics.find(x => x.type === Characteristic.VolumeSelector).iid,
            value: command.execution[0].params.relativeSteps < 0 ? 1 : 0,
          }],
        };
        return { payload };
      }
      case ('action.devices.commands.selectChannel'): {
	let c;
	if (command.execution[0].params?.channelCode) {
	  const code = command.execution[0].params.channelCode;
	  if (c = service.extras.channels.find(x => x.Name === code)) {
            const payload = {
              characteristics: [{
		aid: service.aid,
		iid: service.characteristics.find(x => x.type === Characteristic.ActiveIdentifier).iid,
		value: c.Identifier,
              }],
	    };
	    service.extras.channels.lastchannel = c.Identifier;
	    return { payload };
	  }
	} else if (command.execution[0].params?.channelNumber) {
	  const number = parseInt(command.execution[0].params.channelNumber) - 1;
	  if (c = service.extras.channels.find(x => x.Identifier === number)) {
            const payload = {
              characteristics: [{
		aid: service.aid,
		iid: service.characteristics.find(x => x.type === Characteristic.ActiveIdentifier).iid,
		value: c.Identifier,
              }],
	    };
	    service.extras.channels.lastchannel = c.Identifier;
	    return { payload };
	  }
      //} else if (command.execution[0].params?.channelName) {
	}
	break;
      }
      case ('action.devices.commands.relativeChannel'): {
	const change = command.execution[0].params?.relativeChannelChange;
	const n = service.extras.channels.length;
	let c = service.extras.channels.lastchannel !== undefined ?
	    service.extras.channels.findIndex(x => x.Identifier === service.extras.channels.lastchannel) :
	    n - 1;
	// const d = service.characteristics.find(x => x.type === Characteristic.Name).value;
	// console.log(`Current channel index of ${d} is ${c}.`);
	if (change > 0) {
	  if (++c > n - 1)
	    c = 0;
	} else if (change < 0) {
	  if (--c < 0)
	    c = n - 1;
	}
	// console.log(`Updated channel index of ${d} to ${c}.`);
	c = service.extras.channels[c].Identifier;
	const payload = {
          characteristics: [{
	    aid: service.aid,
	    iid: service.characteristics.find(x => x.type === Characteristic.ActiveIdentifier).iid,
	    value: c,
          }],
	};
	service.extras.channels.lastchannel = c;
	return { payload };
      }
      case ('action.devices.returnChannel'): {
	let c = service.characteristics.find(x => x.type === Characteristic.ActiveIdentifier).value;
	c = service.extras.channels.lastchannel !== undefined ?
	  service.extras.channels.lastchannel :
	  service.extras.channels[0].Identifier;
	const payload = {
          characteristics: [{
	    aid: service.aid,
	    iid: service.characteristics.find(x => x.type === Characteristic.ActiveIdentifier).iid,
	    value: c,
          }],
	};
	service.extras.channels.lastchannel = c;
	return { payload };
      }
      case ('action.devices.commands.SetInput'): {
	const input = command.execution[0].params?.newInput;
	let c;
	if (c = service.extras.inputs.find(x => x.Name === input)) {
	  const payload = {
            characteristics: [{
	      aid: service.aid,
	      iid: service.characteristics.find(x => x.type === Characteristic.ActiveIdentifier).iid,
	      value: parseInt(c.Identifier),
            }],
	  };
	  const states = {
	    currentInput: c.Name,
	  }
	  return { payload, states };
	}
	break;
      }
      case ('action.devices.commands.NextInput'): {
	let c = service.characteristics.find(x => x.type === Characteristic.ActiveIdentifier).value;
	let n = service.extras.inputs.length;
	if (service.extras.channels.find(x => x.Identifier === c)) {
	  c = -1;
	} else {
	  c = service.extras.inputs.findIndex(x => x.Identifier === c);
	}
	// const d = service.characteristics.find(x => x.type === Characteristic.Name).value;
	// console.log(`Current input index of ${d} is ${c}.`);
	if (++c > n - 1) {
	  c = 0;
	}
	// console.log(`Updated input index of ${d} to ${c}.`);
	c = service.extras.inputs[c].Identifier;
	const payload = {
          characteristics: [{
	    aid: service.aid,
	    iid: service.characteristics.find(x => x.type === Characteristic.ActiveIdentifier).iid,
	    value: c,
          }],
	};
	const states = {
	  currentInput: service.extras.inputs.find(x => x.Identifier === c).Name,
	}
	return { payload, states };
      }
      case ('action.devices.commands.PreviousInput'): {
	let c = service.characteristics.find(x => x.type === Characteristic.ActiveIdentifier).value;
	let n = service.extras.inputs.length;
	if (service.extras.channels.find(x => x.Identifier === c)) {
	  c = -1;
	} else {
	  c = service.extras.inputs.findIndex(x => x.Identifier === c);
	}
	// const d = service.characteristics.find(x => x.type === Characteristic.Name).value;
	// console.log(`Current input index of ${d} is ${c}.`);
	if (--c < 0) {
	  c = n - 1;
	}
	// console.log(`Updated input index of ${d} to ${c}.`);
	c = service.extras.inputs[c].Identifier;
	const payload = {
          characteristics: [{
	    aid: service.aid,
	    iid: service.characteristics.find(x => x.type === Characteristic.ActiveIdentifier).iid,
	    value: c,
          }],
	};
	const states = {
	  currentInput: service.extras.inputs.find(x => x.Identifier === c).Name,
	}
	return { payload, states };
      }
      // Characteristic.RemoteKey.REWIND = 0;
      // Characteristic.RemoteKey.FAST_FORWARD = 1;
      // Characteristic.RemoteKey.NEXT_TRACK = 2;
      // Characteristic.RemoteKey.PREVIOUS_TRACK = 3;
      // Characteristic.RemoteKey.ARROW_UP = 4;
      // Characteristic.RemoteKey.ARROW_DOWN = 5;
      // Characteristic.RemoteKey.ARROW_LEFT = 6;
      // Characteristic.RemoteKey.ARROW_RIGHT = 7;
      // Characteristic.RemoteKey.SELECT = 8;
      // Characteristic.RemoteKey.BACK = 9;
      // Characteristic.RemoteKey.EXIT = 10;
      // Characteristic.RemoteKey.PLAY_PAUSE = 11;
      // Characteristic.RemoteKey.INFORMATION = 15;
      case ('action.devices.commands.mediaStop'): {
	const payload = {
          characteristics: [{
	    aid: service.aid,
	    iid: service.characteristics.find(x => x.type === Characteristic.RemoteKey).iid,
	    value: 9, // Characteristic.RemoteKey.BACK,
          }],
	};
	return { payload };
      }
      case ('action.devices.commands.mediaResume'): {
	const payload = {
          characteristics: [{
	    aid: service.aid,
	    iid: service.characteristics.find(x => x.type === Characteristic.RemoteKey).iid,
	    value: 8, // Characteristic.RemoteKey.SELECT,
          }],
	};
	return { payload };
      }
      case ('action.devices.commands.mediaPause'): {
	const payload = {
          characteristics: [{
	    aid: service.aid,
	    iid: service.characteristics.find(x => x.type === Characteristic.RemoteKey).iid,
	    value: 11, // Characteristic.RemoteKey.PLAY_PAUSE,
          }],
	};
	return { payload };
      }
      case ('action.devices.commands.mediaNext'): {
	const payload = {
          characteristics: [{
	    aid: service.aid,
	    iid: service.characteristics.find(x => x.type === Characteristic.RemoteKey).iid,
	    value: 7, // Characteristic.RemoteKey.ARROW_RIGHT,
          }],
	};
	return { payload };
      }
      case ('action.devices.commands.mediaPrevious'): {
	const payload = {
          characteristics: [{
	    aid: service.aid,
	    iid: service.characteristics.find(x => x.type === Characteristic.RemoteKey).iid,
	    value: 6, // Characteristic.RemoteKey.ARROW_LEFT,
          }],
	};
	return { payload };
      }
    }
    
    return { payload: null };
  }
}
