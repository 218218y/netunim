import {createOperationId} from './cloud-sync.js';

function cleanHead(cloud){
  if(!cloud?.base||!Number.isSafeInteger(cloud.seq)||!Number.isSafeInteger(cloud.base.revision)||cloud.base.ackSeq!==cloud.seq||cloud.pending||cloud.flight||cloud.control)throw new Error('storage_local_import_head_not_clean');
  return {expectedSeq:cloud.seq,expectedBaseRevision:cloud.base.revision,requireCleanCloud:true};
}

// A file import is never a cloud ACK. Connected owners retain both cloud
// revisions and create pending heads; a local-only owner replaces both
// checkpoints without inventing cloud state.
export async function applyStorageV2LocalImport({boundary,mainCloud,sharedCloud,mainLocal,sharedLocal,mode='cloud',mainState,sharedState,id=createOperationId('storage-import')}={}){
  if(!boundary||!mainState||!sharedState)throw new Error('storage_local_import_configuration');
  if(mode==='local-only'){
    if(mainCloud?.base||sharedCloud?.base||!Number.isSafeInteger(mainLocal?.seq)||mainLocal.seq<0||!Number.isSafeInteger(sharedLocal?.seq)||sharedLocal.seq<0)throw new Error('storage_local_import_local_head_invalid');
    return boundary.run({id,kind:'import',
      main:{kind:'replace-local-authoritative',state:structuredClone(mainState),expectedSeq:mainLocal.seq},
      shared:{kind:'replace-local-authoritative',state:structuredClone(sharedState),expectedSeq:sharedLocal.seq},
    });
  }
  if(mode!=='cloud')throw new Error('storage_local_import_mode_invalid');
  return boundary.run({id,kind:'import',
    main:{kind:'replace-local-with-pending',state:structuredClone(mainState),...cleanHead(mainCloud)},
    shared:{kind:'replace-local-with-pending',state:structuredClone(sharedState),...cleanHead(sharedCloud)},
  });
}
