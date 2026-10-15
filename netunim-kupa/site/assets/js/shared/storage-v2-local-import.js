// @ts-check
import {createOperationId,readCleanStorageHead,readStorageState} from './storage-operation.js';
/** @typedef {import('./storage-operation.js').BoundaryIntent} BoundaryIntent */
/** @param {unknown} cloud */
function cleanHead(cloud){
  const head=readCleanStorageHead(cloud,'storage_local_import_head_not_clean');
  return {expectedSeq:head.seq,expectedBaseRevision:head.revision,requireCleanCloud:/** @type {const} */(true)};
}
// A local file never supplies a cloud ACK. Both cloud cursors remain pending;
// local-only replacement requires both journals and no cloud flight/control.
/** @param {{boundary?:{run:(intent:BoundaryIntent)=>Promise<unknown>},mainCloud?:unknown,sharedCloud?:unknown,mainLocal?:unknown,sharedLocal?:unknown,mode?:'cloud'|'local-only',mainState?:unknown,sharedState?:unknown,id?:string}} [ports] */
export async function applyStorageV2LocalImport({boundary,mainCloud,sharedCloud,mainLocal,sharedLocal,mode='cloud',mainState,sharedState,id=createOperationId('storage-import')}={}){
  if(!boundary||!mainState||!sharedState)throw new Error('storage_local_import_configuration');
  const main=readStorageState(mainState),shared=readStorageState(sharedState);
  if(mode==='local-only'){
    for(const value of [mainCloud,sharedCloud])if(value!=null){const head=readStorageState(value);if(head.base||head.flight||head.control||head.pending)throw new Error('storage_local_import_local_head_invalid')}
    const mainHead=readStorageState(mainLocal),sharedHead=readStorageState(sharedLocal),a=mainHead.seq,b=sharedHead.seq;
    if(typeof a!=='number'||!Number.isSafeInteger(a)||a<0||typeof b!=='number'||!Number.isSafeInteger(b)||b<0)throw new Error('storage_local_import_local_head_invalid');
    return boundary.run({id,kind:'import',
      main:{kind:'replace-local-authoritative',state:structuredClone(main),expectedSeq:a},
      shared:{kind:'replace-local-authoritative',state:structuredClone(shared),expectedSeq:b}});
  }
  if(mode!=='cloud')throw new Error('storage_local_import_mode_invalid');
  return boundary.run({id,kind:'import',
    main:{kind:'replace-local-with-pending',state:structuredClone(main),...cleanHead(mainCloud)},
    shared:{kind:'replace-local-with-pending',state:structuredClone(shared),...cleanHead(sharedCloud)}});
}
