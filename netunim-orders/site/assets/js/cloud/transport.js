import {responseErrorText,firstResponseValue,jsonObjectProperty} from '../shared/response-evidence.js';
import {readBankArchiveCommand} from '../shared/bank-transaction-evidence.js';
import {readDocumentWriteResponseRow} from '../shared/document-write-ack.js';
import {readRestoreGroupRows,readRestoreStageReceipt,readRestoreApplyReceipt} from '../shared/restore-response-records.js';
import {readBankArchiveSyncReceipt,readBankAcknowledgementReceipt,readBankHandledReceipt,readBankArchiveRows,readBankSnapshotRows,readBankMorningLinkRows} from '../shared/bank-response-records.js';
import {readCloudMetaRows,readCloudDocumentRows,readFinanceDocumentRows,readCloudBackupRows,readCloudBackupPointRows} from '../shared/cloud-read-records.js';
import {beginMeasure} from '../shared/runtime-performance.js';
import {readBankSnapshotReceipt} from '../shared/bank-snapshot-receipt.js';
import {financeFencePayload} from '../shared/finance-fence.js';
import {createFinanceLeaseTransport} from '../shared/finance-lease-transport.js';
import {assertValidOrderCloudState,validOrderCloudState} from '../state/validation.js';
import {normalizeSharedChecks} from '../shared/shared-checks-contract.js';
import {CLOUD_DOC, CLOUD_TABLE, CLOUD_RPC, SHARED_CHECKS_DOC, SHARED_CHECKS_TABLE, KUPA_READ_DOC, KUPA_READ_TABLE, SHARED_CHECKS_RPC} from '../state/constants.js';
import {restoreGroupRpcPayload} from '../shared/restore-groups.js';
import {assertEntityCollections} from '../shared/data-invariants.js';
const FINANCE_DOC='main',FINANCE_TABLE='finance_sync_documents',FINANCE_RPC='save_finance_sync_document',FINANCE_LEASE_TTL_SECONDS=20*60;

/** @typedef {import('../shared/cloud-transport-contracts.js').State} State */
/** @typedef {import('../shared/cloud-transport-contracts.js').FenceLease} FenceLease */
// Dependencies are supplied by the composition root; this module has no startup side effects.
/** @param {{supaFetch:import('../shared/cloud-transport-contracts.js').Request,localResetReadOnlyFetch?:import('../shared/cloud-transport-contracts.js').LocalResetRead}} ports */
export function createCloudTransport({supaFetch,localResetReadOnlyFetch}){
  const {claimFinanceSyncLease,releaseFinanceSyncLease}=createFinanceLeaseTransport({request:supaFetch,ttlSeconds:FINANCE_LEASE_TTL_SECONDS});
  /** @returns {Promise<import('../shared/cloud-read-records.js').CloudDocument|null>} */
  async function readCloud(){
    const r=await supaFetch(`/rest/v1/${CLOUD_TABLE}?document_name=eq.${encodeURIComponent(CLOUD_DOC)}&select=document_name,revision,state,updated_at`,{method:'GET'});
    const j=await r.json().catch(()=>null);
    if(!r.ok)throw new Error(responseErrorText(j)||'קריאת הענן נכשלה');
    const row=readCloudDocumentRows(j,CLOUD_DOC);
    if(row&&!validOrderCloudState(row.state))throw new Error('מסמך ניהול ההזמנות בענן עדיין אינו במבנה ה-cutover החדש. הסנכרון נעצר כדי למנוע מצב מפוצל.');
    return row
  }
  /** @param {unknown} resetSession */
  async function verifyLocalResetCloud(resetSession){
    if(typeof localResetReadOnlyFetch!=='function')throw new Error('local_reset_read_only_transport_unavailable');
    const mainPath=`/rest/v1/${CLOUD_TABLE}?document_name=eq.${encodeURIComponent(CLOUD_DOC)}&select=document_name,revision,state,updated_at`,
      sharedPath=`/rest/v1/${SHARED_CHECKS_TABLE}?document_name=eq.${encodeURIComponent(SHARED_CHECKS_DOC)}&select=document_name,revision,state,updated_at`;
    const [mainResponse,sharedResponse]=await Promise.all([localResetReadOnlyFetch(resetSession,mainPath),localResetReadOnlyFetch(resetSession,sharedPath)]),
      [mainJson,sharedJson]=await Promise.all([mainResponse.json().catch(()=>null),sharedResponse.json().catch(()=>null)]);
    if(!mainResponse.ok)throw new Error(responseErrorText(mainJson)||'קריאת הענן נכשלה');
    if(!sharedResponse.ok)throw new Error(responseErrorText(sharedJson)||"קריאת הצ'קים המשותפים מהענן נכשלה");
    const main=readCloudDocumentRows(mainJson,CLOUD_DOC),shared=readCloudDocumentRows(sharedJson,SHARED_CHECKS_DOC);
    if(main&&!validOrderCloudState(main.state))throw new Error('מסמך ניהול ההזמנות בענן עדיין אינו במבנה ה-cutover החדש.');
    if(shared){
      if(!shared.state||!Array.isArray(shared.state.checks)||!Array.isArray(shared.state.bankEvents))throw new Error("מסמך הצ'קים המשותף בענן במבנה לא תקין");
      const rev=Number(shared.revision);
      if(!Number.isSafeInteger(rev)||rev<1)throw new Error("Revision הצ'קים המשותף אינו תקין")
    }
    return {main,shared};
  }
  async function readStorageProtocolState(){
    const r=await supaFetch('/rest/v1/rpc/get_storage_protocol_state',{method:'POST',networkRetry:true,dataPriority:'high',body:'{}'});
    const state=await r.json().catch(()=>null);
    if(!r.ok)throw new Error(responseErrorText(state)||'בדיקת פרוטוקול האחסון בענן נכשלה');
    return state
  }
  /** @returns {Promise<import('../shared/cloud-read-records.js').CloudMeta|null>} */
  async function readCloudMeta(){
    const r=await supaFetch(`/rest/v1/${CLOUD_TABLE}?document_name=eq.${encodeURIComponent(CLOUD_DOC)}&select=document_name,revision,updated_at`,{method:'GET'});
    const j=await r.json().catch(()=>null);
    if(!r.ok)throw new Error(responseErrorText(j)||'קריאת סטטוס הענן נכשלה');
    return readCloudMetaRows(j,CLOUD_DOC)
  }
  /** @param {State} snapshot @param {number} expected @param {string} operationId @param {import('../shared/storage-records.js').StorageDeleteIntents} [deleteIntents] @param {State} [audit] */
  async function rpcSaveV2(snapshot,expected,operationId,deleteIntents={},audit={}){
    const ackDone=beginMeasure('orders:cloud-ack');
    assertValidOrderCloudState(snapshot,'Orders write');
    const op=String(operationId||'').trim();
    if(!op)throw new Error('מזהה פעולת השמירה חסר');
    const rpc=audit?.mutationType==='bulk-delete'?`bulk_delete_${CLOUD_RPC}_v6`:`${CLOUD_RPC}_v6`;
    const r=await supaFetch(`/rest/v1/rpc/${rpc}`,
      {
      method:'POST',
      networkRetry:true,
      dataPriority:'high',
      body:JSON.stringify({p_document_name:CLOUD_DOC,p_expected_revision:Number(expected||0),p_state:snapshot,p_operation_id:op,p_delete_intents:deleteIntents,p_audit:audit})
    });
    const txt=await r.text();
    /** @type {unknown} */ let j;
    try{
      j=txt?JSON.parse(txt):null
    }catch(e){
      j=null
    }
    if(r.ok)ackDone();
    return{r,j,txt,row:r.ok?readDocumentWriteResponseRow(j):firstResponseValue(j)}
  }
  /** @param {string} table @param {string} documentName @param {number} limit @param {number} [offset] */
  async function readBackupList(table,documentName,limit,offset=0){
    const safeLimit=Math.max(1,Math.min(20,Math.trunc(Number(limit)||8))),
      safeOffset=Math.max(0,Math.min(5000,Math.trunc(Number(offset)||0))),
      q=`/rest/v1/${table}?document_name=eq.${encodeURIComponent(documentName)}&select=id,revision,saved_at&order=saved_at.desc,id.desc&limit=${safeLimit}&offset=${safeOffset}`,
      r=await supaFetch(q,{method:'GET'}),
      j=await r.json().catch(()=>null);
    if(!r.ok)throw new Error(responseErrorText(j)||'קריאת רשימת גיבויי הענן נכשלה');
    return readCloudBackupRows(j)
  }
  /** @param {{limit?:number,rollingOffset?:number,periodicOffset?:number}} [options] */
  async function listOrdersCloudBackups({limit=8,rollingOffset=0,periodicOffset=0}={}){
    const [rolling,periodic]=await Promise.all([
      readBackupList('order_management_document_backups',CLOUD_DOC,limit,rollingOffset),
      readBackupList('order_management_periodic_backups',CLOUD_DOC,limit,periodicOffset)
    ]);
    return {rolling,periodic}
  }
  /** @param {string} table @param {string} documentName @param {unknown} id */
  async function readBackupState(table,documentName,id){
    const safeId=Number(id);
    if(!Number.isSafeInteger(safeId)||safeId<=0)throw new Error('מזהה הגיבוי אינו תקין');
    const q=`/rest/v1/${table}?id=eq.${safeId}&document_name=eq.${encodeURIComponent(documentName)}&select=id,revision,state,saved_at&limit=1`,r=await supaFetch(q,{method:'GET',dataPriority:'high'}),j=await r.json().catch(()=>null);
    if(!r.ok)throw new Error(responseErrorText(j)||'קריאת גיבוי הענן נכשלה');
    return readCloudBackupPointRows(j,safeId)
  }
  /** @param {string} savedAt */
  async function readChecksBackupAtOrBefore(savedAt){
    const at=String(savedAt||'').trim();
    if(!Number.isFinite(Date.parse(at)))throw new Error('זמן הגיבוי אינו תקין');
    const encoded=encodeURIComponent(at),query=(/** @type {string} */ table)=>`/rest/v1/${table}?document_name=eq.${encodeURIComponent(SHARED_CHECKS_DOC)}&saved_at=lte.${encoded}&select=id,revision,state,saved_at&order=saved_at.desc,id.desc&limit=1`;
    const [live,rollingResult,periodicResult]=await Promise.all([
      readSharedChecksCloud(),
      supaFetch(query('shared_checks_document_backups'),{method:'GET',dataPriority:'high'}),
      supaFetch(query('shared_checks_periodic_backups'),{method:'GET',dataPriority:'high'})
    ]);
    const parse=async(/** @type {import('../shared/cloud-transport-contracts.js').Response} */ result,/** @type {string} */ label)=>{
      const j=await result.json().catch(()=>null);
      if(!result.ok)throw new Error(responseErrorText(j)||`קריאת ${label} נכשלה`);
      return readCloudBackupPointRows(j,null,at)
    };
    const [rolling,periodic]=await Promise.all([parse(rollingResult,'גיבויי הצ׳קים'),parse(periodicResult,'גיבויי הצ׳קים התקופתיים')]),candidates=[];
    if(live&&Date.parse(live.updated_at||'')<=Date.parse(at))candidates.push({revision:live.revision,state:live.state,saved_at:live.updated_at,source:'live'});
    if(rolling)candidates.push({...rolling,source:'rolling'});
    if(periodic)candidates.push({...periodic,source:'periodic'});
    candidates.sort((a,b)=>Date.parse(b.saved_at||'')-Date.parse(a.saved_at||''));
    return candidates[0]||null
  }
  /** @param {string} source @param {unknown} id */
  async function readOrdersCloudBackupPoint(source,id){
    const kind=source==='periodic'?'periodic':'rolling',table=kind==='periodic'?'order_management_periodic_backups':'order_management_document_backups',row=await readBackupState(table,CLOUD_DOC,id);
    if(!row)throw new Error('הגיבוי המבוקש כבר אינו קיים בענן');
    if(!validOrderCloudState(row.state))throw new Error('גיבוי ניהול ההזמנות בענן אינו במבנה תקין');
    const checks=await readChecksBackupAtOrBefore(row.saved_at);
    if(checks&&(!checks.state||!Array.isArray(checks.state.checks)||!Array.isArray(checks.state.bankEvents)))throw new Error('צילום הצ׳קים של נקודת הגיבוי אינו תקין');
    return {
      source:kind,
      id:Number(row.id),
      revision:Number(row.revision),
      savedAt:row.saved_at,
      state:row.state,
      checksState:checks?.state||null,
      checksRevision:Number(checks?.revision||0),
      checksSavedAt:checks?.saved_at||null,
      checksSource:checks?.source||null
    }
  }
  /** @returns {Promise<import('../shared/cloud-read-records.js').CloudDocument|null>} */
  async function readSharedChecksCloud(){
    const r=await supaFetch(`/rest/v1/${SHARED_CHECKS_TABLE}?document_name=eq.${encodeURIComponent(SHARED_CHECKS_DOC)}&select=document_name,revision,state,updated_at`,{method:'GET',networkRetry:true});
    const j=await r.json().catch(()=>null);
    if(!r.ok)throw new Error(responseErrorText(j)||'קריאת הצ\'קים המשותפים מהענן נכשלה');
    const row=readCloudDocumentRows(j,SHARED_CHECKS_DOC);
    if(row){
      if(!row.state||!Array.isArray(row.state.checks)||!Array.isArray(row.state.bankEvents))throw new Error('מסמך הצ\'קים המשותף בענן במבנה לא תקין');
      const rev=Number(row.revision);
      if(!Number.isSafeInteger(rev)||rev<1)throw new Error('Revision הצ\'קים המשותף אינו תקין')
    }
    return row
  }
  /** @returns {Promise<import('../shared/cloud-read-records.js').CloudMeta|null>} */
  async function readSharedChecksCloudMeta(){
    const r=await supaFetch(`/rest/v1/${SHARED_CHECKS_TABLE}?document_name=eq.${encodeURIComponent(SHARED_CHECKS_DOC)}&select=document_name,revision,updated_at`,{method:'GET',networkRetry:true});
    const j=await r.json().catch(()=>null);
    if(!r.ok)throw new Error(responseErrorText(j)||'קריאת סטטוס הצ\'קים המשותפים נכשלה');
    return readCloudMetaRows(j,SHARED_CHECKS_DOC)
  }
  /** @param {import('../shared/cloud-transport-contracts.js').ReadScope} [options] @returns {Promise<import('../shared/cloud-read-records.js').CloudDocument|null>} */
  async function readFinanceSyncDocument({assertCurrent}={}){
    assertCurrent?.();
    const r=await supaFetch(`/rest/v1/${FINANCE_TABLE}?document_name=eq.${encodeURIComponent(FINANCE_DOC)}&select=document_name,revision,state,updated_at`,{method:'GET',...(assertCurrent?{assertRequestScope:assertCurrent}:{})});
    const j=await r.json().catch(()=>null);
    assertCurrent?.();
    if(!r.ok)throw new Error(responseErrorText(j)||'קריאת נתוני הסינכרון הפיננסי נכשלה');
    return readFinanceDocumentRows(j,FINANCE_DOC)
  }
  /** @param {import('../shared/cloud-transport-contracts.js').ReadScope} [options] */
  async function readFinanceSyncMeta({assertCurrent}={}){
    assertCurrent?.();
    const r=await supaFetch(`/rest/v1/${FINANCE_TABLE}?document_name=eq.${encodeURIComponent(FINANCE_DOC)}&select=document_name,revision,updated_at`,{method:'GET',...(assertCurrent?{assertRequestScope:assertCurrent}:{})});
    const j=await r.json().catch(()=>null);
    assertCurrent?.();
    if(!r.ok)throw new Error(responseErrorText(j)||'קריאת סטטוס הסינכרון הפיננסי נכשלה');
    return readCloudMetaRows(j,FINANCE_DOC)
  }
  /** @param {import('../shared/cloud-transport-contracts.js').ReadScope} [options] */
  async function readKupaReadOnlyCloud({assertCurrent}={}){
    assertCurrent?.();
    const [kr,finance]=await Promise.all([
      supaFetch(`/rest/v1/${KUPA_READ_TABLE}?document_name=eq.${encodeURIComponent(KUPA_READ_DOC)}&select=document_name,revision,state,updated_at`,{method:'GET',...(assertCurrent?{assertRequestScope:assertCurrent}:{})}),
      readFinanceSyncDocument(assertCurrent?{assertCurrent}:{})
    ]);
    assertCurrent?.();
    const j=await kr.json().catch(()=>null);
    assertCurrent?.();
    if(!kr.ok)throw new Error(responseErrorText(j)||'קריאת נתוני הקופה לחישוב נכשלה');
    const row=readCloudDocumentRows(j,KUPA_READ_DOC);
    if(row){
      row.financeRevision=Number(finance?.revision||0);
      row.financeUpdatedAt=finance?.updated_at||null;
      if(finance?.state){
        if(finance.state.bank&&typeof finance.state.bank==='object'&&!Array.isArray(finance.state.bank)){
          const kupaBank=row.state.bank&&typeof row.state.bank==='object'?row.state.bank:{},financeBank=structuredClone(finance.state.bank),adjustments=jsonObjectProperty(kupaBank,'adjustments');
          row.state.bank={
            ...kupaBank,
            ...financeBank,
            adjustments:Array.isArray(adjustments)?structuredClone(adjustments):[],
            snapshotToken:jsonObjectProperty(kupaBank,'snapshotToken')??null,
            snapshotSeq:jsonObjectProperty(kupaBank,'snapshotSeq')??null
          }
        }
        if(finance.state.creditSync)row.state.creditSync=structuredClone(finance.state.creditSync)
      }
    }
    return row
  }
  /** @param {State} state @param {number} expectedRevision @param {string} operationId @param {State} [audit] @param {FenceLease|null} [lease] */
  async function rpcSaveFinanceSync(state,expectedRevision,operationId,audit={},lease=null){
    const assertCurrent=lease?.assertCurrent;
    assertCurrent?.();
    const op=String(operationId||'').trim();
    if(!op)throw new Error('מזהה פעולת הסינכרון הפיננסי חסר');
    const r=await supaFetch(`/rest/v1/rpc/${FINANCE_RPC}_v6`,
      {
      method:'POST',
      networkRetry:true,
      ...(assertCurrent?{assertRequestScope:assertCurrent}:{}),
      dataPriority:'high',
      body:JSON.stringify({p_document_name:FINANCE_DOC,p_expected_revision:Number(expectedRevision||0),p_state:state,p_operation_id:op,p_audit:audit,...financeFencePayload(lease)})
    });
    const txt=await r.text();
    assertCurrent?.();
    /** @type {unknown} */ let j;
    try{
      j=txt?JSON.parse(txt):null
    }catch{
      j=null
    }
    return {r,j,txt,row:firstResponseValue(j)}
  }
  /** @param {State} bankState @param {string} snapshotToken @param {number} snapshotSeq @param {FenceLease|null} [lease] @returns {Promise<ReturnType<typeof readBankSnapshotReceipt>>} */
  async function saveBankSyncSnapshot(bankState,snapshotToken,snapshotSeq,lease=null){
    const assertCurrent=lease?.assertCurrent;
    assertCurrent?.();
    const seq=Number(snapshotSeq);
    if(!Number.isSafeInteger(seq)||seq<0)throw new Error('snapshotSeq של הבנק אינו תקין');
    const token=String(snapshotToken||'').trim();
    if(!token)throw new Error('snapshotToken של הבנק חסר');
    const r=await supaFetch('/rest/v1/rpc/save_bank_sync_snapshot_v6',
      {
      method:'POST',
      networkRetry:true,
      ...(assertCurrent?{assertRequestScope:assertCurrent}:{}),
      dataPriority:'high',
      body:JSON.stringify({p_document_name:FINANCE_DOC,p_bank_state:bankState,p_snapshot_token:token,p_snapshot_seq:seq,...financeFencePayload(lease)})
    });
    const body=await r.text();
    assertCurrent?.();
    /** @type {unknown} */ let j;
    try{
      j=body?JSON.parse(body):null
    }catch{
      j=null
    }
    if(!r.ok)throw new Error(responseErrorText(j,true)||body||'שמירת צילום הבנק האטומי נכשלה');
    return readBankSnapshotReceipt(j);
  }
  /** @param {unknown} accountKey @param {unknown} accountRole @param {unknown} transactions @param {import('../shared/cloud-transport-contracts.js').ArchiveOptions} [options] */
  async function syncBankTransactionsSnapshot(accountKey,accountRole,transactions,{snapshotAt,coverage=null,complete=false,lease=null}={}){
    const assertCurrent=lease?.assertCurrent;
    assertCurrent?.();
    const command=readBankArchiveCommand({accountKey,accountRole,transactions,snapshotAt,coverage,complete});
    const payload=command.p_transactions,isComplete=command.p_complete;
    const r=await supaFetch('/rest/v1/rpc/sync_bank_transactions_snapshot_v6',{
      method:'POST',
      networkRetry:true,
      ...(assertCurrent?{assertRequestScope:assertCurrent}:{}),
      dataPriority:'high',
      body:JSON.stringify({...command,...financeFencePayload(lease)})
    });
    const body=await r.text();
    assertCurrent?.();
    /** @type {unknown} */ let j;
    try{
      j=body?JSON.parse(body):null
    }catch{
      j=null
    }
    if(!r.ok)throw new Error(responseErrorText(j,true)||body||'שמירת צילום תנועות הבנק נכשלה');
    const result=readBankArchiveSyncReceipt(j,isComplete);
    return {result,sourcePayload:payload,complete:isComplete};
  }
  /** @param {unknown} accountKey @param {import('../shared/cloud-transport-contracts.js').ReadScope} [options] */
  async function readBankMorningDocumentLinks(accountKey,{assertCurrent}={}){
    assertCurrent?.();
    const r=await supaFetch('/rest/v1/rpc/list_bank_morning_document_links',{
      method:'POST',
      networkRetry:true,
      ...(assertCurrent?{assertRequestScope:assertCurrent}:{}),
      dataPriority:'high',
      body:JSON.stringify({p_account_key:String(accountKey||'')})
    }),
      body=await r.text();
    assertCurrent?.();
    /** @type {unknown} */ let j;
    try{
      j=body?JSON.parse(body):null
    }catch{
      j=null
    }
    if(!r.ok)throw new Error(responseErrorText(j,true)||body||'קריאת קישורי מסמכי Morning לתנועות הבנק נכשלה');
    const byTransaction=new Map();
    for(const raw of readBankMorningLinkRows(j)){
      const id=Number(raw?.transaction_id);
      if(!Number.isSafeInteger(id)||id<=0)continue;
      const rows=byTransaction.get(id)||[];
      rows.push({
        linkId:Number(raw?.link_id)||null,
        operationId:String(raw?.operation_id||''),
        documentId:String(raw?.document_id||''),
        documentNumber:String(raw?.document_number||''),
        documentType:Number(raw?.document_type)||0,
        documentAmount:Number(raw?.document_amount)||0,
        verifiedAt:raw?.verified_at||null
      });
      byTransaction.set(id,rows)
    }
    return byTransaction;
  }
  /** @param {unknown} accountKey @param {unknown} accountRole @param {import('../shared/cloud-transport-contracts.js').ListOptions} [options] */
  async function readBankTransactions(accountKey,accountRole,{days=370,maxRows=20000,assertCurrent}={}){
    assertCurrent?.();
    const role=accountRole==='home'?'home':'business',
      dayCount=days===null||days==='all'?null:Number(days),
      since=dayCount!==null&&Number.isFinite(dayCount)&&dayCount>0?new Date(Date.now()-dayCount*86400000).toISOString():'',
      dateClause=since?`&transaction_date=gte.${encodeURIComponent(since)}`:'',
      pageSize=1000,
      cap=Math.max(pageSize,Number(maxRows)||20000),
      rows=[],
      seen=new Set();
    let complete=false;
    for(let offset=0;offset<cap;offset+=pageSize){
      assertCurrent?.();
      const q=(`/rest/v1/bank_transactions?account_key=eq.${encodeURIComponent(String(accountKey))}&account_role=eq.${role}${dateClause}&select=id,account_key,account_role,merge_key,transaction_date,processed_date,amount,currency,description,memo,party_name,party_headline,message_headline,message_detail,status,` +
        `balance_after,bank_reference,bank_serial,activity_type_code,cheque,check_details,credit_settlement_details,first_seen_at,presence_state,last_seen_at,missing_since,` +
        `missing_acknowledged_at,alert_acknowledgements,handled_at&order=transaction_date.desc,id.desc&limit=${pageSize}&offset=${offset}`);
      const r=await supaFetch(q,{method:'GET',...(assertCurrent?{assertRequestScope:assertCurrent}:{})}),j=await r.json().catch(()=>null);
      assertCurrent?.();
      if(!r.ok)throw new Error(responseErrorText(j)||'קריאת ארכיון הבנק נכשלה');
      const page=readBankArchiveRows(j,String(accountKey),accountRole==='home'?'home':'business',seen);
      rows.push(...page);
      if(page.length<pageSize){
        complete=true;
        break
      }
    }
    if(!complete)throw new Error('ארכיון הבנק גדול ממגבלת הקריאה הבטוחה; התצוגה נעצרה במקום להציג היסטוריה חלקית');
    const links=role==='business'?await readBankMorningDocumentLinks(accountKey,assertCurrent?{assertCurrent}:{}):new Map();
    assertCurrent?.();
    return rows.map(x=>({
      archiveId:Number(x.id),
      id:x.merge_key,
      date:x.transaction_date,
      processedDate:x.processed_date,
      amount:Number(x.amount),
      currency:x.currency,
      description:x.description,
      memo:x.memo,
      partyName:x.party_name,
      partyHeadline:x.party_headline,
      messageHeadline:x.message_headline,
      messageDetail:x.message_detail,
      status:x.status,
      balanceAfter:x.balance_after===null?null:Number(x.balance_after),
      bankReference:x.bank_reference,
      bankSerial:x.bank_serial,
      activityTypeCode:x.activity_type_code,
      cheque:!!x.cheque,
      checkDetails:x.check_details,
      creditSettlementDetails:x.credit_settlement_details,
      firstSeenAt:x.first_seen_at,
      presenceState:x.presence_state||'unknown',
      lastSeenAt:x.last_seen_at,
      missingSince:x.missing_since,
      missingAcknowledgedAt:x.missing_acknowledged_at,
      alertAcknowledgements:x.alert_acknowledgements&&typeof x.alert_acknowledgements==='object'?x.alert_acknowledgements:{},
      handledAt:x.handled_at||null,
      documentLinks:links.get(Number(x.id))||[]
    }));
  }
  /** @param {import('../shared/cloud-transport-contracts.js').ReadScope} [options] */
  async function readKupaReadOnlyMeta({assertCurrent}={}){
    assertCurrent?.();
    const [kr,finance]=await Promise.all([
      supaFetch(`/rest/v1/${KUPA_READ_TABLE}?document_name=eq.${encodeURIComponent(KUPA_READ_DOC)}&select=document_name,revision,updated_at`,{method:'GET',...(assertCurrent?{assertRequestScope:assertCurrent}:{})}),
      readFinanceSyncMeta(assertCurrent?{assertCurrent}:{})
    ]);
    assertCurrent?.();
    const j=await kr.json().catch(()=>null);
    assertCurrent?.();
    if(!kr.ok)throw new Error(responseErrorText(j)||'קריאת סטטוס הקופה לחישוב נכשלה');
    const row=readCloudMetaRows(j,KUPA_READ_DOC);
    if(row){
      row.financeRevision=Number(finance?.revision||0);
      row.financeUpdatedAt=finance?.updated_at||null
    }
    return row
  }
  /** @param {State} state @param {number} expectedRevision @param {string} operationId @param {State} [audit] @param {import('../shared/cloud-transport-contracts.js').ReadScope} [options] */
  async function rpcSaveKupaDocument(state,expectedRevision,operationId,audit={},{assertCurrent}={}){
    assertCurrent?.();
    assertEntityCollections(state,['credits','cash','rights','notes','expenses','cards',...(state.notesSheet?['notesSheet.rows','notesSheet.columns']:[])],{required:true});
    const expected=Number(expectedRevision||0),op=String(operationId||'').trim();
    if(!Number.isSafeInteger(expected)||expected<0)throw new Error('Revision הקופה אינו תקין');
    if(!op)throw new Error('מזהה פעולת הקופה חסר');
    const r=await supaFetch('/rest/v1/rpc/save_kupa_document_v6',
      {
      method:'POST',
      networkRetry:true,
      ...(assertCurrent?{assertRequestScope:assertCurrent}:{}),
      dataPriority:'high',
      body:JSON.stringify({p_document_name:KUPA_READ_DOC,p_expected_revision:expected,p_state:state,p_operation_id:op,p_delete_intents:{},p_audit:audit})
    });
    const txt=await r.text();
    assertCurrent?.();
    /** @type {unknown} */ let j;
    try{
      j=txt?JSON.parse(txt):null
    }catch(e){
      j=null
    }
    return {r,j,txt,row:r.ok?readDocumentWriteResponseRow(j):firstResponseValue(j)}
  }
  /** @param {number} revision */
  async function refreshCheckBankMatches(revision){
    const response=await supaFetch('/rest/v1/rpc/refresh_check_bank_matches',{method:'POST',networkRetry:true,dataPriority:'high',body:JSON.stringify({p_expected_revision:revision})});
    const result=await response.json();
    if(!response.ok||!result||typeof result!=='object'||!('status' in result)||typeof result.status!=='string'||!['no_checks','no_bank_data','unchanged','checked','busy'].includes(result.status))throw new Error(responseErrorText(result)||'check_bank_refresh_failed');
    return result;
  }
  /** @param {unknown} checks @param {number} expectedRevision @param {string} operationId @param {string[]} [deletedCheckIds] @param {State} [audit] */
  async function rpcSaveSharedChecksV2(checks,expectedRevision,operationId,deletedCheckIds=[],audit={}){
    const payload={version:1,checks:normalizeSharedChecks(checks)},expected=Number(expectedRevision||0),op=String(operationId||'').trim();
    const deletedIds=[...new Set((Array.isArray(deletedCheckIds)?deletedCheckIds:[]).map(x=>String(x||'').trim()).filter(Boolean))].sort();
    if(!Number.isSafeInteger(expected)||expected<0)throw new Error('Revision הצ\'קים המקומי אינו תקין');
    if(!op)throw new Error('מזהה פעולת הצ\'קים חסר');
    const rpc=audit?.mutationType==='bulk-delete'?`bulk_delete_${SHARED_CHECKS_RPC}_v6`:`${SHARED_CHECKS_RPC}_v6`,
      r=await supaFetch(`/rest/v1/rpc/${rpc}`,
      {
      method:'POST',
      networkRetry:true,
      dataPriority:'high',
      body:JSON.stringify({p_document_name:SHARED_CHECKS_DOC,p_expected_revision:expected,p_state:payload,p_operation_id:op,p_deleted_check_ids:deletedIds,p_audit:audit})
    });
    const txt=await r.text();
    /** @type {unknown} */ let j;
    try{
      j=txt?JSON.parse(txt):null
    }catch(e){
      j=null
    }
    return {r,j,txt,row:r.ok?readDocumentWriteResponseRow(j):firstResponseValue(j)}
  }
  /** @param {string} name @param {object} body @param {import('../shared/cloud-transport-contracts.js').ReadScope} [options] */
  async function restoreRpc(name,body,{assertCurrent}={}){
    assertCurrent?.();
    const r=await supaFetch(`/rest/v1/rpc/${name}`,{method:'POST',networkRetry:true,dataPriority:'high',...(assertCurrent?{assertRequestScope:assertCurrent}:{}),body:JSON.stringify(body)});
    const txt=await r.text();
    assertCurrent?.();
    /** @type {unknown} */ let j;
    try{
      j=txt?JSON.parse(txt):null
    }catch{
      j=null
    }
    if(!r.ok)throw new Error(responseErrorText(j,true)||txt||`restore rpc failed: ${name}`);
    return j
  }
  /** @param {import('../shared/restore-group-contracts.js').StoredRestoreGroup} group @param {import('../shared/cloud-transport-contracts.js').ReadScope} [options] @returns {Promise<ReturnType<typeof readRestoreStageReceipt>>} */
  async function stageRestoreGroup(group,options={}){
    const payload=restoreGroupRpcPayload(group);
    return readRestoreStageReceipt(await restoreRpc('stage_restore_group_v6',payload,options),payload.p_restore_group_id);
  }
  /** @param {string} restoreGroupId @param {import('../shared/cloud-transport-contracts.js').ReadScope} [options] @returns {Promise<ReturnType<typeof readRestoreApplyReceipt>>} */
  async function applyRestoreGroup(restoreGroupId,options={}){
    const id=String(restoreGroupId);
    return readRestoreApplyReceipt(await restoreRpc('apply_restore_group_v6',{p_restore_group_id:id},options),id);
  }
  /** @param {import('../shared/cloud-transport-contracts.js').ReadScope} [options] */
  async function listIncompleteRestoreGroups({assertCurrent}={}){
    assertCurrent?.();
    const r=await supaFetch('/rest/v1/rpc/list_incomplete_restore_groups_v5',{method:'POST',networkRetry:true,dataPriority:'high',...(assertCurrent?{assertRequestScope:assertCurrent}:{}),body:'{}'});
    const txt=await r.text();
    assertCurrent?.();
    /** @type {unknown} */ let j;
    try{
      j=txt?JSON.parse(txt):null
    }catch{
      j=null
    }
    if(!r.ok)throw new Error(responseErrorText(j)||txt||'restore group status failed');
    return readRestoreGroupRows(j)
  }
  /** @param {unknown} accountKey @param {unknown} accountRole @param {import('../shared/cloud-transport-contracts.js').ReadScope} [options] */
  async function readBankTransactionSnapshot(accountKey,accountRole,{assertCurrent}={}){
    assertCurrent?.();
    const q=`/rest/v1/bank_transaction_snapshots?account_key=eq.${encodeURIComponent(String(accountKey))}&account_role=eq.${accountRole==='home'?'home':'business'}&select=account_key,account_role,snapshot_at,coverage_from,coverage_to,transaction_count,transactions&limit=1`;
    const r=await supaFetch(q,{method:'GET',...(assertCurrent?{assertRequestScope:assertCurrent}:{})}),j=await r.json().catch(()=>null);
    assertCurrent?.();
    if(!r.ok)throw new Error(responseErrorText(j)||'קריאת צילום הבנק הישיר נכשלה');
    const row=readBankSnapshotRows(j,String(accountKey),accountRole==='home'?'home':'business');
    if(!row)return null;
    const transactions=row.transactions.map(tx=>({...tx,id:String(tx?.mergeKey||tx?.id||'')}));
    return {snapshotAt:row.snapshot_at,coverageFrom:row.coverage_from,coverageTo:row.coverage_to,transactionCount:row.transaction_count,transactions};
  }
  /** @param {string} transactionId @param {boolean} handled @param {import('../shared/cloud-transport-contracts.js').ReadScope} [options] @returns {Promise<ReturnType<typeof readBankHandledReceipt>>} */
  async function setBankTransactionHandled(transactionId,handled,{assertCurrent}={}){
    assertCurrent?.();
    const id=Number(transactionId);
    if(!Number.isSafeInteger(id)||id<=0)throw new Error('מזהה תנועת הבנק אינו תקין');
    const r=await supaFetch('/rest/v1/rpc/set_bank_transaction_handled',{
      method:'POST',
      networkRetry:true,
      ...(assertCurrent?{assertRequestScope:assertCurrent}:{}),
      dataPriority:'high',
      body:JSON.stringify({p_transaction_id:id,p_handled:handled===true})
    });
    const body=await r.text();
    assertCurrent?.();
    /** @type {unknown} */ let j;
    try{
      j=body?JSON.parse(body):null
    }catch{
      j=null
    }
    if(!r.ok){
      if(r.status===403)throw new Error('סימון התנועה דורש את עדכון מסד הנתונים bank_handled_rpc_security_fix. הפעולה לא נשמרה ולא נוצר שינוי ממתין.');
      throw new Error(responseErrorText(j,true)||body||'עדכון מצב תנועת הבנק נכשל')
    }
    return readBankHandledReceipt(j,id,handled===true);
  }
  /** @param {string} transactionId @param {import('../shared/cloud-transport-contracts.js').ReadScope} [options] @returns {Promise<ReturnType<typeof readBankAcknowledgementReceipt>>} */
  async function acknowledgeBankTransactionMissing(transactionId,{assertCurrent}={}){
    assertCurrent?.();
    const id=Number(transactionId);
    if(!Number.isSafeInteger(id)||id<=0)throw new Error('מזהה תנועת הבנק אינו תקין');
    const r=await supaFetch('/rest/v1/rpc/acknowledge_bank_transaction_missing',{method:'POST',networkRetry:true,...(assertCurrent?{assertRequestScope:assertCurrent}:{}),dataPriority:'high',body:JSON.stringify({p_transaction_id:id})});
    const body=await r.text();
    assertCurrent?.();
    /** @type {unknown} */ let j;
    try{
      j=body?JSON.parse(body):null
    }catch{
      j=null
    }
    if(!r.ok)throw new Error(responseErrorText(j,true)||body||'סימון תנועת הבנק כנבדקה נכשל');
    return readBankAcknowledgementReceipt(j,id,'missing');
  }
  /** @param {string} transactionId @param {string} alertKind @param {import('../shared/cloud-transport-contracts.js').ReadScope} [options] @returns {Promise<ReturnType<typeof readBankAcknowledgementReceipt>>} */
  async function acknowledgeBankTransactionAlert(transactionId,alertKind,{assertCurrent}={}){
    assertCurrent?.();
    const id=Number(transactionId),kind=String(alertKind||'').trim();
    if(!Number.isSafeInteger(id)||id<=0)throw new Error('מזהה תנועת הבנק אינו תקין');
    if(kind!=='returned_cheque')throw new Error('סוג התראת הבנק אינו נתמך');
    const r=await supaFetch('/rest/v1/rpc/acknowledge_bank_transaction_alert',{
      method:'POST',
      networkRetry:true,
      ...(assertCurrent?{assertRequestScope:assertCurrent}:{}),
      dataPriority:'high',
      body:JSON.stringify({p_transaction_id:id,p_alert_kind:kind})
    });
    const body=await r.text();
    assertCurrent?.();
    /** @type {unknown} */ let j;
    try{
      j=body?JSON.parse(body):null
    }catch{
      j=null
    }
    if(!r.ok)throw new Error(responseErrorText(j,true)||body||'הסרת התראת הבנק נכשלה');
    return readBankAcknowledgementReceipt(j,id,kind);
  }
  return {
    readCloud,
    readCloudMeta,
    verifyLocalResetCloud,
    readStorageProtocolState,
    rpcSaveV2,
    readSharedChecksCloud,
    readSharedChecksCloudMeta,
    readKupaReadOnlyCloud,
    readKupaReadOnlyMeta,
    rpcSaveKupaDocument,
    rpcSaveSharedChecksV2,refreshCheckBankMatches,
    stageRestoreGroup,
    applyRestoreGroup,
    listIncompleteRestoreGroups,
    listOrdersCloudBackups,
    readOrdersCloudBackupPoint,
    readFinanceSyncDocument,
    rpcSaveFinanceSync,
    claimFinanceSyncLease,
    releaseFinanceSyncLease,
    saveBankSyncSnapshot,
    syncBankTransactionsSnapshot,
    readBankTransactions,
    readBankTransactionSnapshot,
    setBankTransactionHandled,
    acknowledgeBankTransactionMissing,
    acknowledgeBankTransactionAlert
  };
}
