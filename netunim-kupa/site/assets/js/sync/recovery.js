import {clone} from '../core/values.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createSyncRecovery({hideConnectScreen, model, session, checksSession, prepareKupaCloudState, applyKupaCloudState, normalizeState, setSaveStatus, setConnectedStatus, setCloudHeaderStatus, getCloudPending, loadBrowserState, loadSharedChecksBase, sharedChecksPendingExists, startCloudPolling, render}){
async function openBrowserStateFallback(){const record=await loadBrowserState();if(!record?.state)return false;const pending=await getCloudPending(),full=normalizeState(clone(record.state));model.state=pending?.snapshot?applyKupaCloudState(pending.snapshot,full.checks):full;session.dbRevision=Number(pending?.baseRevision??record.revision??0);session.lastSavedSnapshot=JSON.stringify(pending?.baseState?prepareKupaCloudState(pending.baseState):prepareKupaCloudState(full));checksSession.sharedChecksBase=loadSharedChecksBase();session.connectionMode='supabase';session.backendReady=true;hideConnectScreen();setConnectedStatus('Supabase — עותק מקומי');setSaveStatus(pending||sharedChecksPendingExists()?'אופליין — שינוי שמור מקומית וממתין':'אופליין — מוצג העותק המקומי האחרון','saving');setCloudHeaderStatus('offline','ענן: אופליין');render();startCloudPolling();return true}

return { openBrowserStateFallback };
}
