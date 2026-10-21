import {measureStorage} from '../shared/storage-metrics.js';
import {beginMeasure} from '../shared/runtime-performance.js';
import {assertKupaEntityInvariants} from '../state/validation.js';
import {equalSyncJson} from '../shared/cloud-sync.js';
import {mainBusinessState} from './main-state.js';
import {createLocalMutationAdmission,hasFailedLocalMutation} from '../shared/local-mutation-admission.js';

// Owns synchronous mutation admission and durable staging. Publication cannot
// run until the existing V2 receipt permits it, including IDB-only commits.
export function createLocalCommitOwner({model,session,tab,journal,projection,publication,view}){
const {storageV2Primary,storageV2CommitPromise,storageV2DurabilityAtRisk,recoverStorageV2State,refreshStorageV2CloudState,persistImmediateBrowserSnapshot}=journal;
const {domainRevisions,creditNormalizationMayDelete,normalizeState,prepareKupaCloudState}=projection;
const {setSaveStatus,setCloudHeaderStatus,showSecondaryTabGuard,isOnline}=view;
function beginLocalRisk(token){(session.localUndurableGenerations??=new Set()).add(token)}
function clearLocalRisk(token){session.localUndurableGenerations?.delete(token)}
const admission=createLocalMutationAdmission({session,scope:journal.mutationScope,onFailure:()=>{
  setSaveStatus('שינוי לא נשמר — אין לסגור את החלון; ייצא JSON לשמירת הטיוטה','error');
  setCloudHeaderStatus('conflict','ענן: שינוי לא נשמר מקומית');
}});
function stageLocal(snapshot,options){
  return admission.admit(`state:${options.generation}`,()=>{
    const localOk=persistImmediateBrowserSnapshot(snapshot,session.dbRevision,options);
    return {localOk,accepted:localOk||storageV2DurabilityAtRisk(),committed:storageV2CommitPromise()};
  });
}
function mergeDeleteIntents(...values){const out={};for(const value of values){if(!value||typeof value!=='object'||Array.isArray(value))continue;for(const [key,ids] of Object.entries(value)){const clean=[...new Set((Array.isArray(ids)?ids:[]).map(x=>String(x||'').trim()).filter(Boolean))];if(clean.length)out[key]=[...new Set([...(out[key]||[]),...clean])].sort()}}return out}
const nextTurn=work=>new Promise(resolve=>setTimeout(resolve,0)).then(work);
function markMainPending(){if(session.connectionMode==='supabase'&&session.backendReady)setCloudHeaderStatus(!isOnline()?'offline':'syncing',!isOnline()?'ענן: אופליין':'ענן: ממתין לסנכרון')}

function saveStateAccepted(...args){
  try{const pending=saveStateProposed(...args),token=`state:${session.localGeneration}`;return Promise.resolve(pending).catch(error=>admission.reject(token,error))}
  catch(error){admission.reject(`state:${session.localGeneration}`,error);return Promise.resolve(false)}
}
function saveStateProposed(msg='נשמר',{deleteIntents={},mutationType='autosave',surface='kupa',domains=null,operations=null}={}){
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
    const receipt=stageLocal(model.state,{operations,generation,mutationType,surface,deleteIntents});localDone();
    if(!receipt.accepted)return Promise.resolve(false);
    if(!receipt.localOk)setSaveStatus('ממתין לאישור שמירה ב־IndexedDB','saving');
    markMainPending();
    // The operation is already durable. Yield so normalization, cloud projection
    // and file I/O cannot delay the paint caused by the user's edit.
    return nextTurn(async()=>{
      if(await receipt.committed!==true||!receipt.current()||hasFailedLocalMutation(session))return false;
      const currentGeneration=session.localGeneration,fullSnapshot=measureStorage('normalize',()=>normalizeState(model.state)),snapshot=session.connectionMode==='supabase'?prepareKupaCloudState(fullSnapshot,{normalized:true}):fullSnapshot;
      if(session.connectionMode==='supabase'&&session.backendReady){
        const head=await refreshStorageV2CloudState();
        if(!head?.base){setSaveStatus('ראש ענן V2 חסר — השינוי נשמר מקומית אך הסנכרון נעצר','error');return false}
        if(await storageV2CommitPromise()!==true||!receipt.current()||hasFailedLocalMutation(session))return false;
        return publication.requestCloudSave(snapshot,msg,currentGeneration);
      }
      return publication.saveFile(snapshot,msg,currentGeneration);
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
    })().catch(error=>{console.error('Kupa V2 credit normalization',error);return admission.reject(riskToken,error)});
  }
  const receipt=stageLocal(fullSnapshot,{normalized:true,owned:true,operations,generation,mutationType,surface,deleteIntents:effectiveDeleteIntents});
  localDone();
  if(!receipt.accepted)return Promise.resolve(false);
  if(!receipt.localOk)setSaveStatus('ממתין לאישור שמירה ב־IndexedDB','saving');
  markMainPending();
  const continueSave=async()=>{
    if(await receipt.committed!==true||!receipt.current()||hasFailedLocalMutation(session))return false;
    if(session.connectionMode==='supabase'&&session.backendReady){
      const head=await refreshStorageV2CloudState();
      if(!head?.base){setSaveStatus('ראש ענן V2 חסר — השינוי נשמר מקומית אך הסנכרון נעצר','error');return false}
      if(await storageV2CommitPromise()!==true||!receipt.current()||hasFailedLocalMutation(session))return false;
      return publication.requestCloudSave(snapshot,msg,generation);
    }
    return publication.saveFile(snapshot,msg,generation)
  };
  return continueSave()
}

return {saveStateAccepted};
}
