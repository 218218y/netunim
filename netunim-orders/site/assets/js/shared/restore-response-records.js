// @ts-check
import {evidenceRows,evidenceText,evidenceTimestamp,evidenceInteger} from './response-evidence.js';

const phases=['staged','main_pending','main_acked','checks_pending','checks_acked'];
/** @param {unknown} value @returns {value is string} */
export function restoreGroupIdentity(value){return typeof value==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value)}
function invalid(){return Object.assign(new Error('restore_response_evidence_invalid'),{code:'RESTORE_RESPONSE_EVIDENCE_INVALID',retryable:true})}
/** @param {unknown} value @returns {value is number} */
function revision(value){return evidenceInteger(value)&&value>0}
/** @param {unknown} response */
export function readRestoreGroupRows(response){
  const rows=evidenceRows(response,invalid),ids=new Set();
  for(const row of rows){
    if(!restoreGroupIdentity(row.restore_group_id)||ids.has(row.restore_group_id.toLowerCase())||
      (row.app_site!=='orders'&&row.app_site!=='kupa')||typeof row.phase!=='string'||!phases.includes(row.phase)||
      !evidenceTimestamp(row.created_at)||!evidenceTimestamp(row.updated_at)||Date.parse(row.updated_at)<Date.parse(row.created_at))throw invalid();
    ids.add(row.restore_group_id.toLowerCase());
  }
  return structuredClone(rows);
}
/** @param {unknown} response @param {string} requestedId */
function single(response,requestedId){
  const rows=evidenceRows(response,invalid),row=rows[0];
  if(rows.length!==1||!row||!restoreGroupIdentity(requestedId)||row.restore_group_id!==requestedId)throw invalid();
  return row;
}
/** Staging is idempotent and may return a group already completed by another client.
 * @param {unknown} response @param {string} requestedId */
export function readRestoreStageReceipt(response,requestedId){
  const row=single(response,requestedId);
  if(typeof row.phase!=='string'||![...phases,'completed'].includes(row.phase))throw invalid();
  return Object.freeze({...row,restore_group_id:requestedId});
}
/** @param {unknown} response @param {string} requestedId */
export function readRestoreApplyReceipt(response,requestedId){
  const row=single(response,requestedId);
  if(row.phase!=='completed'||!revision(row.main_revision)||!(row.checks_revision===null||revision(row.checks_revision)))throw invalid();
  return Object.freeze({...row,restore_group_id:requestedId,main_revision:row.main_revision,checks_revision:row.checks_revision});
}
/** @param {unknown} record @param {string} owner */
export function readServerRestorePending(record,owner){
  const row=readRestoreGroupRows([record])[0];
  if(!row||!evidenceText(owner)||row.owner!==owner)throw invalid();
  return {...row,owner};
}
