import {normalizeSharedChecks} from '../domains/checks/model.js';
import {assertValidCloudState} from '../state/validation.js';
import {jsonEq} from './merge-records.js';
import {SUPA_AUTO_KEY, STORAGE_PREF_KEY} from '../state/constants.js';
import {CLOUD_WRITE_POLICY,contentionDelay,normalizeCloudError,runBusyCloudWriteWithPolicy} from '../shared/cloud-sync.js';

function revisionConflict(res){return !res?.r?.ok&&normalizeCloudError(res).kind==='revision_conflict'}
function saveBusy(res){return !res?.r?.ok&&normalizeCloudError(res).kind==='busy'}
function contentionBackoff(attempt=0){return new Promise(resolve=>setTimeout(resolve,contentionDelay(attempt)))}

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createSyncDocument({hideConnectScreen, reportError, model, session, checksSession, tab, prepareKupaCloudState, applyKupaCloudState, setSaveStatus, setConnectedStatus, setCloudHeaderStatus, persistImmediateBrowserSnapshot, loadSharedChecksBase, loadSharedChecksBankEvents, listBackups, backupSnapshotToComputer, saveState, syncSharedChecksFromCloud, render, getCloudPending, readSupabaseDocument, supaRest, loadCloudPendingSync, putCloudPending, clearCloudPending, mergeKupaCloudState3Way, rebaseNewerPending, lastSavedCloudState, showSecondaryTabGuard, stageCloudPendingLocal, toast, pollSharedChecks}){
function applyKupaCoreState(coreState,checks=model.state.checks,financeSource=model.state){
  const next=structuredClone(coreState&&typeof coreState==='object'?coreState:{}),finance=financeSource&&typeof financeSource==='object'?financeSource:{},coreBank=next.bank&&typeof next.bank==='object'?next.bank:{},financeBank=finance.bank&&typeof finance.bank==='object'?structuredClone(finance.bank):null;
  if(financeBank){
    delete financeBank.adjustments;delete financeBank.snapshotToken;delete financeBank.snapshotSeq;
    if(financeBank.source!=='hapoalim'){delete financeBank.currentBalance;delete financeBank.updatedAt;delete financeBank.asOfDate;delete financeBank.source;delete financeBank.sourceAccount}
    next.bank={...coreBank,...financeBank,adjustments:Array.isArray(coreBank.adjustments)?structuredClone(coreBank.adjustments):[],snapshotToken:coreBank.snapshotToken??null,snapshotSeq:coreBank.snapshotSeq??null};
  }
  if(finance.creditSync&&typeof finance.creditSync==='object')next.creditSync=structuredClone(finance.creditSync);
  return applyKupaCloudState(next,checks)
}
function applyFinanceOnlyRow(row){
  const localCloud=prepareKupaCloudState(model.state),remote=row?.state&&typeof row.state==='object'?row.state:{},localBank=localCloud.bank&&typeof localCloud.bank==='object'?localCloud.bank:{};
  if(remote.bank&&typeof remote.bank==='object')localCloud.bank={...localBank,...structuredClone(remote.bank),adjustments:Array.isArray(localBank.adjustments)?structuredClone(localBank.adjustments):[],snapshotToken:localBank.snapshotToken??null,snapshotSeq:localBank.snapshotSeq??null};
  if(remote.creditSync&&typeof remote.creditSync==='object')localCloud.creditSync=structuredClone(remote.creditSync);
  model.state=applyKupaCloudState(localCloud,normalizeSharedChecks(model.state.checks));
  session.financeRevision=Number(row?.financeRevision||0);session.financeUpdatedAt=row?.financeUpdatedAt||session.financeUpdatedAt||null;
  persistImmediateBrowserSnapshot(model.state,session.dbRevision);render();return model.state
}
async function applyCloudRow(row,{renderNow=true}={}){
  const localChecks=normalizeSharedChecks(model.state.checks);model.state=applyKupaCloudState(row.state,localChecks);const removed=model.lastNormalizeRemovedCredits;session.dbRevision=Number(row.revision||0);session.financeRevision=Number(row.financeRevision||0);session.financeUpdatedAt=row.financeUpdatedAt||session.financeUpdatedAt||null;session.connectionMode='supabase';session.backendReady=true;session.lastSavedSnapshot=JSON.stringify(prepareKupaCloudState(row.state));session.serverInfo={schemaVersion:6,lastSavedAt:row.updated_at||null,databaseFile:'Supabase',backups:await listBackups()};checksSession.sharedChecksBase=loadSharedChecksBase();checksSession.sharedChecksBankEvents=loadSharedChecksBankEvents();await syncSharedChecksFromCloud({quiet:true,required:true});persistImmediateBrowserSnapshot(model.state,session.dbRevision);await backupSnapshotToComputer(model.state,session.dbRevision);localStorage.setItem(STORAGE_PREF_KEY,'supabase');setConnectedStatus('Supabase מחובר');setSaveStatus('מסונכרן לענן','ok');setCloudHeaderStatus('synced','ענן: מסונכרן');session.cloudAuthNoDocument=false;localStorage.setItem(SUPA_AUTO_KEY,'1');hideConnectScreen();session.cloudConflictPending=false;if(renderNow)render();if(removed>0)setTimeout(()=>saveState(`נוקו אוטומטית ${removed} רשומות אשראי ישנות במסגרת ניקוי/מעבר למודל הסנכרון החדש`),0);startCloudPolling();return model.state
}

async function loadSupabaseState(){
  const row=await readSupabaseDocument();if(!row)throw new Error('עדיין לא קיימת קופה בענן. פתח את הקופה המקומית והעלה אותה לענן מתוך הגדרות.');
  const pending=await getCloudPending();
  if(pending){session.connectionMode='supabase';session.backendReady=true;hideConnectScreen();session.dbRevision=Number(row.revision||0);session.lastSavedSnapshot=JSON.stringify(prepareKupaCloudState(row.state));await reconcileCloudPending(row);return model.state}
  return applyCloudRow(row)
}

async function rpcSaveCloud(snapshot,expectedRevision){
  assertValidCloudState(snapshot,'הנתונים המקומיים');
  const expected=Number(expectedRevision||0);
  if(!Number.isSafeInteger(expected)||expected<0)throw new Error('Revision מקומי אינו תקין. השמירה לענן נעצרה.');
  const r=await supaRest('/rest/v1/rpc/save_kupa_document',{method:'POST',networkRetry:true,dataPriority:'high',body:JSON.stringify({p_document_name:session.cloudDocumentName,p_expected_revision:expected,p_state:snapshot})});
  const body=await r.text();let j;try{j=body?JSON.parse(body):null}catch(e){j=null}
  return {r,j,body,row:Array.isArray(j)?j[0]:j};
}

async function reconcileCloudPending(remoteRow=null){
  if(session.cloudSyncBusy||session.cloudWriteBusy)return false;session.cloudSyncBusy=true;
  try{
    let pending=await getCloudPending();if(!pending){session.cloudConflictPending=false;return false}
    model.state=applyKupaCoreState(pending.snapshot,model.state.checks);persistImmediateBrowserSnapshot(model.state,pending.baseRevision||session.dbRevision);
    if(pending.conflict){session.cloudConflictPending=true;setSaveStatus('התנגשות שמורה מקומית','error');setCloudHeaderStatus('conflict','ענן: התנגשות');render();return false}
    if(!navigator.onLine){session.cloudConflictPending=false;setSaveStatus(session.cloudDurabilityDegraded?'שמירה מקומית במצב מוגבל — נדרשת התאוששות':'אופליין — שינוי שמור מקומית וממתין',session.cloudDurabilityDegraded?'error':'saving');setCloudHeaderStatus(session.cloudDurabilityDegraded?'syncing':'offline',session.cloudDurabilityDegraded?'ענן: הגנה מקומית מופחתת':'ענן: אופליין');return false}
    let row=remoteRow||await readSupabaseDocument();if(!row)throw new Error('מסמך הענן לא נמצא');session.serverInfo.lastSavedAt=row.updated_at||session.serverInfo.lastSavedAt||null;
    for(let attempt=0;attempt<CLOUD_WRITE_POLICY.conflictAttempts;attempt++){
      pending=await getCloudPending();if(!pending)return true;if(pending.conflict){session.cloudConflictPending=true;return false}
      let candidate=prepareKupaCloudState(pending.snapshot),expected=Number(row.revision||0);
      if(Number(row.revision||0)!==Number(pending.baseRevision||0)){
        const merged=mergeKupaCloudState3Way(pending.baseState,pending.snapshot,row.state);
        if(merged.conflicts.length){const conflicted={...pending,conflict:true,savedAt:new Date().toISOString()};await putCloudPending(conflicted);session.cloudConflictPending=true;model.state=applyKupaCoreState(pending.snapshot,model.state.checks);session.dbRevision=Number(row.revision||0);session.lastSavedSnapshot=JSON.stringify(prepareKupaCloudState(row.state));persistImmediateBrowserSnapshot(model.state,session.dbRevision);setConnectedStatus('Supabase — נדרשת הכרעה');setSaveStatus('התנגשות שמורה מקומית','error');setCloudHeaderStatus('conflict','ענן: התנגשות');render();reportError('יש התנגשות אמיתית: אותה רשומה שונתה גם במחשב הזה וגם במקור אחר. השינוי המקומי נשמר ולא נדרס. ייצא גיבוי JSON ובדוק את הרשומה לפני המשך הסנכרון.');return false}
        candidate=merged.state
      }
      session.cloudWriteBusy=true;const res=await runBusyCloudWriteWithPolicy(()=>rpcSaveCloud(candidate,expected));session.cloudWriteBusy=false;
      if(!res.r.ok){const em=res.j?.message||res.body||'שמירה לענן נכשלה';if(saveBusy(res))throw new Error('save_busy');if(revisionConflict(res)){await contentionBackoff(attempt);row=await readSupabaseDocument();if(!row)throw new Error('מסמך הענן נעלם בזמן הסנכרון');session.serverInfo.lastSavedAt=row.updated_at||session.serverInfo.lastSavedAt||null;continue}throw new Error(em)}
      const completedGeneration=Number(pending.generation||0),newRev=Number(res.row?.revision||expected+1),authoritative=prepareKupaCloudState(res.row?.state||candidate);session.dbRevision=newRev;session.lastSavedSnapshot=JSON.stringify(authoritative);session.serverInfo.lastSavedAt=res.row?.updated_at||session.serverInfo.lastSavedAt||null;session.cloudConflictPending=false;
      const newer=await rebaseNewerPending(completedGeneration,authoritative,newRev);
      if(!newer){const cleared=await clearCloudPending(completedGeneration);if(!cleared){const newest=await getCloudPending();model.state=applyKupaCoreState(newest?.snapshot||authoritative,model.state.checks);setSaveStatus('השינוי אושר; ניקוי מקומי ממתין להתאוששות','error');setCloudHeaderStatus('syncing','ענן: התאוששות אחסון מקומי');return false}model.state=applyKupaCoreState(authoritative,model.state.checks);setSaveStatus('מסונכרן לענן','ok');setCloudHeaderStatus('synced','ענן: מסונכרן')}else{const newest=await getCloudPending();model.state=applyKupaCoreState(newest?.snapshot||model.state,model.state.checks);setSaveStatus(newest?.conflict?'התנגשות שמורה מקומית':'ממתין לשינוי הבא…',newest?.conflict?'error':'saving');setCloudHeaderStatus(newest?.conflict?'conflict':'syncing',newest?.conflict?'ענן: התנגשות':'ענן: מסנכרן…')}
      persistImmediateBrowserSnapshot(model.state,session.dbRevision);await backupSnapshotToComputer(model.state,session.dbRevision);render();if(newer&&!session.cloudConflictPending)setTimeout(cloudPoll,0);return !session.cloudConflictPending
    }
    throw new Error('הענן השתנה שוב ושוב בזמן הסנכרון; השינוי המקומי נשמר וינוסה שוב')
  }catch(e){session.cloudWriteBusy=false;console.error(e);session.cloudConflictPending=!!loadCloudPendingSync()?.conflict;setSaveStatus(session.cloudConflictPending?'התנגשות שמורה מקומית':navigator.onLine?'ממתין לסנכרון':'אופליין — שינוי שמור מקומית','saving');setCloudHeaderStatus(session.cloudConflictPending?'conflict':navigator.onLine?'syncing':'offline',session.cloudConflictPending?'ענן: התנגשות':navigator.onLine?'ענן: ממתין לסנכרון':'ענן: אופליין');return false}finally{session.cloudSyncBusy=false}
}

async function persistSupabaseState(snapshot,msg,generation=session.localGeneration){
  if(!tab.primaryTab){showSecondaryTabGuard();return false}
  let pending=await getCloudPending();
  if(pending&&Number(pending.generation||0)>=Number(generation||0))snapshot=prepareKupaCloudState(pending.snapshot);
  if(pending?.conflict||session.cloudConflictPending){stageCloudPendingLocal(snapshot,msg,pending?.baseRevision??session.dbRevision,pending?.baseState||lastSavedCloudState()||snapshot,Math.max(generation,Number(pending?.generation||0)),true);persistImmediateBrowserSnapshot(model.state,session.dbRevision);setSaveStatus('התנגשות שמורה מקומית','error');setCloudHeaderStatus('conflict','ענן: התנגשות');return false}
  stageCloudPendingLocal(snapshot,msg,session.dbRevision,lastSavedCloudState()||snapshot,generation,false);
  pending=await getCloudPending();
  if(!pending)throw new Error('kupa_outbox_persistence_failed');
  if(!navigator.onLine){session.cloudConflictPending=false;persistImmediateBrowserSnapshot(model.state,session.dbRevision);setSaveStatus(session.cloudDurabilityDegraded?'שמירה מקומית במצב מוגבל — נדרשת התאוששות':'אופליין — שינוי שמור מקומית וממתין',session.cloudDurabilityDegraded?'error':'saving');setCloudHeaderStatus(session.cloudDurabilityDegraded?'syncing':'offline',session.cloudDurabilityDegraded?'ענן: הגנה מקומית מופחתת':'ענן: אופליין');render();toast(session.cloudDurabilityDegraded?'IndexedDB אינו זמין; נשמר עותק תאימות מקומי ונדרשת התאוששות':'אין רשת — השינוי נשמר מקומית ויעלה אוטומטית בחיבור הבא');return false}
  if(session.cloudSyncBusy){setSaveStatus('ממתין למחזור סנכרון פעיל…','saving');setCloudHeaderStatus('syncing','ענן: ממתין לסנכרון');return false}
  session.cloudSyncBusy=true;
  setSaveStatus('מסנכרן…','saving');setCloudHeaderStatus('syncing','ענן: מסנכרן…');
  try{
    let baseRevision=session.dbRevision,baseState=lastSavedCloudState()||pending.baseState||prepareKupaCloudState(snapshot),candidate=prepareKupaCloudState(snapshot),res=null;
    for(let attempt=0;attempt<CLOUD_WRITE_POLICY.conflictAttempts;attempt++){
      session.cloudWriteBusy=true;res=await runBusyCloudWriteWithPolicy(()=>rpcSaveCloud(candidate,baseRevision));session.cloudWriteBusy=false;
      if(res.r.ok)break;
      const em=res.j?.message||res.body||'שמירה לענן נכשלה';
      if(saveBusy(res))throw new Error('save_busy')
      if(!revisionConflict(res))throw new Error(em);
      await contentionBackoff(attempt);
      const remote=await readSupabaseDocument();if(!remote)throw new Error('מסמך הענן לא נמצא בזמן פתרון התנגשות');const merged=mergeKupaCloudState3Way(baseState,candidate,remote.state);
      if(merged.conflicts.length){stageCloudPendingLocal(snapshot,msg,pending.baseRevision,pending.baseState,generation,true);session.cloudConflictPending=true;setSaveStatus('התנגשות שמורה מקומית','error');setCloudHeaderStatus('conflict','ענן: התנגשות');reportError('הסנכרון נעצר: אותה רשומה שונתה במקביל בשני מקומות. השינוי המקומי נשמר ולא נדרס.');return false}
      candidate=merged.state;baseRevision=Number(remote.revision||0);baseState=prepareKupaCloudState(remote.state);res=null
    }
    if(!res?.r?.ok)throw new Error('הענן השתנה שוב בזמן השמירה; השינוי נשמר מקומית וינוסה שוב');
    const row=res.row,newRev=Number(row?.revision||baseRevision+1),authoritative=prepareKupaCloudState(row?.state||candidate);session.dbRevision=newRev;session.lastSavedSnapshot=JSON.stringify(authoritative);session.serverInfo.lastSavedAt=row?.updated_at||session.serverInfo.lastSavedAt||null;session.cloudConflictPending=false;
    const newer=await rebaseNewerPending(generation,authoritative,newRev);
    if(!newer){const cleared=await clearCloudPending(generation);if(generation===session.localGeneration)model.state=applyKupaCoreState(authoritative,model.state.checks);if(!cleared){setSaveStatus('השינוי אושר; ניקוי מקומי ממתין להתאוששות','error');setCloudHeaderStatus('syncing','ענן: התאוששות אחסון מקומי');return false}setSaveStatus('מסונכרן לענן','ok');setCloudHeaderStatus('synced','ענן: מסונכרן');toast(msg)}else{const newest=await getCloudPending();if(newest){model.state=applyKupaCoreState(newest.snapshot,model.state.checks);session.cloudConflictPending=!!newest.conflict}setSaveStatus(session.cloudConflictPending?'התנגשות שמורה מקומית':'שומר שינוי נוסף…',session.cloudConflictPending?'error':'saving');setCloudHeaderStatus(session.cloudConflictPending?'conflict':'syncing',session.cloudConflictPending?'ענן: התנגשות':'ענן: מסנכרן…')}
    persistImmediateBrowserSnapshot(model.state,session.dbRevision);await backupSnapshotToComputer(model.state,session.dbRevision);if(generation===session.localGeneration||newer)render();if(newer&&!session.cloudConflictPending)setTimeout(cloudPoll,0);return !session.cloudConflictPending
  }catch(e){session.cloudWriteBusy=false;console.error(e);const current=await getCloudPending(),normalized=normalizeCloudError(e),attempts=Number(current?.retry?.attempts||0)+1,nextAttemptAt=normalized.retryAfterMs?new Date(Date.now()+normalized.retryAfterMs).toISOString():null;stageCloudPendingLocal(prepareKupaCloudState(model.state),msg,session.dbRevision,lastSavedCloudState()||pending.baseState||snapshot,session.localGeneration,false,{attempts,lastErrorCode:normalized.code||normalized.kind,lastAttemptAt:new Date().toISOString(),nextAttemptAt});persistImmediateBrowserSnapshot(model.state,session.dbRevision);setSaveStatus(navigator.onLine?'ממתין לסנכרון':'אופליין — שינוי שמור מקומית','saving');setCloudHeaderStatus(navigator.onLine?'syncing':'offline',navigator.onLine?'ענן: ממתין לסנכרון':'ענן: אופליין');toast('השינוי נשמר מקומית וממתין לסנכרון לענן');return false}
  finally{session.cloudWriteBusy=false;session.cloudSyncBusy=false}
}

async function cloudPoll(){
  if(!tab.primaryTab||session.connectionMode!=='supabase'||!session.backendReady||!navigator.onLine)return;
  if(session.cloudSyncBusy||session.cloudWriteBusy){await pollSharedChecks();return}
  const pending=await getCloudPending();if(pending){if(pending.conflict){session.cloudConflictPending=true;setCloudHeaderStatus('conflict','ענן: התנגשות');await pollSharedChecks();return}await reconcileCloudPending();await pollSharedChecks();return}
  if(session.cloudConflictPending){await pollSharedChecks();return}
  try{session.cloudSyncBusy=true;const row=await readSupabaseDocument(),kupaChanged=!!row&&Number(row.revision||0)>session.dbRevision,financeChanged=!!row&&Number(row.financeRevision||0)>Number(session.financeRevision||0);if(row&&(kupaChanged||financeChanged)){const base=lastSavedCloudState(),clean=!!base&&jsonEq(prepareKupaCloudState(model.state),base);if(clean){await applyCloudRow(row);toast(kupaChanged?'התקבל עדכון ממחשב אחר':'התקבל עדכון פיננסי ממקור אחר')}else if(kupaChanged){stageCloudPendingLocal(prepareKupaCloudState(model.state),'שינוי מקומי ממתין',session.dbRevision,base||prepareKupaCloudState(model.state),session.localGeneration,false);session.cloudSyncBusy=false;await reconcileCloudPending(row)}else applyFinanceOnlyRow(row)}}catch(e){console.error('cloud poll',e)}finally{session.cloudSyncBusy=false;await pollSharedChecks()}
}

function startCloudPolling(){if(session.cloudPollTimer)clearTimeout(session.cloudPollTimer);session.cloudPollingEnabled=true;const schedule=()=>{if(!session.cloudPollingEnabled)return;session.cloudPollTimer=setTimeout(async()=>{try{await cloudPoll()}finally{schedule()}},12_000+Math.floor(Math.random()*2_000))};schedule()}

return { applyCloudRow, loadSupabaseState, rpcSaveCloud, reconcileCloudPending, persistSupabaseState, cloudPoll, startCloudPolling };
}
