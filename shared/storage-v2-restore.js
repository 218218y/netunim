// @ts-check
import {readStorageState,readSharedChecksState,readCleanStorageHead,readStorageRestoreRevision} from './storage-operation.js';
/** @typedef {import('./storage-operation.js').BoundaryIntent} BoundaryIntent */
/** @typedef {{mainSeq:number,mainRevision:number,sharedSeq:number,sharedRevision:number}} RestoreSource */
/** @param {unknown} mainCloud @param {unknown} sharedCloud @returns {RestoreSource} */
export function captureStorageV2RestoreSource(mainCloud,sharedCloud){
  const main=readCleanStorageHead(mainCloud,'storage_restore_v2_head_not_clean');
  const shared=readCleanStorageHead(sharedCloud,'storage_restore_v2_head_not_clean');
  return {mainSeq:main.seq,mainRevision:main.revision,sharedSeq:shared.seq,sharedRevision:shared.revision};
}
/** @param {unknown} value @returns {RestoreSource} */
function readSource(value){
  const source=readStorageState(value);
  const {mainSeq,mainRevision,sharedSeq,sharedRevision}=source;
  for(const value of [mainSeq,mainRevision,sharedSeq,sharedRevision])if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw new Error('storage_restore_v2_source_invalid');
  if(typeof mainSeq!=='number'||typeof mainRevision!=='number'||typeof sharedSeq!=='number'||typeof sharedRevision!=='number')throw new Error('storage_restore_v2_source_invalid');
  return {mainSeq,mainRevision,sharedSeq,sharedRevision};
}
// Only validated remote revision evidence may reset the paired local heads.
/** @param {{boundary?:{run:(intent:BoundaryIntent)=>Promise<unknown>},group?:unknown,result?:unknown,target?:unknown,sharedState?:unknown}} [ports] */
export async function applyStorageV2RestoreGroup({boundary,group,result={},target,sharedState}={}){
  if(!boundary||!group||!target||!sharedState)throw new Error('storage_restore_v2_source_missing');
  const plan=readStorageState(group),source=readSource(plan.v2Source),receipt=readStorageState(result);
  if(typeof plan.restoreGroupId!=='string'||!plan.restoreGroupId.trim())throw new Error('storage_restore_v2_source_missing');
  const main=readStorageState(plan.main),cloudState=readStorageState(main.state),state=readStorageState(target),shared=readSharedChecksState(sharedState);
  const hasChecks=plan.checks!=null;
  if(hasChecks)readStorageState(plan.checks);
  if(receipt.main_revision==null||hasChecks&&receipt.checks_revision==null)throw new Error('storage_restore_v2_receipt_missing');
  if(receipt.ok===false||receipt.error)throw new Error('storage_restore_v2_receipt_invalid');
  const mainRevision=readStorageRestoreRevision(receipt.main_revision),sharedRevision=hasChecks?readStorageRestoreRevision(receipt.checks_revision):source.sharedRevision;
  if(mainRevision<source.mainRevision||sharedRevision<source.sharedRevision)throw new Error('storage_restore_v2_revision_invalid');
  await boundary.run({id:plan.restoreGroupId,kind:'restore',
    main:{kind:'reset-cloud-head',revision:mainRevision,state:structuredClone(state),cloudState:structuredClone(cloudState),expectedSeq:source.mainSeq,expectedBaseRevision:source.mainRevision,requireCleanCloud:true,options:{appMetadata:{revision:mainRevision,storageRole:'primary'}}},
    shared:{kind:'reset-cloud-head',revision:sharedRevision,state:structuredClone(shared),expectedSeq:source.sharedSeq,expectedBaseRevision:source.sharedRevision,requireCleanCloud:true}});
  return {mainRevision,sharedRevision};
}
