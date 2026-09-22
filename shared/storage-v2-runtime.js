import {createStorageJournal} from './storage-journal.js';
import {createStorageShadow,STORAGE_SCHEMAS} from './storage-shadow.js';
import {equalSyncJson} from './cloud-sync.js';

const LIFECYCLE_BOUNDARIES=new Set(['network-offline-mirror','pagehide-v1-checkpoint','beforeunload-v1-checkpoint','manual-flush']);

export function storageV2Mode(app,storage=globalThis.localStorage){
  try{
    const configured=storage?.getItem(`netunim-storage-v2-mode:${app}`)||storage?.getItem('netunim-storage-v2-mode');
    if(['primary','shadow','off'].includes(configured))return configured;
    return storage?.getItem('netunim-storage-v2-shadow')==='1'?'shadow':'off';
  }catch{return 'off'}
}

// Bridges the proven journal engine into application persistence. Primary mode
// is opt-in until production migration is explicitly enabled. A normal typed
// mutation is synchronously durable in the bounded emergency journal and then
// committed to IndexedDB. Boundaries keep the verified V1 checkpoint as a
// fallback while V2 atomically installs the same canonical state.
export function createStorageV2Runtime({app,owner,primary,validate,prepareCheckpoint=state=>structuredClone(state),mode=()=>storageV2Mode(app),createJournal=createStorageJournal,scheduleIdle=callback=>globalThis.requestIdleCallback?requestIdleCallback(callback,{timeout:5000}):setTimeout(callback,1000),compactEvery=128,compactAfterMs=5*60*1000}={}){
  if(!STORAGE_SCHEMAS[app]||typeof owner!=='function'||typeof primary!=='function'||typeof validate!=='function')throw new Error('storage_v2_runtime_configuration');
  const shadow=createStorageShadow({app,owner,primary,validate,enabled:()=>mode()==='shadow',createJournal});
  const diagnostics={mode:'off',recoveries:0,migrations:0,operations:0,boundaries:0,fallbacks:0,emergencyFailures:0,commitFailures:0,errors:0,lastError:''};
  let journal=null,identity='',starting=null,commits=Promise.resolve(),corruptIdentity='',operationsSinceCheckpoint=0,lastCheckpointAt=Date.now(),compactionScheduled=false;
  const business=state=>{const copy=structuredClone(state||{});delete copy._meta;return copy};
  function currentOwner(){return String(owner()||'local')}
  function create(){
    const next=currentOwner();
    if(journal&&identity===next)return journal;
    identity=next;journal=createJournal({owner:`${identity}:${app}`,schema:STORAGE_SCHEMAS[app],validate,primary:()=>primary()&&identity===currentOwner()});corruptIdentity='';return journal;
  }
  async function recover(fallbackState=null,appMetadata={}){
    if(mode()!=='primary'||!primary())return null;
    diagnostics.mode='primary';const active=create();
    if(corruptIdentity===identity)return null;
    if(starting)return starting;
    starting=(async()=>{
      try{
        let recovered=await active.open();
        if(recovered?.appMetadata?.storageRole==='primary'){
          const fallbackSeq=Number(appMetadata?.snapshotSeq||0),v2Seq=Number(recovered.appMetadata?.snapshotSeq||0);
          if(!fallbackState||fallbackSeq<=v2Seq){diagnostics.recoveries++;operationsSinceCheckpoint=Math.max(0,recovered.seq-Number(recovered.stored?.checkpoints?.data?.seq||0));return {...recovered,source:'v2'}}
          const canonical=prepareCheckpoint(business(fallbackState));validate(canonical);await active.install(canonical,{appMetadata:{...appMetadata,storageRole:'primary'}});diagnostics.migrations++;
          recovered=await active.recover();return {...recovered,source:'v1-newer-fallback'};
        }
        // A shadow checkpoint is evidence, not authority. Promotion requires a
        // current verified V1 state and establishes a new fenced primary epoch.
        if(recovered){
          if(!fallbackState)return null;
          const canonical=prepareCheckpoint(business(fallbackState));validate(canonical);
          if(!equalSyncJson(recovered.state,canonical))diagnostics.fallbacks++;
          await active.install(canonical,{appMetadata:{...appMetadata,storageRole:'primary'}});diagnostics.migrations++;
          recovered=await active.recover();return {...recovered,source:'v1-promotion'};
        }
        if(!fallbackState)return null;
        const canonical=prepareCheckpoint(business(fallbackState));validate(canonical);
        await active.install(canonical,{appMetadata:{...appMetadata,storageRole:'primary'}});diagnostics.migrations++;
        recovered=await active.recover();return {...recovered,source:'v1-migration'};
      }catch(error){diagnostics.errors++;diagnostics.lastError=error.message;corruptIdentity=identity;return null}
      finally{starting=null}
    })();
    return starting;
  }
  function canonicalOperations(state,operations){
    const source=state||{};
    return operations.map(operation=>{
      if(operation.type!=='put')return structuredClone(operation);
      const record=source[operation.collection]?.find?.(row=>row?.id===operation.id);
      if(!record)throw new Error('storage_operation_record_missing');
      return {...structuredClone(operation),record:structuredClone(record)};
    });
  }
  function scheduleCompaction(){
    if(compactionScheduled||!journal?.ready)return;compactionScheduled=true;
    scheduleIdle(async()=>{compactionScheduled=false;if(mode()!=='primary'||!journal?.ready||(!operationsSinceCheckpoint&&Date.now()-lastCheckpointAt<compactAfterMs))return;try{await commits;await journal.compact();operationsSinceCheckpoint=0;lastCheckpointAt=Date.now()}catch(error){diagnostics.errors++;diagnostics.lastError=error.message}});
  }
  function persist(state,{operations=null,storageBoundary='',generation=0,surface='',mutationType='autosave',deleteIntents={}}={},appMetadata={}){
    if(mode()!=='primary'||!primary())return {handled:false,reason:'inactive'};
    diagnostics.mode='primary';const active=create(),boundary=String(storageBoundary||'').trim(),typed=Array.isArray(operations)&&operations.length>0;
    if(boundary&&typed){diagnostics.errors++;diagnostics.lastError='storage_mutation_contract_ambiguous';return {handled:false,reason:'ambiguous'} }
    if(boundary&&LIFECYCLE_BOUNDARIES.has(boundary)&&active.ready)return {handled:true,emergencyDurable:true,committed:active.settled(),reason:'already-durable'};
    if(boundary){diagnostics.boundaries++;return {handled:false,reason:'boundary'} }
    if(!typed){diagnostics.errors++;diagnostics.lastError='storage_mutation_contract_required';return {handled:false,reason:'contract'} }
    if(!active.ready){diagnostics.fallbacks++;return {handled:false,reason:'not-ready'} }
    try{
      const write=active.append(canonicalOperations(state,operations),{generation,surface,mutationType,deleteIntents,appMetadata:{...appMetadata,storageRole:'primary'}});diagnostics.operations++;operationsSinceCheckpoint++;
      if(!write.emergencyDurable)diagnostics.emergencyFailures++;
      commits=commits.catch(()=>{}).then(()=>write.committed).catch(error=>{diagnostics.commitFailures++;diagnostics.lastError=error.message;throw error});
      if(operationsSinceCheckpoint>=compactEvery||Date.now()-lastCheckpointAt>=compactAfterMs)scheduleCompaction();
      return {handled:write.emergencyDurable,emergencyDurable:write.emergencyDurable,committed:write.committed,seq:write.seq,reason:write.emergencyDurable?'journal':'emergency-failed'};
    }catch(error){diagnostics.errors++;diagnostics.lastError=error.message;return {handled:false,reason:'append-failed',error}}
  }
  function afterLegacy(state,options={},appMetadata={}){
    if(mode()==='shadow')return shadow.observe(state,options);
    if(mode()!=='primary'||!primary())return false;
    const snapshot=business(state),boundary=String(options?.storageBoundary||'').trim();
    if(journal?.ready&&(!boundary||!LIFECYCLE_BOUNDARIES.has(boundary))){
      const canonical=prepareCheckpoint(snapshot);commits=commits.catch(()=>{}).then(()=>journal.install(canonical,{appMetadata:{...appMetadata,storageRole:'primary'}})).then(result=>{operationsSinceCheckpoint=0;lastCheckpointAt=Date.now();return result}).catch(error=>{diagnostics.errors++;diagnostics.lastError=error.message;throw error});return true;
    }
    if(!journal?.ready){void recover(snapshot,appMetadata)}
    return true;
  }
  async function flush(){
    if(mode()==='shadow')return shadow.flush();
    if(starting)await starting;
    try{await commits;await journal?.settled?.();return !journal?.error}catch{return false}
  }
  async function setCloudBase(revision,state,options={}){if(mode()!=='primary'||!journal?.ready)throw new Error('storage_v2_primary_not_ready');await commits;return journal.setCloudBase(revision,state,options)}
  async function materializeFlight(options={}){if(mode()!=='primary'||!journal?.ready)throw new Error('storage_v2_primary_not_ready');await commits;return journal.materializeFlight(options)}
  async function acknowledgeFlight(operationId,revision,state,options={}){if(mode()!=='primary'||!journal?.ready)throw new Error('storage_v2_primary_not_ready');await commits;return journal.acknowledge(operationId,revision,state,options)}
  async function compact(){if(mode()!=='primary'||!journal?.ready)return false;await commits;const result=await journal.compact();operationsSinceCheckpoint=0;lastCheckpointAt=Date.now();return result}
  return {recover,persist,afterLegacy,observe:(...args)=>shadow.observe(...args),flush,setCloudBase,materializeFlight,acknowledgeFlight,compact,primaryDiagnostics:diagnostics,shadowDiagnostics:shadow.diagnostics,get diagnostics(){return diagnostics.mode==='primary'?diagnostics:shadow.diagnostics.mode!=='disabled'?shadow.diagnostics:diagnostics},get primaryReady(){return mode()==='primary'&&!!journal?.ready},get commitPromise(){return commits}};
}
