import {createSyncDocument as ordersSync} from '../netunim-orders/site/assets/js/sync/document.js';
import {createSyncDocument as kupaSync} from '../netunim-kupa/site/assets/js/sync/document.js';
import {createMainDocumentWrite} from '../netunim-kupa/site/assets/js/cloud/main-document-write.js';
import {beginMeasure} from '../netunim-kupa/site/assets/js/shared/runtime-performance.js';
import {assertValidCloudState} from '../netunim-kupa/site/assets/js/state/validation.js';
import {ordersDocumentPorts,kupaDocumentPorts} from './sync_document_fixture_ports.mjs';
import {createSyncDocument as composeOrders} from '../netunim-orders/site/assets/js/composition/main-sync.js';
import {createSyncDocument as composeKupa} from '../netunim-kupa/site/assets/js/composition/main-sync.js';

export function createOrdersSync(p){return ordersSync(ordersDocumentPorts(p))}
export function createKupaSync(p){
  const writer=createMainDocumentWrite({documentName:()=>p.session.cloudDocumentName,request:p.supaRest,validate:assertValidCloudState,beginMeasure});
  return kupaSync(kupaDocumentPorts(p,writer.rpcSaveCloudV2));
}

// Owners deliberately require their receiver: extracting an unbound method in
// the production composition must fail these integration fixtures.
function owner(ports){
  const result={};
  for(const [name,value] of Object.entries(ports))result[name]=typeof value==='function'?function(...args){if(this!==result)throw Error('unbound Main owner: '+name);return value(...args)}:value;
  return result;
}
export function createComposedSync(app,p){
  const writer=app==='kupa'?createMainDocumentWrite({documentName:()=>p.session.cloudDocumentName,request:p.supaRest,validate:assertValidCloudState,beginMeasure}):null;
  const d=app==='orders'?ordersDocumentPorts(p):kupaDocumentPorts(p,writer.rpcSaveCloudV2);
  const shared={model:d.model,session:d.session,tab:d.tab,
    storage:owner({...d.journal,...d.checkpoint,...d.recovery,storageV2CloudOutboxActive:d.access.storageV2CloudOutboxActive}),
    transport:owner(d.transport),
    view:{status:owner(d.view),render:d.view.render,showSecondaryTabGuard:d.view.showSecondaryTabGuard},
    mirror:owner(d.mirror),
  };
  if(app==='orders')return composeOrders({...shared,
    ownership:owner({getScope:d.access.getCloudWriteScope,preparing:d.access.storageV2PreparationActive,enabled:d.access.cloudEnabled,cancelRecovery:d.recovery.cancelCloudRecovery}),
    state:{snapshots:owner({...d.projection,cloudHasLocalWork:d.access.cloudHasLocalWork}),merge:owner({merge3:d.projection.merge3})},
    secondary:{checks:owner({poll:d.secondary.pollSharedChecks}),finance:owner({refreshKupaReadout:d.secondary.refreshKupaReadout})},
  });
  return composeKupa({...shared,
    ownership:owner({getScope:d.access.getCloudWriteScope,preparing:d.access.storageV2PreparationActive,assertAccountOwner:d.access.assertAccountOwner,cancelRecovery:d.recovery.cancelCloudRecovery}),
    state:{normalization:owner(d.projection),merge:owner(d.projection),domainRevisions:d.projection.domainRevisions},
    secondary:{checks:{commands:owner({sync:d.secondary.syncSharedChecksFromCloud}),runtime:owner({poll:d.secondary.pollSharedChecks})},dashboard:owner({refreshOrdersSummary:d.secondary.refreshOrdersFinanceSummary})},
  });
}
