import {clone} from '../core/values.js';

// Recover the local V2 journals when cloud access is unavailable. Startup
// hydrates the independent Shared Checks journal before business editing.
export function createSyncRecovery({captureLegacyWorkbook=async()=>{},hideConnectScreen,model,session,
  prepareKupaCloudState,normalizeState,setSaveStatus,setConnectedStatus,setCloudHeaderStatus,
  refreshStorageV2CloudState=async()=>null,loadBrowserState,loadBrowserStateReadOnly=loadBrowserState,
  startCloudPolling,render,domainRevisions}){
  async function recoverBrowserV2StateReadOnly(){
    const record=await loadBrowserStateReadOnly();
    if(!record?.v2Authoritative||!record.state)return false;
    const previous=model.state;
    model.state=normalizeState({...clone(record.state),checks:clone(model.state.checks||[])});
    domainRevisions?.reconcile(previous,model.state,{forceAll:true});
    session.dbRevision=Number(record.revision||0);
    session.connectionMode='supabase';
    session.backendReady=false;
    hideConnectScreen();
    setConnectedStatus('לקריאה בלבד');
    setSaveStatus('לקריאה בלבד','');
    setCloudHeaderStatus('offline','ענן: קריאה בלבד');
    render();
    return true;
  }

  async function recoverBrowserV2State({startup=false,deferRender=false}={}){
    const record=await loadBrowserState();
    if(!record?.v2Authoritative||!record.state)return false;
    await captureLegacyWorkbook(record.state.notesSheet);
    const v2=await refreshStorageV2CloudState(),previous=model.state;
    model.state=normalizeState({...clone(record.state),checks:clone(model.state.checks||[])});
    domainRevisions?.reconcile(previous,model.state,{forceAll:true});
    session.dbRevision=Number(v2?.base?.revision??record.revision??0);
    session.lastSavedSnapshot=JSON.stringify(v2?.base?.state?prepareKupaCloudState(v2.base.state):prepareKupaCloudState(model.state));
    session.storageV2CloudPending=!!(v2?.pending||v2?.flight);
    session.cloudConflictPending=!!v2?.control?.conflict;
    session.connectionMode='supabase';
    session.backendReady=!deferRender;
    if(!deferRender)hideConnectScreen();
    setConnectedStatus('Supabase — עותק מקומי');
    const anyPending=!!(v2?.pending||v2?.flight||v2?.control?.conflict);
    if(startup&&navigator.onLine){
      setSaveStatus(anyPending?'שינוי מקומי שמור · מאמת מול הענן':'מקומי: נטען · מאמת מול הענן','saving');
      setCloudHeaderStatus(v2?.control?.conflict?'conflict':'syncing',v2?.control?.conflict?'ענן: התנגשות':'ענן: מסנכרן…');
    }else{
      setSaveStatus(anyPending?'אופליין — שינוי שמור מקומית וממתין':'אופליין — מוצג העותק המקומי האחרון','saving');
      setCloudHeaderStatus(v2?.control?.conflict?'conflict':'offline',v2?.control?.conflict?'ענן: התנגשות':'ענן: אופליין');
    }
    if(!deferRender)render();
    if(!deferRender&&(!startup||!navigator.onLine))startCloudPolling();
    return true;
  }

  return {recoverBrowserV2State,recoverBrowserV2StateReadOnly};
}
