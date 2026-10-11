import {createStorageV2Runtime} from '../shared/storage-v2-runtime.js';
import {createStorageJournal} from '../shared/storage-journal.js';
import {memoryDb,emergencyStore} from './storage-v2-fixture.mjs';
import {equalSyncJson} from '../shared/cloud-sync.js';
export async function postAckFixture(app,{onCommitted=async()=>{},remoteChange=false,onRecovery=async()=>{},remoteEdit=null}={}){
  const root=`../netunim-${app}/site/assets/js/`,{INITIAL_STATE}=await import(root+'state/constants.js'),{createStorageBrowser}=await import(root+'storage/browser.js'),{createSyncDocument}=await import(root+'sync/document.js'),{createSyncMerge}=await import(root+'sync/merge.js');
  const clone=structuredClone,noop=()=>{},project=value=>{const next=clone(value);delete next.checks;delete next._meta;return next};
  const model={state:clone(INITIAL_STATE)},session={localGeneration:0,cloudRevision:10,dbRevision:10,connectionMode:'supabase',backendReady:true,serverInfo:{}},tab={primaryTab:true},files={},db=memoryDb(),wrapped={...db},calls=[],statuses=[];
  let remoteRow={revision:10,state:project(model.state),updated_at:'2026-10-11T10:07:06Z'};
  let afterCommit=onCommitted,owner='post-ack-account',loginEpoch=1;
  wrapped.acknowledge=async(...args)=>{await db.acknowledge(...args);const callback=afterCommit;afterCommit=null;if(callback)await callback(f)};
  wrapped.commitCloudRecovery=async(...args)=>{await onRecovery(f);return db.commitCloudRecovery(...args)};
  const runtime=createStorageV2Runtime({app,owner:()=>owner,primary:()=>tab.primaryTab,mode:()=> 'primary',validate:noop,createJournal:args=>createStorageJournal({...args,db:wrapped,emergency:emergencyStore()})});
  await runtime.initializeCloudHead(10,model.state,{sourceOwner:owner,intent:'cloud-authoritative',cloudState:project(model.state)});
  const driver=createStorageBrowser({storageV2:runtime,model,session,files,normalizeState:clone,prepareCloudState:project,prepareKupaCloudState:project});
  const {createStateNormalization}=await import(root+(app==='kupa'?'composition/state-normalization.js':'state/normalization.js'));
  const normalization=createStateNormalization({model,externalWorkbooks:true});
  const merge=createSyncMerge({normalizeState:normalization.normalizeState,prepareKupaCloudState:project});
  async function edit(id,content,{remove=false}={}){
    const index=model.state.notes.findIndex(note=>note.id===id),record={id,content,createdAt:'2026-10-11',updatedAt:'2026-10-11'};
    if(remove)model.state.notes.splice(index,1);else if(index<0)model.state.notes.push(record);else model.state.notes[index]=record;
    session.localGeneration++;
    const operations=remove?[{type:'delete',collection:'notes',id}]:[{type:'put',collection:'notes',id,mode:index<0?'insert':'replace',index:index<0?model.state.notes.length-1:index,record}];
    const result=runtime.persist(model.state,{operations,generation:session.localGeneration,deleteIntents:remove?{notes:[id]}:{},mutationType:'edit',surface:'notes'});
    if(!result.handled)throw new Error('fixture edit not handled: '+result.reason);
    await result.committed;
  }
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});
  const rpc=async(snapshot,revision,operationId)=>{calls.push({snapshot:clone(snapshot),revision,operationId});const state=clone(snapshot);if(calls.length===1){if(remoteChange)state.notes.push({id:'remote-note',content:'remote-only',createdAt:'2026-10-11',updatedAt:'2026-10-11'});if(remoteEdit)state.notes[0].content=remoteEdit}remoteRow={revision:revision+1,state,updated_at:'2026-10-11T10:07:06Z'};return {r:{ok:true},row:clone(remoteRow)}};
  const ports={getCloudWriteScope:()=>({...runtime.cloudScope,accountOwner:owner,loginEpoch}),model,session,files,tab,toast:noop,render:noop,
    readCloud:async()=>clone(remoteRow),
    refreshStorageV2CloudState:()=>driver.refreshStorageV2CloudState(),materializeStorageV2CloudFlight:args=>driver.materializeStorageV2CloudFlight(args),acknowledgeStorageV2CloudFlight:(...args)=>driver.acknowledgeStorageV2CloudFlight(...args),setStorageV2CloudControl:(...args)=>driver.setStorageV2CloudControl(...args),storageV2CommitPromise:()=>runtime.commitPromise,
    readStorageV2CloudRecovery:(...args)=>driver.readStorageV2CloudRecovery(...args),commitStorageV2CloudRecovery:(...args)=>driver.commitStorageV2CloudRecovery(...args)};
  const api=app==='orders'?createSyncDocument({...ports,prepareCloudState:project,composeOrderCloudState:(cloud,current)=>({...clone(cloud),checks:clone(current.checks)}),cloudEnabled:()=>true,cloudHasLocalWork:()=>!!(session.storageV2CloudPending||session.cloudSaveRequested),sameOrderCloudData:(a,b)=>equalSyncJson(project(a),project(b)),applyOrderCloudState:state=>{model.state={...clone(state),checks:clone(model.state.checks)}},rpcSaveV2:rpc,merge3:merge.merge3,setCloud:(...args)=>statuses.push(args),writeStateToFolder:async()=>{},pollSharedChecks:async()=>{},refreshKupaReadout:async()=>false,refreshCloudTimestamp:noop}):createSyncDocument({...ports,
    hideConnectScreen:noop,reportError:noop,checksSession:{},prepareKupaCloudState:project,applyKupaCloudState:state=>({...clone(state),checks:clone(model.state.checks)}),setSaveStatus:noop,setConnectedStatus:noop,setCloudHeaderStatus:(...args)=>statuses.push(args),listBackups:async()=>[],backupSnapshotToComputer:async()=>{},syncSharedChecksFromCloud:async()=>true,mergeKupaCloudState3Way:merge.mergeKupaCloudState3Way,storageV2CloudOutboxActive:()=>true,assertAccountOwner:()=>true,showSecondaryTabGuard:noop,pollSharedChecks:async()=>{},supaRest:async(_path,args)=>{const body=JSON.parse(args.body),result=await rpc(body.p_state,body.p_expected_revision,body.p_operation_id);return {ok:true,status:200,headers:{get:()=>null},text:async()=>JSON.stringify(result.row)}}});
  const f={model,session,tab,runtime,db,wrapped,driver,calls,statuses,edit,api,project,setRemote:row=>{remoteRow=clone(row)},changeLogin:()=>loginEpoch++,save:()=>app==='orders'?api.requestCloudSave(''):api.persistSupabaseState(project(model.state),'')};
  await driver.refreshStorageV2CloudState();await edit('original-note','flight-value');return f;
}
