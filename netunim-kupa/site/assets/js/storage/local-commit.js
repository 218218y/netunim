import {measureStorage} from '../shared/storage-metrics.js';
import {beginMeasure} from '../shared/runtime-performance.js';
import {assertKupaEntityInvariants} from '../state/validation.js';
import {equalSyncJson} from '../shared/cloud-sync.js';
import {mainBusinessState} from './main-state.js';

// Owns synchronous mutation admission and durable staging. Publication cannot
// run until the existing V2 receipt permits it, including IDB-only commits.
export function createLocalCommitOwner({model,session,tab,journal,projection,publication,view}){
const {storageV2Primary,storageV2CommitPromise,storageV2DurabilityAtRisk,recoverStorageV2State,refreshStorageV2CloudState,persistImmediateBrowserSnapshot}=journal;
const {domainRevisions,creditNormalizationMayDelete,normalizeState,prepareKupaCloudState}=projection;
const {setSaveStatus,setCloudHeaderStatus,showSecondaryTabGuard,isOnline}=view;
function beginLocalRisk(token){(session.localUndurableGenerations??=new Set()).add(token)}
function clearLocalRisk(token){session.localUndurableGenerations?.delete(token)}
function clearLocalRiskAfter(token,promise){promise?.then(()=>clearLocalRisk(token),()=>{});return promise}
function mergeDeleteIntents(...values){const out={};for(const value of values){if(!value||typeof value!=='object'||Array.isArray(value))continue;for(const [key,ids] of Object.entries(value)){const clean=[...new Set((Array.isArray(ids)?ids:[]).map(x=>String(x||'').trim()).filter(Boolean))];if(clean.length)out[key]=[...new Set([...(out[key]||[]),...clean])].sort()}}return out}
const nextTurn=work=>new Promise(resolve=>setTimeout(resolve,0)).then(work);
function markMainPending(){if(session.connectionMode==='supabase'&&session.backendReady)setCloudHeaderStatus(!isOnline()?'offline':'syncing',!isOnline()?'ענן: אופליין':'ענן: ממתין לסנכרון')}

function saveStateAccepted(msg='נשמר',{deleteIntents={},mutationType='autosave',surface='kupa',domains=null,operations=null}={}){
  if(!tab.primaryTab){showSecondaryTabGuard();return Promise.resolve(false)}
  if(session.localSourceSwitchPending){setSaveStatus('ממתין להשלמת חיבור מקור הנתונים','saving');return Promise.resolve(false)}
  if(!storageV2Primary()){setSaveStatus('אחסון V2 אינו מוכן — השמירה נעצרה','error');return Promise.resolve(false)}
  measureStorage('validate',()=>assertKupaEntityInvariants(model.state,{includeChecks:true,required:true}));
  if(mutationType==='restore'||mutationType==='import')domainRevisions?.touchAll();else if(Array.isArray(domains)&&domains.length)domainRevisions?.touch(domains);else domainRevisions?.touchAll();
  const localDone=beginMeasure('kupa:save-local',{paint:true});
  // Only the business layer knows whether normalization may remove a credit.
  // Without its policy, take the full normalization path instead of skipping it.
  const generation=++session.localGeneration,typed=Array.isArray(operations)&&operations.length>0,normalizationMayDelete=(model.state.credits||[]).some(creditNormalizationMayDelete),fastLocal=typed&&!normalizationMayDelete;
  if(fastLocal){
    const localOk=persistImmediateBrowserSnapshot(model.state,session.dbRevision,{operations,generation,mutationType,surface,deleteIntents});localDone();
    const idbPending=!localOk&&storageV2DurabilityAtRisk();
    const riskToken=`state:${generation}`;if(!localOk)beginLocalRisk(riskToken);
    if(idbPending)clearLocalRiskAfter(riskToken,storageV2CommitPromise());
    if(!localOk){
      if(idbPending){
        setSaveStatus('ממתין לאישור שמירה ב־IndexedDB','saving');
        storageV2CommitPromise().then(()=>{if(generation===session.localGeneration)setSaveStatus('השינוי נשמר מקומית','saving')},()=>setSaveStatus('השינוי לא נשמר — אין לסגור את החלון','error'));
      }else setSaveStatus('שגיאת עותק מקומי','error');
    }
    if(!localOk&&!idbPending)return Promise.resolve(false);
    markMainPending();
    // The operation is already durable. Yield so normalization, cloud projection
    // and file I/O cannot delay the paint caused by the user's edit.
    return nextTurn(async()=>{
      if(idbPending){try{await storageV2CommitPromise()}catch(error){setSaveStatus('השינוי לא נשמר — אין לסגור את החלון','error');return false}}
      const currentGeneration=session.localGeneration,fullSnapshot=measureStorage('normalize',()=>normalizeState(model.state)),snapshot=session.connectionMode==='supabase'?prepareKupaCloudState(fullSnapshot,{normalized:true}):fullSnapshot;
      if(session.connectionMode==='supabase'&&session.backendReady){
        const head=await refreshStorageV2CloudState();
        if(!head?.base){setSaveStatus('ראש ענן V2 חסר — השינוי נשמר מקומית אך הסנכרון נעצר','error');return false}
        return storageV2CommitPromise().then(()=>publication.requestCloudSave(snapshot,msg,currentGeneration));
      }
      return publication.saveFile(snapshot,msg,currentGeneration).then(ok=>{if(ok)clearLocalRisk(riskToken);return ok});
    });
  }
  const fullSnapshot=measureStorage('normalize',()=>normalizeState(model.state)),autoCreditDeleteIds=[...(model.lastNormalizeRemovedCreditIds||[])],effectiveDeleteIntents=mergeDeleteIntents(deleteIntents,autoCreditDeleteIds.length?{credits:autoCreditDeleteIds}:{}),snapshot=session.connectionMode==='supabase'?prepareKupaCloudState(fullSnapshot,{normalized:true}):fullSnapshot;
  if(typed&&autoCreditDeleteIds.length){const described=new Set(operations.filter(operation=>operation.type==='delete'&&operation.collection==='credits').map(operation=>operation.id));operations=[...operations,...autoCreditDeleteIds.filter(id=>!described.has(id)).map(id=>({type:'delete',collection:'credits',id}))]}
  else if(autoCreditDeleteIds.length){
    // A caller without a typed mutation may be doing more than normalization.
    // Read the committed journal and prove that only these credits disappeared
    // before turning the deletion into typed operations. Never infer a full
    // snapshot edit from the visible model.
    const riskToken=`state:${generation}`,visibleBefore=mainBusinessState(model.state),target=mainBusinessState(fullSnapshot);
    beginLocalRisk(riskToken);localDone();
    return (async()=>{
      const recovered=await recoverStorageV2State(),source=mainBusinessState(recovered?.state||{}),removed=new Set(autoCreditDeleteIds);
      if(!Array.isArray(source.credits)||autoCreditDeleteIds.some(id=>!source.credits.some(row=>row.id===id)))throw new Error('kupa_v2_normalization_source_changed');
      source.credits=source.credits.filter(row=>!removed.has(row.id));
      if(generation!==session.localGeneration||!equalSyncJson(visibleBefore,mainBusinessState(model.state))||!equalSyncJson(source,target))throw new Error('kupa_v2_untyped_mutation');
      const saved=await saveStateAccepted(msg,{deleteIntents:effectiveDeleteIntents,mutationType,surface,domains,operations:autoCreditDeleteIds.map(id=>({type:'delete',collection:'credits',id}))});
      if(saved)clearLocalRisk(riskToken);
      return saved;
    })().catch(error=>{console.error('Kupa V2 credit normalization',error);setSaveStatus('השינוי לא נשמר — נדרשת בדיקת נתונים','error');return false});
  }
  const localOk=persistImmediateBrowserSnapshot(fullSnapshot,session.dbRevision,{normalized:true,owned:true,operations,generation,mutationType,surface,deleteIntents:effectiveDeleteIntents});
  localDone();
  const idbPending=!localOk&&storageV2DurabilityAtRisk();
  const riskToken=`state:${generation}`;if(!localOk)beginLocalRisk(riskToken);
  if(idbPending)clearLocalRiskAfter(riskToken,storageV2CommitPromise());
  if(!localOk&&!idbPending)setSaveStatus('שגיאת עותק מקומי','error');
  if(idbPending)setSaveStatus('ממתין לאישור שמירה ב־IndexedDB','saving');
  if(!localOk&&!idbPending)return Promise.resolve(false);
  markMainPending();
  const continueSave=async()=>{
    if(session.connectionMode==='supabase'&&session.backendReady){
      const head=await refreshStorageV2CloudState();
      if(!head?.base){setSaveStatus('ראש ענן V2 חסר — השינוי נשמר מקומית אך הסנכרון נעצר','error');return false}
      await storageV2CommitPromise();return publication.requestCloudSave(snapshot,msg,generation);
    }
    return publication.saveFile(snapshot,msg,generation).then(ok=>{if(ok)clearLocalRisk(riskToken);return ok})
  };
  return idbPending?storageV2CommitPromise().then(continueSave,()=>{setSaveStatus('השינוי לא נשמר — אין לסגור את החלון','error');return false}):continueSave()
}

return {saveStateAccepted};
}
