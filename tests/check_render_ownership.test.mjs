import test from 'node:test';
import assert from 'node:assert/strict';
import {createStoragePersistence} from '../netunim-kupa/site/assets/js/storage/persistence.js';
import {createStateNormalization} from '../netunim-kupa/site/assets/js/composition/state-normalization.js';
import {createSyncMerge} from '../netunim-kupa/site/assets/js/sync/merge.js';
import {createDomainsChecksEditor} from '../netunim-kupa/site/assets/js/domains/checks/editor.js';
import {createDomainsRecordsCommands} from '../netunim-kupa/site/assets/js/domains/records/commands.js';
import {createUiBulk} from '../netunim-kupa/site/assets/js/ui/bulk.js';
import {createUiNavigation} from '../netunim-kupa/site/assets/js/ui/navigation.js';

const noop=()=>{};
function fixture(t,{cloud=true,v2=false,v2InstallFails=false}={}){
  t.mock.method(globalThis,'setTimeout',(callback,delay)=>{if(v2&&delay===0)queueMicrotask(callback);return 0});
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});
  const model={},normalizer=createStateNormalization({model});
  model.state=normalizer.normalizeState({checks:[{id:'C',name:'Check',amount:100,dueDate:'2026-10-10',status:'בקופה'}],notes:[{id:'N',content:'base'}]});
  const base=structuredClone(model.state),session={localGeneration:0,dbRevision:1,connectionMode:cloud?'supabase':'file',backendReady:true,saveQueue:Promise.resolve(),serverInfo:{}},checksSession={sharedChecksGeneration:0};
  let renders=0,indicators=0,stages=0,remote=structuredClone(base),revision=1,writeGate=null;
  let journalState=structuredClone(base),sharedState=structuredClone(base.checks);
  const snapshots=[],sharedWrites=[],written=[],replacements=[],ui={currentPage:'checks',bulkCollection:'checks',bulkSelected:new Set(['C'])};
  const nav=createUiNavigation({ui,renderChecks:()=>{renders++},renderDashboard:()=>{renders++},renderBank:()=>{renders++},renderCredit:()=>{renders++},refreshCheckBankIndicator:()=>{indicators++},maybeAutoRefreshBankBalance:noop,maybeAutoRefreshCreditSync:noop});
  const oldDocument=globalThis.document;t.after(()=>{globalThis.document=oldDocument});globalThis.document={getElementById:()=>null};
  const deps={...normalizer,model,session,checksSession,files:{dataFileHandle:{}},tab:{primaryTab:true},render:()=>{renders++},setSaveStatus:noop,setConnectedStatus:noop,toast:noop,showSecondaryTabGuard:noop,reportError:noop,listBackups:async()=>[],storageV2Primary:()=>v2,
    storageV2Boundary:{run:async record=>{replacements.push({kind:'coordinated-local-import',record:structuredClone(record)});if(v2InstallFails)throw new Error('injected V2 install failure');return {phase:'complete'}}},
    sharedChecksV2:{requested:v2,localReady:v2,cloudState:async()=>({base:null}),recover:async()=>({seq:0,state:{checks:structuredClone(sharedState)}}),recoverReadOnly:async()=>({state:{checks:structuredClone(sharedState)}}),flush:async()=>true,
      persist:(operations,options)=>{if(!Array.isArray(operations)||!operations.length)throw new Error('typed_checks_operation_required');sharedWrites.push({operations,options});sharedState=structuredClone(model.state.checks);return {emergencyDurable:true,committed:Promise.resolve()}}},
    recoverStorageV2State:async()=>({seq:0,state:structuredClone(journalState)}),refreshStorageV2CloudState:async()=>({base:null}),
    replaceStorageV2AuthoritativeState:async(state,revision)=>{replacements.push({kind:'authoritative',state:structuredClone(state),revision});if(v2InstallFails)throw new Error('injected V2 install failure');return {epoch:'new'}},replaceStorageV2CurrentState:async state=>{replacements.push({kind:'current',state:structuredClone(state)});return 1},
    persistImmediateBrowserSnapshot:state=>{snapshots.push(structuredClone(state));journalState=structuredClone(state);return true},markSharedChecksPending:()=>{stages++},saveSharedChecksToCloud:noop,
    stateFromPayload:p=>({state:normalizer.normalizeState(p),meta:p._meta}),lastSavedState:()=>structuredClone(base),
    readJsonHandle:async()=>({...structuredClone(remote),_meta:{revision}}),writeJsonHandleVerified:async(_handle,payload)=>{written.push(structuredClone(payload));if(writeGate)await writeGate()}};
  const api=createStoragePersistence({...deps,...createSyncMerge(deps)});
  const editor=createDomainsChecksEditor({model,saveChecksState:api.saveChecksState,onChecksChanged:nav.checksChanged});
  return {api,editor,model,session,ui,snapshots,sharedWrites,written,replacements,checksSession,get renders(){return renders},get indicators(){return indicators},get stages(){return stages},remote:state=>{remote=state;revision++},holdWrite:fn=>{writeGate=fn}};
}

test('V2 Local File load coordinates Main and Shared before exposing the file state',async t=>{
  const f=fixture(t,{cloud:false,v2:true}),remote=structuredClone(f.model.state);remote.notes.push({id:'remote',content:'file'});f.remote(remote);await f.api.loadState();
  assert.equal(f.replacements.length,1);assert.equal(f.replacements[0].kind,'coordinated-local-import');
  assert.equal(f.replacements[0].record.main.kind,'replace-local-authoritative');
  assert.equal(f.replacements[0].record.shared.kind,'replace-local-authoritative');
  assert.equal(f.snapshots.length,0);
});

test('V2 Local File load fails closed when its coordinated import cannot be installed',async t=>{
  const f=fixture(t,{cloud:false,v2:true,v2InstallFails:true}),before=structuredClone(f.model.state),remote=structuredClone(before);remote.notes.push({id:'remote',content:'file'});f.remote(remote);
  await assert.rejects(f.api.loadState(),/injected V2 install failure/);assert.deepEqual(f.model.state,before);assert.equal(f.session.backendReady,true,'the preexisting session remains unchanged');assert.equal(f.snapshots.length,0);
});

test('V2 Local File save writes the journaled state without replacing its checkpoint',async t=>{
  const f=fixture(t,{cloud:false,v2:true});f.model.state.notes[0].content='local';
  assert.equal(await f.api.saveState('saved',{domains:['notes'],operations:[{type:'put',collection:'notes',id:'N',mode:'replace',record:structuredClone(f.model.state.notes[0])}]}),true);
  assert.equal(f.snapshots.length,1);assert.equal(f.replacements.length,0);assert.equal(f.written.at(-1).notes[0].content,'local');
});

test('local check persistence uses Shared V2 and owns no render',async t=>{
  const f=fixture(t,{v2:true});assert.equal(await f.api.saveChecksState('saved',{operations:[{type:'put',collection:'checks',id:'C',mode:'replace',record:structuredClone(f.model.state.checks[0])}]}),true);
  assert.equal(f.snapshots.length,0);assert.equal(f.sharedWrites.length,1);assert.equal(f.checksSession.sharedChecksGeneration,1);assert.equal(f.renders,0);
});
test('check status owner renders once, and an alert action preserves an unrelated active view',t=>{
  const f=fixture(t,{v2:true});assert.equal(f.editor.markDeposited('C'),true);assert.equal(f.renders,1);assert.equal(f.sharedWrites.length,1);
  assert.equal(f.editor.markDeposited('C'),false);assert.equal(f.renders,1);
  f.ui.currentPage='notes';f.editor.markCleared('C');assert.equal(f.renders,1);assert.equal(f.indicators,2);assert.equal(f.sharedWrites.length,2);
  assert.equal(f.model.state.checks[0].status,'נפרע');
});
test('check single and bulk deletion each have one UI owner',async t=>{
  const f=fixture(t,{v2:true});let renders=0;
  const records=createDomainsRecordsCommands({model:f.model,saveChecksState:f.api.saveChecksState,confirmDialog:async()=>true,closeModal:noop,renderCollection:()=>{renders++}});
  await records.deleteRecord('checks','C');assert.equal(renders,1);assert.equal(f.renders,0);assert.equal(f.sharedWrites.length,1);
  f.model.state.checks.push({id:'D',name:'D',amount:50});f.ui.bulkSelected=new Set(['D']);
  const bulk=createUiBulk({ui:f.ui,model:f.model,saveChecksState:f.api.saveChecksState,render:()=>{renders++},toast:noop,confirmDialog:async()=>true});
  await bulk.deleteBulkSelected('checks');assert.equal(renders,2);assert.equal(f.sharedWrites.length,2);assert.equal(f.snapshots.length,0);assert.deepEqual(f.model.state.checks,[]);
});
test('file save does not render or merge an external revision into V2',async t=>{
  const f=fixture(t,{cloud:false,v2:true});f.model.state.notes[0].content='local';
  const noteOperation={type:'put',collection:'notes',id:'N',mode:'replace',record:structuredClone(f.model.state.notes[0])};
  assert.equal(await f.api.saveState('saved',{operations:[noteOperation]}),true);assert.equal(f.renders,0);assert.equal(f.written.length,1);
  const g=fixture(t,{cloud:false,v2:true}),remote=structuredClone(g.model.state);remote.notes.push({id:'remote',content:'external'});g.remote(remote);g.model.state.notes[0].content='local';
  assert.equal(await g.api.saveState('saved',{operations:[noteOperation]}),false);assert.equal(g.renders,0);assert.equal(g.written.length,0);
  assert.equal(g.model.state.notes[0].content,'local');assert.equal(g.model.state.notes.length,1);
});
test('file export leaves a newer visible edit in V2 during verified I/O',async t=>{
  const f=fixture(t,{cloud:false,v2:true});
  f.holdWrite(()=>{f.model.state.notes[0].content='newer';f.session.localGeneration++});
  f.model.state.notes[0].content='first';
  const noteOperation={type:'put',collection:'notes',id:'N',mode:'replace',record:structuredClone(f.model.state.notes[0])};
  assert.equal(await f.api.saveState('saved',{operations:[noteOperation]}),true);
  assert.equal(f.model.state.notes[0].content,'newer');assert.equal(f.model.state.notes.length,1);assert.equal(f.renders,0);
});
test('file check deletion keeps its delete intent in Shared V2 without a Main snapshot',async t=>{
  const f=fixture(t,{cloud:false,v2:true});f.model.state.checks=[];
  assert.equal(await f.api.saveChecksState('',{deletedIds:['C'],operations:[{type:'delete',collection:'checks',id:'C'}]}),true);
  assert.deepEqual(f.sharedWrites[0].options.deleteIds,['C']);assert.equal(f.snapshots.length,0);
});
