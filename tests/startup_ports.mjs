import {createStorageStartupProtocol} from '../shared/storage-startup-protocol.js';

// Test controls expose independent failure/owner scenarios. Production obtains
// this protocol port directly from its configured Storage V2 coordinator.
export function withStorageProtocol(controls){
  return {...controls,storageProtocol:createStorageStartupProtocol({
    ownership:{current:controls.storageOwnerCurrent||(()=>null),authenticated:controls.authenticatedOwner||(()=>null)},
    markers:{account:controls.verifyStorageV2AccountMarker||(async()=>false),local:controls.verifyLocalStorageEngine||(async()=>false)},
    account:{read:controls.readStorageProtocolState||(async()=>null),recoverAccount:controls.recoverFencedAccount||(async()=>false)},
  })};
}
