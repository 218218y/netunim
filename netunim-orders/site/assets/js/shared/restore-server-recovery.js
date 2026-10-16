// @ts-check
import {readRestoreGroupRows,readRestoreApplyReceipt} from './restore-response-records.js';
import {readCloudDocumentRows} from './cloud-read-records.js';

/** @typedef {Record<string,unknown>} Row */
/** @typedef {import('./storage-v2-restore.js').RestoreSource} Source */
/** @typedef {{loadServerPending:(owner:string)=>Promise<Row|null>,stageServerPending:(row:Row)=>Promise<unknown>,completeServerPending:(owner:string,id:string)=>Promise<unknown>}} ServerStore */
/**
 * A server-only group has no local restore payload. Persist its identity before
 * applying it, then read both authoritative heads and adopt them through the
 * existing paired boundary. An interrupted adoption is retried even after the
 * server's incomplete list stops naming this group.
 * @param {{appSite:'orders'|'kupa',owner:string,store:ServerStore,listRemote:()=>Promise<unknown>,
 * applyRemote:(id:string)=>Promise<unknown>,readHeads:()=>Promise<{main:unknown,shared:unknown}>,
 * readSource:()=>Promise<Source>,applyLocally:(group:Row,result:Row)=>Promise<unknown>,assertCurrent:()=>unknown}} ports
 */
export async function resumeServerRestoreGroups({appSite,owner,store,listRemote,applyRemote,readHeads,readSource,applyLocally,assertCurrent}){
  assertCurrent();
  const pending=await store.loadServerPending(owner);assertCurrent();
  const rows=readRestoreGroupRows(await listRemote());assertCurrent();
  if(pending&&pending.app_site!==appSite)throw new Error('restore_pending_app_mismatch');
  const selected=rows.filter(row=>row.app_site===appSite),queue=pending?
    [pending,...selected.filter(row=>row.restore_group_id!==pending.restore_group_id)]:selected;
  for(const row of queue){
    const id=String(row.restore_group_id),source=await readSource();assertCurrent();
    await store.stageServerPending({...row,owner});assertCurrent();
    const receipt=readRestoreApplyReceipt([await applyRemote(id)],id);assertCurrent();
    const heads=await readHeads();assertCurrent();
    const main=readCloudDocumentRows(heads.main===null?[]:[heads.main],'main');
    const shared=readCloudDocumentRows(heads.shared===null?[]:[heads.shared],'main');
    if(!main||!shared||main.revision<receipt.main_revision||
      receipt.checks_revision!==null&&shared.revision<receipt.checks_revision)throw new Error('restore_authoritative_heads_required');
    const group={restoreGroupId:id,v2Source:source,main:{state:main.state},checks:{state:shared.state}};
    await applyLocally(group,{...receipt,main_revision:main.revision,checks_revision:shared.revision});assertCurrent();
    await store.completeServerPending(owner,id);assertCurrent();
  }
  return queue.length>0;
}
