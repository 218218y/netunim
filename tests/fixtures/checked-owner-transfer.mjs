import {readStorageOwnerHandoff,createStorageV2OwnerTransfer} from '../../shared/storage-v2-owner-transfer.js';
/** @type {unknown} */ const external={phase:'target-active'};
export const handoff=readStorageOwnerHandoff(external,'orders');
// @ts-expect-error Unknown persisted data cannot grant owner authority.
external.targetProof.mainRevision;
// @ts-expect-error Evidence is a scalar revision, not a coercible wire value.
if(handoff.targetProof)handoff.targetProof.mainRevision='9';
// @ts-expect-error Every transfer requires explicit owner/target/view ports.
createStorageV2OwnerTransfer({app:'orders'});
/** @param {import('../../shared/storage-v2-owner-transfer.js').TransferOptions} ports */
export async function consumer(ports){
  const transfer=createStorageV2OwnerTransfer(ports);
  const result=await transfer.start({targetOwner:'B',intent:'account-switch'});
  // @ts-expect-error Unchecked replies cannot substitute a recovered target.
  result.mainRevision.toUpperCase();
}
