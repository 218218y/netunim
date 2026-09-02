import {assertValidCloudState} from '../state/validation.js';
import {normalizeSharedChecks} from '../domains/checks/model.js';
import {SHARED_CHECKS_DOC, SHARED_CHECKS_TABLE, SHARED_CHECKS_RPC} from '../state/constants.js';
import {CLOUD_WRITE_POLICY,contentionDelay,createOperationId,normalizeCloudError,runBusyCloudWriteWithPolicy} from '../shared/cloud-sync.js';

const FINANCE_DOC='main';
const FINANCE_TABLE='finance_sync_documents';
const FINANCE_RPC='save_finance_sync_document';
const FINANCE_LEASE_TTL_SECONDS=20*60;

function contentionBackoff(attempt=0){return new Promise(resolve=>setTimeout(resolve,contentionDelay(attempt)))}

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createCloudTransport({session, supaRest}){
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
  const q=`/rest/v1/kupa_documents?document_name=eq.${encodeURIComponent(session.cloudDocumentName)}&select=document_name,revision,state,updated_at`;
  const [docResult,financeResult]=await Promise.allSettled([supaRest(q,{method:'GET'}),readFinanceSyncDocument()]);
  if(docResult.status!=='fulfilled')throw docResult.reason;
  if(financeResult.status!=='fulfilled')throw financeResult.reason;
  const r=docResult.value,j=await r.json().catch(()=>null);
  if(!r.ok)throw new Error(j?.message||j?.hint||'קריאת הקופה מהענן נכשלה');
  const row=Array.isArray(j)&&j.length?j[0]:null;
  if(row){
    assertValidCloudState(row.state,'מסמך הקופה בענן');
    const rev=Number(row.revision);if(!Number.isSafeInteger(rev)||rev<1)throw new Error('Revision הקופה בענן אינו תקין. הסנכרון נעצר כדי למנוע דריסה.');
    if(financeResult.value){
      row.state=overlayFinanceState(row.state,financeResult.value);
      row.financeRevision=Number(financeResult.value.revision||0);
      row.financeUpdatedAt=financeResult.value.updated_at||null;
    }else{row.financeRevision=0;row.financeUpdatedAt=null}
  }
  return row;
}
async function rpcSaveFinanceSync(state,expectedRevision,operationId){
  const expected=Number(expectedRevision||0),op=String(operationId||'').trim();if(!Number.isSafeInteger(expected)||expected<0)throw new Error('Revision הסינכרון הפיננסי אינו תקין');if(!op)throw new Error('מזהה פעולת הסינכרון הפיננסי חסר');
  const r=await supaRest(`/rest/v1/rpc/${FINANCE_RPC}_v3`,{method:'POST',networkRetry:true,dataPriority:'high',body:JSON.stringify({p_document_name:FINANCE_DOC,p_expected_revision:expected,p_state:state,p_operation_id:op})});
  const body=await r.text();let j;try{j=body?JSON.parse(body):null}catch{j=null}return {r,j,body,row:Array.isArray(j)?j[0]:j};
}
function financeLeaseName(value){const name=String(value||'').trim();if(name!=='bank'&&name!=='credit')throw new Error('סוג נעילת הסינכרון הפיננסי אינו תקין');return name}
async function claimFinanceSyncLease(leaseName,leaseToken,{ttlSeconds=FINANCE_LEASE_TTL_SECONDS}={}){
  const name=financeLeaseName(leaseName),token=String(leaseToken||'').trim(),ttl=Math.max(60,Math.min(1800,Math.trunc(Number(ttlSeconds)||FINANCE_LEASE_TTL_SECONDS)));
  if(!token)throw new Error('מזהה נעילת הסינכרון הפיננסי חסר');
  let r;try{r=await supaRest('/rest/v1/rpc/claim_finance_sync_lease',{method:'POST',body:JSON.stringify({p_lease_name:name,p_lease_token:token,p_ttl_seconds:ttl}),networkRetry:true})}catch(error){if(String(error?.code||'').startsWith('SUPABASE_NETWORK_')){const e=new Error('לא ניתן לקבל כרגע נעילת סינכרון מהענן. לא נפתחה כניסה לבנק או לחברת האשראי כדי למנוע סינכרון כפול ממחשב אחר.');e.code='FINANCE_LEASE_CLOUD_UNAVAILABLE';e.cause=error;throw e}throw error}
  const body=await r.text();let j;try{j=body?JSON.parse(body):null}catch{j=null}
  if(!r.ok)throw new Error(j?.message||j?.hint||body||'תפיסת נעילת הסינכרון המשותפת נכשלה');
  const row=Array.isArray(j)?j[0]:j;return {acquired:row?.acquired===true,leasedUntil:row?.leased_until||null};
}
async function releaseFinanceSyncLease(leaseName,leaseToken){
  const name=financeLeaseName(leaseName),token=String(leaseToken||'').trim();if(!token)return false;
  const r=await supaRest('/rest/v1/rpc/release_finance_sync_lease',{method:'POST',body:JSON.stringify({p_lease_name:name,p_lease_token:token}),networkRetry:true});
  const body=await r.text();let j;try{j=body?JSON.parse(body):null}catch{j=null}
  if(!r.ok)throw new Error(j?.message||j?.hint||body||'שחרור נעילת הסינכרון המשותפת נכשל');
  const value=Array.isArray(j)?j[0]:j;return value===true||value?.released===true;
}
async function saveFinancePatch(mutator){
  const operationId=createOperationId('finance');
  let row=await readFinanceSyncDocument();
  for(let conflictAttempt=0;conflictAttempt<CLOUD_WRITE_POLICY.conflictAttempts;conflictAttempt++){
    const base=row?.state&&typeof row.state==='object'?structuredClone(row.state):{},next=mutator(base);if(!next)return {saved:false,row};
    const res=await runBusyCloudWriteWithPolicy(()=>rpcSaveFinanceSync(next,Number(row?.revision||0),operationId));
    if(res?.r?.ok)return {saved:true,row:res.row};
    const error=normalizeCloudError(res);if(error.kind==='revision_conflict'){await contentionBackoff(conflictAttempt);row=await readFinanceSyncDocument();continue}
    throw new Error(res?.j?.message||res?.body||'שמירת הסינכרון הפיננסי נכשלה');
  }
  throw new Error('נתוני הסינכרון הפיננסי השתנו במקביל; לא נדרס שום נתון');
}
async function saveBankSyncSnapshot(bankState,snapshotToken,snapshotSeq){
  const seq=Number(snapshotSeq);if(!Number.isSafeInteger(seq)||seq<0)throw new Error('snapshotSeq של הבנק אינו תקין');
  const token=String(snapshotToken||'').trim();if(!token)throw new Error('snapshotToken של הבנק חסר');
  const r=await supaRest('/rest/v1/rpc/save_bank_sync_snapshot',{method:'POST',networkRetry:true,dataPriority:'high',body:JSON.stringify({p_document_name:FINANCE_DOC,p_bank_state:bankState,p_snapshot_token:token,p_snapshot_seq:seq})});
  const body=await r.text();let j;try{j=body?JSON.parse(body):null}catch{j=null}if(!r.ok)throw new Error(j?.message||j?.hint||body||'שמירת צילום הבנק האטומי נכשלה');return Array.isArray(j)?j[0]:j;
}
async function mergeBankTransactions(accountKey,accountRole,transactions){
  const occurrences=new Map(),payload=(Array.isArray(transactions)?transactions:[]).map(tx=>{const day=String(tx.date||'').slice(0,10),serial=String(tx.bankSerial||''),reference=String(tx.bankReference||''),signature=`${day}|${String(tx.processedDate||'').slice(0,10)}|${tx.amount}|${tx.description||''}|${tx.memo||''}|${JSON.stringify(tx.checkDetails||null)}`,occ=(occurrences.get(signature)||0)+1;occurrences.set(signature,occ);const stableKey=serial&&serial!=='0'&&day?`serial:${day}:${serial}:${tx.amount}`:reference&&day?`ref:${day}:${reference}:${tx.amount}:${tx.description||''}:${tx.memo||''}`:`fallback:${signature}:${occ}`;return {...tx,mergeKey:String(tx.mergeKey||stableKey)}});
  const r=await supaRest('/rest/v1/rpc/merge_bank_transactions',{method:'POST',networkRetry:true,dataPriority:'high',body:JSON.stringify({p_account_key:String(accountKey||''),p_account_role:accountRole==='home'?'home':'business',p_transactions:payload})});
  const body=await r.text();let j;try{j=body?JSON.parse(body):null}catch{j=null}if(!r.ok)throw new Error(j?.message||body||'מיזוג תנועות הבנק נכשל');const result=Array.isArray(j)?j[0]:j;return {result,sourcePayload:payload};
}
async function readBankTransactions(accountKey,accountRole,{days=370,maxRows=20000}={}){
  const since=new Date(Date.now()-Math.max(1,Number(days)||370)*86400000).toISOString(),pageSize=1000,cap=Math.max(pageSize,Number(maxRows)||20000),rows=[];
  for(let offset=0;offset<cap;offset+=pageSize){
    const q=`/rest/v1/bank_transactions?account_key=eq.${encodeURIComponent(accountKey)}&account_role=eq.${accountRole==='home'?'home':'business'}&transaction_date=gte.${encodeURIComponent(since)}&select=merge_key,transaction_date,processed_date,amount,currency,description,memo,party_name,party_headline,message_headline,message_detail,status,balance_after,bank_reference,bank_serial,activity_type_code,cheque,check_details&order=transaction_date.desc,id.desc&limit=${pageSize}&offset=${offset}`;
    const r=await supaRest(q,{method:'GET'}),j=await r.json().catch(()=>null);if(!r.ok)throw new Error(j?.message||'קריאת ארכיון הבנק נכשלה');
    const page=Array.isArray(j)?j:[];rows.push(...page);if(page.length<pageSize)return rows.map(x=>({id:x.merge_key,date:x.transaction_date,processedDate:x.processed_date,amount:Number(x.amount),currency:x.currency,description:x.description,memo:x.memo,partyName:x.party_name,partyHeadline:x.party_headline,messageHeadline:x.message_headline,messageDetail:x.message_detail,status:x.status,balanceAfter:x.balance_after===null?null:Number(x.balance_after),bankReference:x.bank_reference,bankSerial:x.bank_serial,activityTypeCode:x.activity_type_code,cheque:!!x.cheque,checkDetails:x.check_details}));
  }
  throw new Error('ארכיון הבנק גדול ממגבלת הקריאה הבטוחה; התצוגה נעצרה במקום להציג היסטוריה חלקית');
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
async function rpcSaveSharedChecks(checks,expectedRevision,operationId){const payload={version:1,checks:normalizeSharedChecks(checks)},expected=Number(expectedRevision||0),op=String(operationId||'').trim();if(!Number.isSafeInteger(expected)||expected<0)throw new Error('Revision הצקים המקומי אינו תקין');if(!op)throw new Error('מזהה פעולת הצקים חסר');const r=await supaRest(`/rest/v1/rpc/${SHARED_CHECKS_RPC}_v3`,{method:'POST',networkRetry:true,dataPriority:'high',body:JSON.stringify({p_document_name:SHARED_CHECKS_DOC,p_expected_revision:expected,p_state:payload,p_operation_id:op})});const body=await r.text();let j;try{j=body?JSON.parse(body):null}catch(e){j=null}return {r,j,body,row:Array.isArray(j)?j[0]:j}}
return {readSupabaseDocument,readSharedChecksDocument,readSharedChecksMeta,rpcSaveSharedChecks,readFinanceSyncDocument,rpcSaveFinanceSync,saveFinancePatch,claimFinanceSyncLease,releaseFinanceSyncLease,saveBankSyncSnapshot,mergeBankTransactions,readBankTransactions};
}
