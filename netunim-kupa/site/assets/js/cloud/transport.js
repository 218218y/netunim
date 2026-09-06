import {financeFencePayload} from '../shared/finance-fence.js';
import {assertReadableCloudState} from '../state/validation.js';
import {normalizeSharedChecks} from '../domains/checks/model.js';
import {SHARED_CHECKS_DOC, SHARED_CHECKS_TABLE, SHARED_CHECKS_RPC} from '../state/constants.js';
import {CLOUD_WRITE_POLICY,contentionDelay,createOperationId,normalizeCloudError,operationAuditMetadata,runBusyCloudWriteWithPolicy} from '../shared/cloud-sync.js';
import {restoreGroupRpcPayload} from '../shared/restore-groups.js';

const FINANCE_DOC='main';
const FINANCE_TABLE='finance_sync_documents';
const ORDERS_DOC='suppliers';
const ORDERS_TABLE='order_management_documents';
const FINANCE_RPC='save_finance_sync_document';
const FINANCE_LEASE_TTL_SECONDS=20*60;

function sameCloudTimestamp(a,b){const x=String(a||''),y=String(b||'');return !!x&&!!y&&x===y}
function resolveKupaCoreUpdatedAt(row,financeUpdatedAt,financeAvailable=true){
  if(row?.core_updated_at)return row.core_updated_at;
  if(!financeAvailable)return null;
  if(sameCloudTimestamp(row?.updated_at,financeUpdatedAt))return null;
  return row?.updated_at||null;
}

function contentionBackoff(attempt=0){return new Promise(resolve=>setTimeout(resolve,contentionDelay(attempt)))}

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createCloudTransport({session, supaRest}){
async function readOrdersReadOnlyMeta(){
  const q=`/rest/v1/${ORDERS_TABLE}?document_name=eq.${encodeURIComponent(ORDERS_DOC)}&select=document_name,revision,updated_at`;
  const r=await supaRest(q,{method:'GET'}),j=await r.json().catch(()=>null);
  if(!r.ok)throw new Error(j?.message||j?.hint||'קריאת סטטוס ניהול ההזמנות נכשלה');
  return Array.isArray(j)&&j.length?j[0]:null;
}
async function readOrdersReadOnlyCloud(){
  const q=`/rest/v1/${ORDERS_TABLE}?document_name=eq.${encodeURIComponent(ORDERS_DOC)}&select=document_name,revision,state,updated_at`;
  const r=await supaRest(q,{method:'GET'}),j=await r.json().catch(()=>null);
  if(!r.ok)throw new Error(j?.message||j?.hint||'קריאת נתוני ניהול ההזמנות נכשלה');
  const row=Array.isArray(j)&&j.length?j[0]:null;
  if(row){const rev=Number(row.revision);if(!Number.isSafeInteger(rev)||rev<1||!row.state||typeof row.state!=='object')throw new Error('מסמך ניהול ההזמנות בענן אינו תקין')}
  return row;
}
async function readFinanceSyncDocument(){
  const q=`/rest/v1/${FINANCE_TABLE}?document_name=eq.${encodeURIComponent(FINANCE_DOC)}&select=document_name,revision,state,updated_at`;
  const r=await supaRest(q,{method:'GET'}),j=await r.json().catch(()=>null);
  if(!r.ok)throw new Error(j?.message||j?.hint||'קריאת נתוני הסינכרון הפיננסי נכשלה');
  return Array.isArray(j)&&j.length?j[0]:null;
}
function overlayFinanceState(base,finance){
  const out=structuredClone(base||{}),fs=finance?.state&&typeof finance.state==='object'?finance.state:{};
  if(fs.bank&&typeof fs.bank==='object'){const kupaBank=out.bank&&typeof out.bank==='object'?out.bank:{},financeBank=structuredClone(fs.bank);out.bank={...kupaBank,...financeBank,adjustments:Array.isArray(kupaBank.adjustments)?structuredClone(kupaBank.adjustments):[],snapshotToken:kupaBank.snapshotToken??null,snapshotSeq:kupaBank.snapshotSeq??null}};
  if(fs.creditSync&&typeof fs.creditSync==='object')out.creditSync=structuredClone(fs.creditSync);
  return out;
}
async function readSupabaseDocument(){
  const q=`/rest/v1/kupa_documents?document_name=eq.${encodeURIComponent(session.cloudDocumentName)}&select=*`;
  const [docResult,financeResult]=await Promise.allSettled([supaRest(q,{method:'GET'}),readFinanceSyncDocument()]);
  if(docResult.status!=='fulfilled')throw docResult.reason;
  const financeAvailable=financeResult.status==='fulfilled';
  if(!financeAvailable)console.warn('finance document read unavailable; Kupa core cloud read continues independently',financeResult.reason);
  const r=docResult.value,j=await r.json().catch(()=>null);
  if(!r.ok)throw new Error(j?.message||j?.hint||'קריאת הקופה מהענן נכשלה');
  const row=Array.isArray(j)&&j.length?j[0]:null;
  if(row){
    assertReadableCloudState(row.state,'מסמך הקופה בענן');
    const rev=Number(row.revision);if(!Number.isSafeInteger(rev)||rev<1)throw new Error('Revision הקופה בענן אינו תקין. הסנכרון נעצר כדי למנוע דריסה.');
    row.financeAvailable=financeAvailable;
    if(financeAvailable&&financeResult.value){
      row.state=overlayFinanceState(row.state,financeResult.value);
      row.financeRevision=Number(financeResult.value.revision||0);
      row.financeUpdatedAt=financeResult.value.updated_at||null;
    }else if(financeAvailable){row.financeRevision=0;row.financeUpdatedAt=null}
    else{row.financeRevision=Number(session.financeRevision||0);row.financeUpdatedAt=session.financeUpdatedAt||null}
    row.coreUpdatedAt=resolveKupaCoreUpdatedAt(row,row.financeUpdatedAt,financeAvailable);
  }
  return row;
}
async function rpcSaveFinanceSync(state,expectedRevision,operationId,audit={},lease=null){
  const expected=Number(expectedRevision||0),op=String(operationId||'').trim();if(!Number.isSafeInteger(expected)||expected<0)throw new Error('Revision הסינכרון הפיננסי אינו תקין');if(!op)throw new Error('מזהה פעולת הסינכרון הפיננסי חסר');
  const r=await supaRest(`/rest/v1/rpc/${FINANCE_RPC}_v5`,{method:'POST',networkRetry:true,dataPriority:'high',body:JSON.stringify({p_document_name:FINANCE_DOC,p_expected_revision:expected,p_state:state,p_operation_id:op,p_audit:audit,...financeFencePayload(lease)})});
  const body=await r.text();let j;try{j=body?JSON.parse(body):null}catch{j=null}return {r,j,body,row:Array.isArray(j)?j[0]:j};
}
function financeLeaseName(value){const name=String(value||'').trim();if(name!=='bank'&&name!=='credit')throw new Error('סוג נעילת הסינכרון הפיננסי אינו תקין');return name}
async function claimFinanceSyncLease(leaseName,leaseToken,{ttlSeconds=FINANCE_LEASE_TTL_SECONDS}={}){
  const name=financeLeaseName(leaseName),token=String(leaseToken||'').trim(),ttl=Math.max(60,Math.min(1800,Math.trunc(Number(ttlSeconds)||FINANCE_LEASE_TTL_SECONDS)));
  if(!token)throw new Error('מזהה נעילת הסינכרון הפיננסי חסר');
  let r;try{r=await supaRest('/rest/v1/rpc/claim_finance_sync_lease',{method:'POST',body:JSON.stringify({p_lease_name:name,p_lease_token:token,p_ttl_seconds:ttl}),networkRetry:true})}catch(error){if(String(error?.code||'').startsWith('SUPABASE_NETWORK_')){const e=new Error('לא ניתן לקבל כרגע נעילת סינכרון מהענן. לא נפתחה כניסה לבנק או לחברת האשראי כדי למנוע סינכרון כפול ממחשב אחר.');e.code='FINANCE_LEASE_CLOUD_UNAVAILABLE';e.cause=error;throw e}throw error}
  const body=await r.text();let j;try{j=body?JSON.parse(body):null}catch{j=null}
  if(!r.ok)throw new Error(j?.message||j?.hint||body||'תפיסת נעילת הסינכרון המשותפת נכשלה');
  const row=Array.isArray(j)?j[0]:j;return {acquired:row?.acquired===true,leasedUntil:row?.leased_until||null,leaseName:name,leaseToken:row?.lease_token||token,fenceEpoch:row?.fence_epoch??null};
}
async function releaseFinanceSyncLease(leaseName,leaseToken){
  const name=financeLeaseName(leaseName),token=String(leaseToken||'').trim();if(!token)return false;
  const r=await supaRest('/rest/v1/rpc/release_finance_sync_lease',{method:'POST',body:JSON.stringify({p_lease_name:name,p_lease_token:token}),networkRetry:true});
  const body=await r.text();let j;try{j=body?JSON.parse(body):null}catch{j=null}
  if(!r.ok)throw new Error(j?.message||j?.hint||body||'שחרור נעילת הסינכרון המשותפת נכשל');
  const value=Array.isArray(j)?j[0]:j;return value===true||value?.released===true;
}
async function saveFinancePatch(mutator,lease=null){
  if(!lease){const token=createOperationId('finance-manual'),held=await claimFinanceSyncLease('credit',token);if(!held.acquired)throw new Error('finance_sync_lease_busy');try{return await saveFinancePatch(mutator,held)}finally{await releaseFinanceSyncLease('credit',token)}}
  const operationId=createOperationId('finance');
  let row=await readFinanceSyncDocument();
  for(let conflictAttempt=0;conflictAttempt<CLOUD_WRITE_POLICY.conflictAttempts;conflictAttempt++){
    const base=row?.state&&typeof row.state==='object'?structuredClone(row.state):{},next=mutator(base);if(!next)return {saved:false,row};
    const audit=operationAuditMetadata({site:'kupa',mutationType:'finance-update',surface:'kupa.finance.sync-document',baseRevision:Number(row?.revision||0),beforeState:base,afterState:next});
    const res=await runBusyCloudWriteWithPolicy(()=>rpcSaveFinanceSync(next,Number(row?.revision||0),operationId,audit,lease));
    if(res?.r?.ok)return {saved:true,row:res.row};
    const error=normalizeCloudError(res);if(error.kind==='revision_conflict'){await contentionBackoff(conflictAttempt);row=await readFinanceSyncDocument();continue}
    throw new Error(res?.j?.message||res?.body||'שמירת הסינכרון הפיננסי נכשלה');
  }
  throw new Error('נתוני הסינכרון הפיננסי השתנו במקביל; לא נדרס שום נתון');
}
async function saveBankSyncSnapshot(bankState,snapshotToken,snapshotSeq,lease=null){
  const seq=Number(snapshotSeq);if(!Number.isSafeInteger(seq)||seq<0)throw new Error('snapshotSeq של הבנק אינו תקין');
  const token=String(snapshotToken||'').trim();if(!token)throw new Error('snapshotToken של הבנק חסר');
  const r=await supaRest('/rest/v1/rpc/save_bank_sync_snapshot',{method:'POST',networkRetry:true,dataPriority:'high',body:JSON.stringify({p_document_name:FINANCE_DOC,p_bank_state:bankState,p_snapshot_token:token,p_snapshot_seq:seq,...financeFencePayload(lease)})});
  const body=await r.text();let j;try{j=body?JSON.parse(body):null}catch{j=null}if(!r.ok)throw new Error(j?.message||j?.hint||body||'שמירת צילום הבנק האטומי נכשלה');return Array.isArray(j)?j[0]:j;
}
function bankArchivePayload(transactions){
  const occurrences=new Map();
  return (Array.isArray(transactions)?transactions:[]).map(tx=>{
    const day=String(tx.date||'').slice(0,10),serial=String(tx.bankSerial||''),reference=String(tx.bankReference||''),signature=`${day}|${String(tx.processedDate||'').slice(0,10)}|${tx.amount}|${tx.description||''}|${tx.memo||''}|${JSON.stringify(tx.checkDetails||null)}`,occ=(occurrences.get(signature)||0)+1;
    occurrences.set(signature,occ);
    const stableKey=serial&&serial!=='0'&&day?`serial:${day}:${serial}:${tx.amount}`:reference&&day?`ref:${day}:${reference}:${tx.amount}:${tx.description||''}:${tx.memo||''}`:`fallback:${signature}:${occ}`;
    return {...tx,mergeKey:String(tx.mergeKey||stableKey)};
  });
}
async function mergeBankTransactions(accountKey,accountRole,transactions,lease=null){
  const payload=bankArchivePayload(transactions);
  const r=await supaRest('/rest/v1/rpc/merge_bank_transactions',{method:'POST',networkRetry:true,dataPriority:'high',body:JSON.stringify({p_account_key:String(accountKey||''),p_account_role:accountRole==='home'?'home':'business',p_transactions:payload,...financeFencePayload(lease)})});
  const body=await r.text();let j;try{j=body?JSON.parse(body):null}catch{j=null}if(!r.ok)throw new Error(j?.message||body||'מיזוג תנועות הבנק נכשל');const result=Array.isArray(j)?j[0]:j;return {result,sourcePayload:payload};
}
async function syncBankTransactionsSnapshot(accountKey,accountRole,transactions,{snapshotAt,coverage=null,complete=false,lease=null}={}){
  const payload=bankArchivePayload(transactions),when=String(snapshotAt||'').trim(),from=String(coverage?.from||'').slice(0,10),to=String(coverage?.to||'').slice(0,10),isComplete=complete===true&&coverage?.complete===true&&!coverage?.warning&&/^\d{4}-\d{2}-\d{2}$/.test(from)&&/^\d{4}-\d{2}-\d{2}$/.test(to);
  if(!when||!Number.isFinite(Date.parse(when)))throw new Error('זמן צילום תנועות הבנק אינו תקין');
  const r=await supaRest('/rest/v1/rpc/sync_bank_transactions_snapshot',{method:'POST',networkRetry:true,dataPriority:'high',body:JSON.stringify({p_account_key:String(accountKey||''),p_account_role:accountRole==='home'?'home':'business',p_transactions:payload,p_snapshot_at:new Date(when).toISOString(),p_coverage_from:isComplete?from:null,p_coverage_to:isComplete?to:null,p_complete:isComplete,...financeFencePayload(lease)})});
  const body=await r.text();let j;try{j=body?JSON.parse(body):null}catch{j=null}if(!r.ok)throw new Error(j?.message||j?.hint||body||'שמירת צילום תנועות הבנק נכשלה');const result=Array.isArray(j)?j[0]:j;return {result,sourcePayload:payload,complete:isComplete};
}
async function readBankTransactions(accountKey,accountRole,{days=370,maxRows=20000}={}){
  const dayCount=days===null||days==='all'?null:Number(days),since=Number.isFinite(dayCount)&&dayCount>0?new Date(Date.now()-dayCount*86400000).toISOString():'',dateClause=since?`&transaction_date=gte.${encodeURIComponent(since)}`:'',pageSize=1000,cap=Math.max(pageSize,Number(maxRows)||20000),rows=[];
  for(let offset=0;offset<cap;offset+=pageSize){
    const q=`/rest/v1/bank_transactions?account_key=eq.${encodeURIComponent(accountKey)}&account_role=eq.${accountRole==='home'?'home':'business'}${dateClause}&select=id,merge_key,transaction_date,processed_date,amount,currency,description,memo,party_name,party_headline,message_headline,message_detail,status,balance_after,bank_reference,bank_serial,activity_type_code,cheque,check_details,first_seen_at,presence_state,last_seen_at,missing_since,missing_acknowledged_at,alert_acknowledgements&order=transaction_date.desc,id.desc&limit=${pageSize}&offset=${offset}`;
    const r=await supaRest(q,{method:'GET'}),j=await r.json().catch(()=>null);if(!r.ok)throw new Error(j?.message||'קריאת ארכיון הבנק נכשלה');
    const page=Array.isArray(j)?j:[];rows.push(...page);if(page.length<pageSize)return rows.map(x=>({archiveId:Number(x.id),id:x.merge_key,date:x.transaction_date,processedDate:x.processed_date,amount:Number(x.amount),currency:x.currency,description:x.description,memo:x.memo,partyName:x.party_name,partyHeadline:x.party_headline,messageHeadline:x.message_headline,messageDetail:x.message_detail,status:x.status,balanceAfter:x.balance_after===null?null:Number(x.balance_after),bankReference:x.bank_reference,bankSerial:x.bank_serial,activityTypeCode:x.activity_type_code,cheque:!!x.cheque,checkDetails:x.check_details,firstSeenAt:x.first_seen_at,presenceState:x.presence_state||'unknown',lastSeenAt:x.last_seen_at,missingSince:x.missing_since,missingAcknowledgedAt:x.missing_acknowledged_at,alertAcknowledgements:x.alert_acknowledgements&&typeof x.alert_acknowledgements==='object'?x.alert_acknowledgements:{}}));
  }
  throw new Error('ארכיון הבנק גדול ממגבלת הקריאה הבטוחה; התצוגה נעצרה במקום להציג היסטוריה חלקית');
}
async function readBankTransactionSnapshot(accountKey,accountRole){
  const q=`/rest/v1/bank_transaction_snapshots?account_key=eq.${encodeURIComponent(accountKey)}&account_role=eq.${accountRole==='home'?'home':'business'}&select=snapshot_at,coverage_from,coverage_to,transaction_count,transactions&limit=1`;
  const r=await supaRest(q,{method:'GET'}),j=await r.json().catch(()=>null);if(!r.ok)throw new Error(j?.message||'קריאת צילום הבנק הישיר נכשלה');const row=Array.isArray(j)&&j.length?j[0]:null;if(!row)return null;
  const transactions=(Array.isArray(row.transactions)?row.transactions:[]).map(tx=>({...tx,id:String(tx?.mergeKey||tx?.id||'')}));
  return {snapshotAt:row.snapshot_at,coverageFrom:row.coverage_from,coverageTo:row.coverage_to,transactionCount:Number(row.transaction_count)||transactions.length,transactions};
}
async function acknowledgeBankTransactionMissing(transactionId){
  const id=Number(transactionId);if(!Number.isSafeInteger(id)||id<=0)throw new Error('מזהה תנועת הבנק אינו תקין');
  const r=await supaRest('/rest/v1/rpc/acknowledge_bank_transaction_missing',{method:'POST',networkRetry:true,dataPriority:'high',body:JSON.stringify({p_transaction_id:id})});
  const body=await r.text();let j;try{j=body?JSON.parse(body):null}catch{j=null}if(!r.ok)throw new Error(j?.message||j?.hint||body||'סימון תנועת הבנק כנבדקה נכשל');return Array.isArray(j)?j[0]:j;
}
async function acknowledgeBankTransactionAlert(transactionId,alertKind){
  const id=Number(transactionId),kind=String(alertKind||'').trim();if(!Number.isSafeInteger(id)||id<=0)throw new Error('מזהה תנועת הבנק אינו תקין');if(kind!=='returned_cheque')throw new Error('סוג התראת הבנק אינו נתמך');
  const r=await supaRest('/rest/v1/rpc/acknowledge_bank_transaction_alert',{method:'POST',networkRetry:true,dataPriority:'high',body:JSON.stringify({p_transaction_id:id,p_alert_kind:kind})});
  const body=await r.text();let j;try{j=body?JSON.parse(body):null}catch{j=null}if(!r.ok)throw new Error(j?.message||j?.hint||body||'הסרת התראת הבנק נכשלה');return Array.isArray(j)?j[0]:j;
}


async function readBackupList(table,documentName,limit,offset=0){
  const safeLimit=Math.max(1,Math.min(20,Math.trunc(Number(limit)||8))),safeOffset=Math.max(0,Math.min(5000,Math.trunc(Number(offset)||0))),q=`/rest/v1/${table}?document_name=eq.${encodeURIComponent(documentName)}&select=id,revision,saved_at&order=saved_at.desc,id.desc&limit=${safeLimit}&offset=${safeOffset}`;
  const r=await supaRest(q,{method:'GET'}),j=await r.json().catch(()=>null);if(!r.ok)throw new Error(j?.message||'קריאת רשימת גיבויי הענן נכשלה');return Array.isArray(j)?j:[];
}
async function listKupaCloudBackups({limit=8,rollingOffset=0,periodicOffset=0}={}){
  const [rolling,periodic]=await Promise.all([readBackupList('kupa_document_backups',session.cloudDocumentName,limit,rollingOffset),readBackupList('kupa_periodic_backups',session.cloudDocumentName,limit,periodicOffset)]);return {rolling,periodic};
}
async function readBackupState(table,documentName,id){
  const safeId=Number(id);if(!Number.isSafeInteger(safeId)||safeId<=0)throw new Error('מזהה הגיבוי אינו תקין');
  const q=`/rest/v1/${table}?id=eq.${safeId}&document_name=eq.${encodeURIComponent(documentName)}&select=id,revision,state,saved_at&limit=1`,r=await supaRest(q,{method:'GET',dataPriority:'high'}),j=await r.json().catch(()=>null);if(!r.ok)throw new Error(j?.message||'קריאת גיבוי הענן נכשלה');return Array.isArray(j)&&j.length?j[0]:null;
}
async function readChecksBackupAtOrBefore(savedAt){
  const at=String(savedAt||'').trim();if(!Number.isFinite(Date.parse(at)))throw new Error('זמן הגיבוי אינו תקין');
  const encoded=encodeURIComponent(at),query=table=>`/rest/v1/${table}?document_name=eq.${encodeURIComponent(SHARED_CHECKS_DOC)}&saved_at=lte.${encoded}&select=id,revision,state,saved_at&order=saved_at.desc,id.desc&limit=1`;
  const [live,rollingResult,periodicResult]=await Promise.all([readSharedChecksDocument(),supaRest(query('shared_checks_document_backups'),{method:'GET',dataPriority:'high'}),supaRest(query('shared_checks_periodic_backups'),{method:'GET',dataPriority:'high'})]);
  const parse=async(result,label)=>{const j=await result.json().catch(()=>null);if(!result.ok)throw new Error(j?.message||`קריאת ${label} נכשלה`);return Array.isArray(j)&&j.length?j[0]:null};
  const [rolling,periodic]=await Promise.all([parse(rollingResult,'גיבויי הצ׳קים'),parse(periodicResult,'גיבויי הצ׳קים התקופתיים')]),candidates=[];
  if(live&&Date.parse(live.updated_at||'')<=Date.parse(at))candidates.push({revision:live.revision,state:live.state,saved_at:live.updated_at,source:'live'});
  if(rolling)candidates.push({...rolling,source:'rolling'});if(periodic)candidates.push({...periodic,source:'periodic'});
  candidates.sort((a,b)=>Date.parse(b.saved_at||'')-Date.parse(a.saved_at||''));return candidates[0]||null;
}
async function readKupaCloudBackupPoint(source,id){
  const kind=source==='periodic'?'periodic':'rolling',table=kind==='periodic'?'kupa_periodic_backups':'kupa_document_backups',row=await readBackupState(table,session.cloudDocumentName,id);if(!row)throw new Error('הגיבוי המבוקש כבר אינו קיים בענן');
  assertReadableCloudState(row.state,'גיבוי הקופה בענן');const checks=await readChecksBackupAtOrBefore(row.saved_at);if(checks&&(!checks.state||!Array.isArray(checks.state.checks)||!Array.isArray(checks.state.bankEvents)))throw new Error('צילום הצ׳קים של נקודת הגיבוי אינו תקין');
  return {source:kind,id:Number(row.id),revision:Number(row.revision),savedAt:row.saved_at,state:row.state,checksState:checks?.state||null,checksRevision:Number(checks?.revision||0),checksSavedAt:checks?.saved_at||null,checksSource:checks?.source||null};
}
async function readSharedChecksDocument(){
  const q=`/rest/v1/${SHARED_CHECKS_TABLE}?document_name=eq.${encodeURIComponent(SHARED_CHECKS_DOC)}&select=document_name,revision,state,updated_at`;
  const r=await supaRest(q,{method:'GET'}),j=await r.json().catch(()=>null);
  if(!r.ok)throw new Error(j?.message||j?.hint||'קריאת מאגר הצקים המשותף נכשלה');
  const row=Array.isArray(j)&&j.length?j[0]:null;
  if(row){if(!row.state||!Array.isArray(row.state.checks)||!Array.isArray(row.state.bankEvents))throw new Error('מסמך הצקים המשותף בענן במבנה לא תקין');const rev=Number(row.revision);if(!Number.isSafeInteger(rev)||rev<1)throw new Error('Revision הצקים המשותף אינו תקין')}
  return row
}
async function readSharedChecksMeta(){const q=`/rest/v1/${SHARED_CHECKS_TABLE}?document_name=eq.${encodeURIComponent(SHARED_CHECKS_DOC)}&select=document_name,revision,updated_at`;const r=await supaRest(q,{method:'GET'}),j=await r.json().catch(()=>null);if(!r.ok)throw new Error(j?.message||'קריאת סטטוס הצקים המשותפים נכשלה');return Array.isArray(j)&&j.length?j[0]:null}
async function rpcSaveSharedChecks(checks,expectedRevision,operationId,deletedCheckIds=[],audit={}){const payload={version:1,checks:normalizeSharedChecks(checks)},expected=Number(expectedRevision||0),op=String(operationId||'').trim();const deletedIds=[...new Set((Array.isArray(deletedCheckIds)?deletedCheckIds:[]).map(x=>String(x||'').trim()).filter(Boolean))].sort();if(!Number.isSafeInteger(expected)||expected<0)throw new Error('Revision הצקים המקומי אינו תקין');if(!op)throw new Error('מזהה פעולת הצקים חסר');const rpc=audit?.mutationType==='bulk-delete'?`bulk_delete_${SHARED_CHECKS_RPC}_v5`:`${SHARED_CHECKS_RPC}_v5`,r=await supaRest(`/rest/v1/rpc/${rpc}`,{method:'POST',networkRetry:true,dataPriority:'high',body:JSON.stringify({p_document_name:SHARED_CHECKS_DOC,p_expected_revision:expected,p_state:payload,p_operation_id:op,p_deleted_check_ids:deletedIds,p_audit:audit})});const body=await r.text();let j;try{j=body?JSON.parse(body):null}catch(e){j=null}return {r,j,body,row:Array.isArray(j)?j[0]:j}}
async function restoreRpc(name,body){const r=await supaRest(`/rest/v1/rpc/${name}`,{method:'POST',networkRetry:true,dataPriority:'high',body:JSON.stringify(body)}),raw=await r.text();let j;try{j=raw?JSON.parse(raw):null}catch{j=null}if(!r.ok)throw new Error(j?.message||j?.hint||raw||`restore rpc failed: ${name}`);return Array.isArray(j)?j[0]:j}
async function stageRestoreGroup(group){return restoreRpc('stage_restore_group_v5',restoreGroupRpcPayload(group))}
async function applyRestoreGroup(restoreGroupId){return restoreRpc('apply_restore_group_v5',{p_restore_group_id:String(restoreGroupId)})}
async function listIncompleteRestoreGroups(){const r=await supaRest('/rest/v1/rpc/list_incomplete_restore_groups_v5',{method:'POST',networkRetry:true,dataPriority:'high',body:'{}'}),raw=await r.text();let j;try{j=raw?JSON.parse(raw):null}catch{j=null}if(!r.ok)throw new Error(j?.message||raw||'restore group status failed');return Array.isArray(j)?j:[]}
return {readSupabaseDocument,readOrdersReadOnlyMeta,readOrdersReadOnlyCloud,readSharedChecksDocument,readSharedChecksMeta,rpcSaveSharedChecks,stageRestoreGroup,applyRestoreGroup,listIncompleteRestoreGroups,listKupaCloudBackups,readKupaCloudBackupPoint,readFinanceSyncDocument,rpcSaveFinanceSync,saveFinancePatch,claimFinanceSyncLease,releaseFinanceSyncLease,saveBankSyncSnapshot,mergeBankTransactions,syncBankTransactionsSnapshot,readBankTransactions,readBankTransactionSnapshot,acknowledgeBankTransactionMissing,acknowledgeBankTransactionAlert};
}
