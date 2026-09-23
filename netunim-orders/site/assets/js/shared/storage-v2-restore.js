import {validateSharedChecksState} from './shared-checks-storage-v2.js';

export function captureStorageV2RestoreSource(mainCloud,sharedCloud){
  for(const cloud of [mainCloud,sharedCloud]){
    if(!cloud?.base||!Number.isSafeInteger(cloud.seq)||!Number.isSafeInteger(cloud.base.revision)||cloud.base.revision<0||cloud.pending||cloud.flight||cloud.control)throw new Error('storage_restore_v2_head_not_clean');
  }
  return {mainSeq:mainCloud.seq,mainRevision:mainCloud.base.revision,sharedSeq:sharedCloud.seq,sharedRevision:sharedCloud.base.revision};
}

// The remote restore group remains the cloud authority. This is its local
// counterpart: one durable intent joins the two independent V2 journals.
export async function applyStorageV2RestoreGroup({boundary,group,result={},target,sharedState}={}){
  if(!boundary||!group?.restoreGroupId||!group.v2Source||!target||!sharedState)throw new Error('storage_restore_v2_source_missing');
  validateSharedChecksState(sharedState);
  const source=group.v2Source;
  if(!Number.isSafeInteger(source.mainSeq)||source.mainSeq<0||!Number.isSafeInteger(source.sharedSeq)||source.sharedSeq<0||!Number.isSafeInteger(source.mainRevision)||source.mainRevision<0||!Number.isSafeInteger(source.sharedRevision)||source.sharedRevision<0)throw new Error('storage_restore_v2_source_invalid');
  if(result.main_revision==null||group.checks&&result.checks_revision==null)throw new Error('storage_restore_v2_receipt_missing');
  const mainRevision=Number(result.main_revision),sharedRevision=group.checks?Number(result.checks_revision):source.sharedRevision;
  if(!Number.isSafeInteger(mainRevision)||mainRevision<0||!Number.isSafeInteger(sharedRevision)||sharedRevision<0)throw new Error('storage_restore_v2_revision_invalid');
  await boundary.run({id:group.restoreGroupId,kind:'restore',
    main:{kind:'reset-cloud-head',revision:mainRevision,state:structuredClone(target),cloudState:structuredClone(group.main.state),expectedSeq:source.mainSeq,expectedBaseRevision:source.mainRevision,requireCleanCloud:true,options:{appMetadata:{revision:mainRevision,storageRole:'primary'}}},
    shared:{kind:'reset-cloud-head',revision:sharedRevision,state:structuredClone(sharedState),expectedSeq:source.sharedSeq,expectedBaseRevision:source.sharedRevision,requireCleanCloud:true}});
  return {mainRevision,sharedRevision};
}
