import test from 'node:test';
import assert from 'node:assert/strict';
import {createSyncDocument} from '../netunim-kupa/site/assets/js/sync/document.js';
import {createStateNormalization} from '../netunim-kupa/site/assets/js/state/normalization.js';
import {INITIAL_STATE} from '../netunim-kupa/site/assets/js/state/constants.js';

const clone=structuredClone,noop=()=>{};
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}}
function response(ok,payload,status=ok?200:409){return {ok,status,headers:{get:()=>null},text:async()=>JSON.stringify(payload)}}

test('Kupa V2 account load without an initialized owner head cannot replace the visible state',async()=>{
  const model={state:{sentinel:'local state'}};
  const api=createSyncDocument({model,session:{},checksSession:{},refreshStorageV2CloudState:async()=>({seq:0,base:null})});
  await assert.rejects(api.applyCloudRow({state:{sentinel:'foreign account'},revision:1}),/account_head_initialization_required/);
  assert.deepEqual(model.state,{sentinel:'local state'});
});

test('Kupa legacy card IDs are queued as one V2 cloud normalization without a V1 save',async()=>{
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:false}});
  globalThis.localStorage={getItem:()=>null,setItem:noop,removeItem:noop};
  const model={state:clone(INITIAL_STATE)},normalization=createStateNormalization({model});
  model.state=normalization.normalizeState(model.state);
  const remote=clone(model.state);remote.cards=[{name:'Legacy card',chargeDay:10}];
  remote.creditSync={version:3,profiles:[],cardMappings:{}};
  remote.credits=[{id:'expired-credit',card:'Legacy card',account:'עסקי',active:false,firstChargeDate:'2024-01-01',totalAmount:100,installments:1}];
  const calls=[],session={serverInfo:{},cloudDocumentName:'main',localGeneration:0},checksSession={sharedChecksBase:[],sharedChecksBankEvents:[]};
  const cloud={seq:0,base:{revision:4,ackSeq:0,state:normalization.prepareKupaCloudState(remote)},flight:null,control:null,pending:false};
  const api=createSyncDocument({hideConnectScreen:noop,reportError:noop,model,session,checksSession,tab:{primaryTab:true},
    prepareKupaCloudState:normalization.prepareKupaCloudState,applyKupaCloudState:normalization.applyKupaCloudState,
    setSaveStatus:noop,setConnectedStatus:noop,setCloudHeaderStatus:noop,persistImmediateBrowserSnapshot:()=>{throw Error('V1 snapshot')},
    loadSharedChecksBase:()=>[],loadSharedChecksBankEvents:()=>[],listBackups:async()=>[],backupSnapshotToComputer:async()=>{},
    saveState:()=>{throw Error('V1 migration save')},syncSharedChecksFromCloud:async()=>true,render:noop,getCloudPending:async()=>null,
    readSupabaseDocument:async()=>null,supaRest:async()=>{throw Error('offline')},putCloudPending:async()=>{},clearCloudPending:async()=>true,
    mergeKupaCloudState3Way:noop,rebaseNewerPending:async()=>null,lastSavedCloudState:()=>null,showSecondaryTabGuard:noop,
    stageCloudPendingLocal:()=>{throw Error('V1 outbox')},toast:noop,pollSharedChecks:async()=>{},refreshOrdersFinanceSummary:async()=>false,
    storageV2CloudOutboxActive:()=>true,refreshStorageV2CloudState:async()=>clone(cloud),adoptStorageV2CloudHead:async(_revision,_state,options)=>{calls.push({adoptedBase:clone(options.cloudState)})},
    queueStorageV2CloudNormalization:async(state,revision)=>{calls.push({state:clone(state),revision});cloud.seq=1;cloud.pending=true},
    storageV2CommitPromise:()=>Promise.resolve()});
  try{
    await api.applyCloudRow({state:remote,revision:4,coreUpdatedAt:'2026-09-22T00:00:00Z'});
    assert.equal(calls.length,2);assert.equal(calls[1].revision,4);
    assert.ok(calls[0].adoptedBase.cards[0].id);
    assert.deepEqual(calls[0].adoptedBase.credits.map(row=>row.id),['expired-credit']);
    assert.ok(calls[1].state.cards[0].id);
    assert.deepEqual(calls[1].state.credits,[]);
    assert.equal(cloud.pending,true);
  }finally{session.cloudPollingEnabled=false;clearTimeout(session.cloudPollTimer)}
});

function fixture({write,readRemote,merge,failRefreshAfterAck=false,backupSnapshotToComputer=async()=>{},onRejected=()=>{},baseOverride=null,deleteIntents={},mutationType='edit'}={}){
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});
  globalThis.localStorage={getItem:()=>null,setItem:noop,removeItem:noop};
  const model={state:clone(INITIAL_STATE)},normalization=createStateNormalization({model});
  model.state=normalization.normalizeState(model.state);model.state.notes=[{id:'N1',content:'sent',createdAt:'2026-09-22',updatedAt:'2026-09-22'}];
  const baseFull=clone(model.state);baseFull.notes=[{id:'N1',content:'base',createdAt:'2026-09-22',updatedAt:'2026-09-22'}];
  let seq=1,ackSeq=0,revision=10,baseState=baseOverride?clone(baseOverride):normalization.prepareKupaCloudState(baseFull),flight=null,control=null,op=0;
  const sent=[],acks=[],rejects=[];
  const session={localGeneration:1,dbRevision:10,financeRevision:0,financeUpdatedAt:null,connectionMode:'supabase',backendReady:true,cloudDocumentName:'main',cloudConflictPending:false,cloudSyncBusy:false,cloudWriteBusy:false,serverInfo:{lastSavedAt:null}};
  const checksSession={sharedChecksBase:[],sharedChecksBankEvents:[]};
  const state=()=>({seq,base:{revision,state:clone(baseState),ackSeq},flight:flight&&clone(flight),control:control&&clone(control),pending:seq>ackSeq,pendingDeleteIntents:clone(deleteIntents),pendingGeneration:seq,pendingMutationType:'edit',pendingSurface:'kupa',afterFlightPending:!!flight&&seq>flight.endSeq,afterFlightDeleteIntents:{},afterFlightGeneration:seq,afterFlightMutationType:'edit',afterFlightSurface:'kupa'});
  const materialize=async({throughSeq,snapshot}={})=>{if(flight)return clone(flight);const end=throughSeq??seq;if(end===ackSeq)return null;flight={version:2,operationId:`kupa-op-${++op}`,baseRevision:revision,startSeq:ackSeq+1,endSeq:end,snapshot:clone(snapshot??normalization.prepareKupaCloudState(model.state)),deleteIntents:clone(deleteIntents),generation:end,mutationType,surface:'kupa'};return clone(flight)};
  const acknowledge=async(operationId,newRevision,cloud,{currentState,control:nextControl=null}={})=>{assert.equal(operationId,flight?.operationId);acks.push({operationId,newRevision,cloud:clone(cloud),currentState:clone(currentState),control:clone(nextControl)});ackSeq=flight.endSeq;revision=newRevision;baseState=clone(cloud);flight=null;control=nextControl&&clone(nextControl);return state()};
  const reject=async(operationId,newRevision,cloud,{currentState,expectedSeq,control:nextControl=null}={})=>{assert.equal(operationId,flight?.operationId);assert.equal(expectedSeq,seq);assert.ok(currentState,'rebase must checkpoint the merged local head');rejects.push({operationId,newRevision,cloud:clone(cloud),currentState:clone(currentState),expectedSeq,control:clone(nextControl)});revision=newRevision;baseState=clone(cloud);flight=null;control=nextControl&&clone(nextControl);onRejected();return state()};
  const supaRest=async(path,options)=>{const body=JSON.parse(options.body);sent.push({path,snapshot:clone(body.p_state),expected:body.p_expected_revision,operationId:body.p_operation_id,deleteIntents:clone(body.p_delete_intents)});if(write)return write(body);return response(true,{revision:body.p_expected_revision+1,state:clone(body.p_state),updated_at:'2026-09-22T00:00:00Z'})};
  const defaultMerge=(_base,local)=>({state:clone(local),conflicts:[]});
  const refreshState=async()=>{if(failRefreshAfterAck&&acks.length)throw new Error('injected post-ACK refresh failure');return state()};
  const api=createSyncDocument({hideConnectScreen:noop,reportError:noop,model,session,checksSession,tab:{primaryTab:true},prepareKupaCloudState:normalization.prepareKupaCloudState,applyKupaCloudState:normalization.applyKupaCloudState,setSaveStatus:noop,setConnectedStatus:noop,setCloudHeaderStatus:noop,persistImmediateBrowserSnapshot:()=>true,loadSharedChecksBase:()=>[],loadSharedChecksBankEvents:()=>[],listBackups:async()=>[],backupSnapshotToComputer,saveState:async()=>true,syncSharedChecksFromCloud:async()=>true,render:noop,getCloudPending:async()=>null,readSupabaseDocument:readRemote||(async()=>null),supaRest,putCloudPending:async()=>{},clearCloudPending:async()=>true,mergeKupaCloudState3Way:merge||defaultMerge,rebaseNewerPending:async()=>null,lastSavedCloudState:()=>clone(baseState),showSecondaryTabGuard:noop,stageCloudPendingLocal:()=>{throw new Error('legacy outbox must not be used')},toast:noop,pollSharedChecks:async()=>{},refreshOrdersFinanceSummary:async()=>false,storageV2CloudOutboxActive:()=>true,refreshStorageV2CloudState:refreshState,initializeStorageV2CloudCursor:async()=>true,materializeStorageV2CloudFlight:materialize,acknowledgeStorageV2CloudFlight:acknowledge,rejectStorageV2CloudFlight:reject,setStorageV2CloudControl:async value=>{control=clone(value);return clone(value)},replaceStorageV2CurrentState:async()=>true,adoptStorageV2CloudHead:async()=>true,resetStorageV2CloudHead:async()=>true,storageV2CommitPromise:()=>Promise.resolve()});
  return {api,model,session,sent,acks,rejects,getState:state,getControl:()=>clone(control),cloud:()=>normalization.prepareKupaCloudState(model.state),mutateNote(content){model.state.notes=[{id:'N1',content,createdAt:'2026-09-22',updatedAt:'2026-09-22'}];seq++;session.localGeneration++}};
}

test('Kupa V2 keeps the immutable flight across a lost ACK retry and never falls back to V1 outbox',async()=>{
  let calls=0;const f=fixture({write:body=>{if(++calls===1)throw new TypeError('Failed to fetch');return response(true,{revision:body.p_expected_revision+1,state:clone(body.p_state)})}});
  assert.equal(await f.api.persistSupabaseState(f.cloud(),'first',1),false);assert.equal(f.sent.length,1);const firstId=f.sent[0].operationId;assert.ok(f.getState().flight);
  assert.equal(await f.api.persistSupabaseState(f.cloud(),'retry',1),true);assert.equal(f.sent.length,2);assert.equal(f.sent[1].operationId,firstId);assert.equal(f.getState().flight,null);assert.equal(f.getState().pending,false);
});

test('Kupa V2 confirmed revision conflict rebases and rotates operation id before retry',async()=>{
  let calls=0;const remoteModel={state:clone(INITIAL_STATE)},remoteNorm=createStateNormalization({model:remoteModel});remoteModel.state=remoteNorm.normalizeState(remoteModel.state);remoteModel.state.notes=[{id:'N1',content:'remote',createdAt:'2026-09-22',updatedAt:'2026-09-22'}];const remote=remoteNorm.prepareKupaCloudState(remoteModel.state);
  const f=fixture({readRemote:async()=>({revision:11,state:clone(remote),coreUpdatedAt:'2026-09-22T00:00:00Z'}),merge:(_base,_local,remoteState)=>({state:{...clone(remoteState),notes:[{id:'N1',content:'merged',createdAt:'2026-09-22',updatedAt:'2026-09-22'}]},conflicts:[]}),write:body=>{if(++calls===1)return response(false,{code:'PT409',message:'revision_conflict'},409);return response(true,{revision:body.p_expected_revision+1,state:clone(body.p_state)})}});
  assert.equal(await f.api.persistSupabaseState(f.cloud(),'sync',1),true);assert.equal(f.sent.length,2);assert.equal(f.sent[0].expected,10);assert.equal(f.sent[1].expected,11);assert.notEqual(f.sent[0].operationId,f.sent[1].operationId);assert.equal(f.rejects.length,1);assert.equal(f.rejects[0].currentState.notes[0].content,'merged');assert.equal(f.rejects[0].expectedSeq,1);assert.equal(f.acks.length,1);assert.equal(f.model.state.notes[0].content,'merged');
});

test('Kupa V2 sends exact delete intents for credits removed by cloud normalization',async()=>{
  const base=clone(INITIAL_STATE);delete base.checks;delete base.creditSync;
  const removed=Array.from({length:12},(_,index)=>`expired-${index}`);
  base.credits=removed.map(id=>({id,card:'old',active:false,firstChargeDate:'2024-01-01',totalAmount:100,installments:1}));
  const f=fixture({baseOverride:base,deleteIntents:{credits:removed},mutationType:'cloud-normalization',write:body=>{
    assert.deepEqual(body.p_delete_intents,{credits:[...removed].sort()});
    assert.deepEqual(body.p_state.credits,[]);
    return response(true,{revision:body.p_expected_revision+1,state:clone(body.p_state)});
  }});
  assert.equal(await f.api.persistSupabaseState(f.cloud(),'normalize',1),true);
  assert.deepEqual(f.sent[0].snapshot.credits,[]);
  assert.match(f.sent[0].path,/bulk_delete_save_kupa_document_v5/);
});

test('Kupa normalization keeps server delete IDs through a revision conflict',async()=>{
  const base=clone(INITIAL_STATE);delete base.checks;delete base.creditSync;
  base.credits=[{id:'expired-credit',card:'old',active:false,firstChargeDate:'2024-01-01',totalAmount:100,installments:1}];
  let attempts=0;
  const f=fixture({baseOverride:base,deleteIntents:{credits:['expired-credit']},mutationType:'cloud-normalization',
    readRemote:async()=>({state:clone(base),revision:11}),
    write:body=>++attempts===1?response(false,{code:'PT409',message:'revision_conflict'},409):response(true,{revision:body.p_expected_revision+1,state:clone(body.p_state)})});
  assert.equal(await f.api.persistSupabaseState(f.cloud(),'normalize',1),true);
  assert.equal(f.sent.length,2);
  assert.deepEqual(f.sent.map(row=>row.expected),[10,11]);
  assert.ok(f.sent.every(row=>row.path.includes('bulk_delete_save_kupa_document_v5')));
  assert.deepEqual(f.sent.map(row=>row.deleteIntents),[{credits:['expired-credit']},{credits:['expired-credit']}]);
});

test('Kupa V2 blocks cloud send when a new edit lands during rebase commit',async()=>{
  let f;const remoteModel={state:clone(INITIAL_STATE)},remoteNorm=createStateNormalization({model:remoteModel});remoteModel.state=remoteNorm.normalizeState(remoteModel.state);remoteModel.state.notes=[{id:'N1',content:'remote',createdAt:'2026-09-22',updatedAt:'2026-09-22'}];const remote=remoteNorm.prepareKupaCloudState(remoteModel.state);
  f=fixture({readRemote:async()=>({revision:11,state:clone(remote)}),merge:(_base,_local,remoteState)=>({state:{...clone(remoteState),notes:[{id:'N1',content:'merged',createdAt:'2026-09-22',updatedAt:'2026-09-22'}]},conflicts:[]}),write:async()=>response(false,{code:'PT409',message:'revision_conflict'},409),onRejected:()=>f.mutateNote('later-edit')});
  assert.equal(await f.api.persistSupabaseState(f.cloud(),'sync',1),false);
  assert.equal(f.sent.length,1);assert.equal(f.rejects.length,1);
  assert.equal(f.model.state.notes[0].content,'later-edit');
  assert.equal(f.getControl().conflict.kind,'concurrent-rebase');
});

test('Kupa V2 also fences an emergency edit whose IndexedDB sequence is not committed yet',async()=>{
  let f;const remoteModel={state:clone(INITIAL_STATE)},remoteNorm=createStateNormalization({model:remoteModel});remoteModel.state=remoteNorm.normalizeState(remoteModel.state);remoteModel.state.notes=[{id:'N1',content:'remote',createdAt:'2026-09-22',updatedAt:'2026-09-22'}];const remote=remoteNorm.prepareKupaCloudState(remoteModel.state);
  f=fixture({readRemote:async()=>({revision:11,state:clone(remote)}),merge:(_base,_local,remoteState)=>({state:{...clone(remoteState),notes:[{id:'N1',content:'merged',createdAt:'2026-09-22',updatedAt:'2026-09-22'}]},conflicts:[]}),write:async()=>response(false,{code:'PT409',message:'revision_conflict'},409),onRejected:()=>{f.model.state.notes[0].content='emergency-edit';f.session.localGeneration++}});
  assert.equal(await f.api.persistSupabaseState(f.cloud(),'sync',1),false);
  assert.equal(f.model.state.notes[0].content,'emergency-edit');assert.equal(f.getControl().conflict.kind,'concurrent-rebase');assert.equal(f.sent.length,1);
});


test('Kupa V2 keeps a committed ACK successful when post-ACK cache refresh and local backup are unavailable',async()=>{
  const f=fixture({failRefreshAfterAck:true,backupSnapshotToComputer:async()=>{throw new Error('injected backup failure')}});
  assert.equal(await f.api.persistSupabaseState(f.cloud(),'sync',1),true);assert.equal(f.sent.length,1);assert.equal(f.acks.length,1);assert.equal(f.getState().flight,null);assert.equal(f.getState().pending,false);assert.equal(f.getControl(),null);
});

test('Kupa V2 ACK checkpoints an edit that arrives during RPC and advances only through the sent flight',async()=>{
  const started=deferred(),release=deferred();let calls=0;const f=fixture({write:async body=>{calls++;if(calls===1){started.resolve();await release.promise}return response(true,{revision:body.p_expected_revision+1,state:clone(body.p_state)})},merge:(_base,local)=>({state:clone(local),conflicts:[]})});
  const saving=f.api.persistSupabaseState(f.cloud(),'sync',1);await started.promise;f.mutateNote('later');release.resolve();
  assert.equal(await saving,true);assert.equal(f.sent.length,2);assert.notEqual(f.sent[0].operationId,f.sent[1].operationId);assert.equal(f.acks.length,2);assert.equal(f.acks[0].currentState.notes[0].content,'later');assert.equal(f.model.state.notes[0].content,'later');assert.equal(f.getState().pending,false);
});
