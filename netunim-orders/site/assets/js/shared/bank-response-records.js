// @ts-check
import {evidenceObject as object,evidenceInteger as integer,evidenceText as text,
  evidenceTimestamp as timestamp,evidenceDate as date,evidenceMoney as money,evidenceRows} from './response-evidence.js';

function invalid(){
  return Object.assign(new Error('לא התקבל אישור תקין מנתוני הבנק. יש לרענן מהענן לפני פעולה נוספת.'),{
    code:'BANK_RESPONSE_EVIDENCE_INVALID',kind:'confirmation_unknown',retryable:false,
  });
}
/** @param {unknown} value @returns {value is number} */
function id(value){return integer(value)&&value>0}
/** @param {unknown} value */
function nullableTimestamp(value){return value===null||timestamp(value)}
/** @param {unknown} response */
function receipt(response){
  const rows=evidenceRows(response,invalid);
  const row=rows[0];
  if(rows.length!==1||!row)throw invalid();
  return row;
}
/** Reconciliation success can permit publication even for an empty source.
 * Its counts and complete-snapshot flags therefore require their own evidence.
 * @param {unknown} response @param {boolean} complete */
export function readBankArchiveSyncReceipt(response,complete){
  const row=receipt(response);
  for(const field of ['inserted_count','updated_count','total_count','missing_count','active_missing_count']){
    if(!integer(row[field]))throw invalid();
  }
  if(typeof row.snapshot_stored!=='boolean'||row.snapshot_stored!==complete||typeof row.baseline_created!=='boolean'||
    row.baseline_created&&!row.snapshot_stored||Number(row.missing_count)>Number(row.total_count)||
    Number(row.active_missing_count)>Number(row.missing_count))throw invalid();
  return Object.freeze({...row,
    inserted_count:Number(row.inserted_count),updated_count:Number(row.updated_count),total_count:Number(row.total_count),
    missing_count:Number(row.missing_count),active_missing_count:Number(row.active_missing_count),
    snapshot_stored:row.snapshot_stored,baseline_created:row.baseline_created,
  });
}
/** @param {unknown} response @param {number} transactionId @param {'missing'|'returned_cheque'} kind */
export function readBankAcknowledgementReceipt(response,transactionId,kind){
  const row=receipt(response);
  if(!id(transactionId)||row.transaction_id!==transactionId||!timestamp(row.acknowledged_at)||
    (kind!=='missing'&&kind!=='returned_cheque')||
    (kind==='returned_cheque'?row.alert_kind!==kind:Object.hasOwn(row,'alert_kind')))throw invalid();
  return Object.freeze({...row,transaction_id:transactionId,acknowledged_at:row.acknowledged_at});
}
/** @param {unknown} response @param {number} transactionId @param {boolean} handled */
export function readBankHandledReceipt(response,transactionId,handled){
  const row=receipt(response);
  if(!id(transactionId)||row.transaction_id!==transactionId||
    (handled? !timestamp(row.handled_at):row.handled_at!==null))throw invalid();
  return Object.freeze({transaction_id:transactionId,handled_at:handled?String(row.handled_at):null});
}
/** @param {Record<string,unknown>} row @param {string} accountKey @param {string} role */
function scope(row,accountKey,role){
  if(!text(accountKey)||!['business','home'].includes(role)||row.account_key!==accountKey||row.account_role!==role)throw invalid();
}
/** @param {unknown} response @param {string} accountKey @param {string} role @param {Set<number>} [seen] */
export function readBankArchiveRows(response,accountKey,role,seen=new Set()){
  const rows=evidenceRows(response,invalid);
  for(const row of rows){
    scope(row,accountKey,role);
    if(!id(row.id)||seen.has(row.id)||!text(row.merge_key)||!money(row.amount)||!text(row.currency)||
      !text(row.status)||typeof row.presence_state!=='string'||!['unknown','present','missing'].includes(row.presence_state)||
      !timestamp(row.first_seen_at)||!nullableTimestamp(row.transaction_date)||!nullableTimestamp(row.processed_date)||
      !nullableTimestamp(row.last_seen_at)||!nullableTimestamp(row.missing_since)||!nullableTimestamp(row.missing_acknowledged_at)||
      !object(row.alert_acknowledgements)||Object.values(row.alert_acknowledgements).some(at=>!timestamp(at))||
      typeof row.cheque!=='boolean'||!(row.balance_after===null||money(row.balance_after)))throw invalid();
    if(Object.hasOwn(row,'handled_at')&&!nullableTimestamp(row.handled_at))throw invalid();
    seen.add(row.id);
  }
  return structuredClone(rows);
}
/** @param {unknown} response @param {string} accountKey @param {string} role */
export function readBankSnapshotRows(response,accountKey,role){
  const rows=evidenceRows(response,invalid);
  if(rows.length>1)throw invalid();
  const row=rows[0];
  if(!row)return null;
  scope(row,accountKey,role);
  if(!timestamp(row.snapshot_at)||!date(row.coverage_from)||!date(row.coverage_to)||row.coverage_to<row.coverage_from||
    !integer(row.transaction_count)||!Array.isArray(row.transactions)||row.transaction_count!==row.transactions.length)throw invalid();
  const keys=new Set();
  for(const tx of row.transactions){
    if(!object(tx)||!text(tx.mergeKey)||keys.has(tx.mergeKey)||!money(tx.amount)||
      (tx.date!=null&&!timestamp(tx.date))||(tx.processedDate!=null&&!timestamp(tx.processedDate)))throw invalid();
    keys.add(tx.mergeKey);
  }
  return structuredClone(row);
}
/** The RPC scopes links by owner/account in SQL; its output carries transaction identity, not account columns.
 * @param {unknown} response */
export function readBankMorningLinkRows(response){
  const rows=evidenceRows(response,invalid),seen=new Set();
  for(const row of rows){
    if(!id(row.transaction_id)||!id(row.link_id)||seen.has(row.link_id)||!text(row.operation_id)||!text(row.document_id)||
      !integer(row.document_type)||!money(row.document_amount)||!timestamp(row.verified_at))throw invalid();
    seen.add(row.link_id);
  }
  return structuredClone(rows);
}
