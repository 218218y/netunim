import {createOperationId} from './cloud-sync.js';

function cleanHead(cloud){
  if(!cloud?.base||!Number.isSafeInteger(cloud.seq)||!Number.isSafeInteger(cloud.base.revision)||cloud.base.ackSeq!==cloud.seq||cloud.pending||cloud.flight||cloud.control)throw new Error('storage_local_import_head_not_clean');
  return {expectedSeq:cloud.seq,expectedBaseRevision:cloud.base.revision,requireCleanCloud:true};
}

// A file import changes the local view and creates two ordinary V2 pending
// heads. It is not a cloud ACK and must retain both prior cloud revisions.
export async function applyStorageV2LocalImport({boundary,mainCloud,sharedCloud,mainState,sharedState,id=createOperationId('storage-import')}={}){
  if(!boundary||!mainState||!sharedState)throw new Error('storage_local_import_configuration');
  return boundary.run({id,kind:'import',
    main:{kind:'replace-local-with-pending',state:structuredClone(mainState),...cleanHead(mainCloud)},
    shared:{kind:'replace-local-with-pending',state:structuredClone(sharedState),...cleanHead(sharedCloud)},
  });
}
