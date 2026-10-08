import {createStorageStartupProtocol} from '../shared/storage-startup-protocol.js';
import {createStorageStartupRecovery} from '../shared/storage-startup-recovery.js';

// Test controls expose independent failure/owner scenarios. Production obtains
// this protocol port directly from its configured Storage V2 coordinator.
export function withStorageProtocol(controls){
  const storageRecovery=createStorageStartupRecovery();
  storageRecovery.bind({
    main:{primary:async context=>context.localEngineActive||!controls.recoverBrowserV2State
      ?await controls.recoverLocalV2State?.():await controls.recoverBrowserV2State({startup:true,deferRender:true}),
      readOnly:controls.recoverReadOnlyV2State||(async()=>false)},
    shared:{primary:controls.recoverSharedChecksV2Primary||(async()=>false),readOnly:controls.recoverSharedChecksV2ReadOnly||(async()=>false)},
  });
  return {...controls,storageRecovery,storageProtocol:createStorageStartupProtocol({
    ownership:{current:controls.storageOwnerCurrent||(()=>null),authenticated:controls.authenticatedOwner||(()=>null)},
    markers:{account:controls.verifyStorageV2AccountMarker||(async()=>false),local:controls.verifyLocalStorageEngine||(async()=>false)},
    account:{read:controls.readStorageProtocolState||(async()=>null),recoverAccount:controls.recoverFencedAccount||(async()=>false)},
  })};
}
