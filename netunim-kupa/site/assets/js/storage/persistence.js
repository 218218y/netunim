import {clone} from '../core/values.js';
import {payloadFromState} from '../state/serialization.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createStoragePersistence({reportError, model, session, files, tab, checksSession, stateFromPayload, setSaveStatus, setConnectedStatus, persistImmediateBrowserSnapshot, readJsonHandle, listBackups, backupSnapshotToComputer, prepareKupaCloudState, normalizeState, lastSavedCloudState, showSecondaryTabGuard, stageCloudPendingLocal, markSharedChecksPending, saveSharedChecksToCloud, render, lastSavedState, writeJsonHandleVerified, mergeState3Way, persistSupabaseState, toast}){
async function loadState(){if(!files.dataFileHandle)throw new Error('לא נבחר קובץ נתונים');const p=await readJsonHandle(files.dataFileHandle);const parsed=stateFromPayload(p);model.state=parsed.state;const removed=model.lastNormalizeRemovedCredits;session.dbRevision=Number(parsed.meta.revision||0);session.backendReady=true;session.localFileConflictPending=false;session.lastSavedSnapshot=JSON.stringify(model.state);session.serverInfo={schemaVersion:Number(parsed.meta.schemaVersion||6),lastSavedAt:parsed.meta.savedAt||null,databaseFile:files.dataFileHandle.name,backups:await listBackups()};persistImmediateBrowserSnapshot(model.state,session.dbRevision);if(files.backupsDirHandle)await backupSnapshotToComputer(model.state,session.dbRevision);setConnectedStatus(session.connectionMode==='directory'?'תיקיית קופה מחוברת':'קובץ נתונים מחובר');setSaveStatus('נשמר בקובץ','ok');if(removed>0)setTimeout(()=>saveState(`נוקו אוטומטית ${removed} עסקאות אשראי ישנות ולא פעילות`),0);return model.state}

function saveState(msg='נשמר'){
  if(!tab.primaryTab){showSecondaryTabGuard();return Promise.resolve(false)}
  const fullSnapshot=normalizeState(clone(model.state)),generation=++session.localGeneration,snapshot=session.connectionMode==='supabase'?prepareKupaCloudState(fullSnapshot):fullSnapshot;
  const localOk=persistImmediateBrowserSnapshot(fullSnapshot,session.dbRevision);
  if(!localOk)setSaveStatus('שגיאת עותק מקומי','error');
  if(session.connectionMode==='supabase'&&session.backendReady)stageCloudPendingLocal(snapshot,msg,session.dbRevision,lastSavedCloudState()||snapshot,generation,false);
  session.saveQueue=session.saveQueue.catch(e=>{console.error('previous save queue',e)}).then(()=>persistState(snapshot,msg,generation));
  return session.saveQueue
}

function saveChecksState(msg='הצק נשמר'){
  if(!tab.primaryTab){showSecondaryTabGuard();return Promise.resolve(false)}
  if(session.connectionMode!=='supabase'||!session.backendReady)return saveState(msg);
  const fullSnapshot=normalizeState(clone(model.state)),localOk=persistImmediateBrowserSnapshot(fullSnapshot,session.dbRevision);
  checksSession.sharedChecksGeneration++;checksSession.sharedChecksSaveRequested=true;markSharedChecksPending();
  if(!localOk)setSaveStatus('שגיאת עותק מקומי','error');else setSaveStatus(navigator.onLine?'צקים ממתינים לסנכרון':'אופליין — הצקים שמורים מקומית','saving');
  if(files.backupsDirHandle)backupSnapshotToComputer(fullSnapshot,session.dbRevision).catch(e=>console.error('shared checks local backup',e));
  clearTimeout(checksSession.sharedChecksSaveTimer);checksSession.sharedChecksSaveTimer=setTimeout(()=>{checksSession.sharedChecksSaveTimer=null;saveSharedChecksToCloud(msg)},220);
  render();return Promise.resolve(localOk)
}

async function persistState(snapshot,msg,generation=session.localGeneration){
  if(!session.backendReady){setSaveStatus('לא מחובר למקור נתונים','error');return false}
  if(generation===session.localGeneration)snapshot=session.connectionMode==='supabase'?prepareKupaCloudState(model.state):normalizeState(clone(model.state));
  if(session.connectionMode==='supabase')return persistSupabaseState(prepareKupaCloudState(snapshot),msg,generation);
  if(!files.dataFileHandle){setSaveStatus('אין קובץ נתונים','error');return false}
  if(session.localFileConflictPending){persistImmediateBrowserSnapshot(model.state,session.dbRevision);setSaveStatus('התנגשות בקובץ — העותק המקומי שמור','error');return false}
  setSaveStatus(generation===session.localGeneration?'שומר…':'שומר תור שינויים…','saving');
  try{
    const current=await readJsonHandle(files.dataFileHandle),curMeta=current?._meta||{},curRev=Number(curMeta.revision||0),remote=stateFromPayload(current).state;
    let candidate=clone(snapshot),expected=curRev;
    if(curRev!==session.dbRevision){
      const base=lastSavedState();
      if(!base){session.localFileConflictPending=true;persistImmediateBrowserSnapshot(model.state,session.dbRevision);setSaveStatus('קובץ השתנה — נדרשת בדיקה','error');reportError('קובץ הנתונים השתנה ולא קיימת גרסת בסיס בטוחה למיזוג. השינויים שעל המסך נשמרו בעותק הדפדפן ולא נדרסו. מומלץ לייצא JSON ולפתוח מחדש את הקופה.');return false}
      const merged=mergeState3Way(base,snapshot,remote);
      if(merged.conflicts.length){session.localFileConflictPending=true;persistImmediateBrowserSnapshot(model.state,session.dbRevision);setSaveStatus('התנגשות בקובץ — העותק המקומי שמור','error');reportError('אותה רשומה שונתה גם בקובץ וגם במסך הזה. כדי למנוע דריסה השמירה לקובץ נעצרה; השינויים המקומיים נשמרו בעותק הדפדפן. ייצא גיבוי JSON ופתח מחדש את הקופה לפני המשך עריכה.');return false}
      candidate=merged.state;
    }
    const nextRev=expected+1,payload=payloadFromState(candidate,nextRev);
    await writeJsonHandleVerified(files.dataFileHandle,payload);
    session.dbRevision=nextRev;session.lastSavedSnapshot=JSON.stringify(candidate);session.serverInfo.lastSavedAt=payload._meta.savedAt;
    if(generation===session.localGeneration){model.state=normalizeState(clone(candidate))}else{
      const rebased=mergeState3Way(snapshot,model.state,candidate);
      if(rebased.conflicts.length){session.localFileConflictPending=true;setSaveStatus('שינוי נוסף התנגש — נשמר בדפדפן','error')}else model.state=rebased.state
    }
    persistImmediateBrowserSnapshot(model.state,session.dbRevision);
    if(files.backupsDirHandle)await backupSnapshotToComputer(candidate,nextRev);session.serverInfo.backups=await listBackups();
    if(generation===session.localGeneration&&!session.localFileConflictPending){setSaveStatus('נשמר בקובץ','ok');toast(msg);render()}else if(!session.localFileConflictPending)setSaveStatus('שומר שינוי נוסף…','saving');
    return !session.localFileConflictPending
  }catch(e){console.error(e);persistImmediateBrowserSnapshot(model.state,session.dbRevision);setSaveStatus('שגיאת שמירה — העותק המקומי שמור','error');reportError('השמירה לקובץ נכשלה. השינוי נשמר בעותק התאוששות בדפדפן ולא יידרס בלי אזהרה. מומלץ לייצא גיבוי JSON ולטפל בגישה לתיקייה.');return false}
}

return { loadState, saveState, saveChecksState, persistState };
}
