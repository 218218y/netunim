import test from 'node:test';
import assert from 'node:assert/strict';
import {createStoragePersistence} from '../netunim-kupa/site/assets/js/storage/persistence.js';
import {createStateNormalization} from '../netunim-kupa/site/assets/js/state/normalization.js';
import {createSyncMerge} from '../netunim-kupa/site/assets/js/sync/merge.js';
import {createDomainsChecksEditor} from '../netunim-kupa/site/assets/js/domains/checks/editor.js';
import {createDomainsRecordsCommands} from '../netunim-kupa/site/assets/js/domains/records/commands.js';
import {createUiBulk} from '../netunim-kupa/site/assets/js/ui/bulk.js';
import {createUiNavigation} from '../netunim-kupa/site/assets/js/ui/navigation.js';

const noop=()=>{};
function fixture(t,{cloud=true}={}){
  t.mock.method(globalThis,'setTimeout',()=>0);
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});
  const model={},normalizer=createStateNormalization({model});
  model.state=normalizer.normalizeState({checks:[{id:'C',name:'Check',amount:100,dueDate:'2026-10-10',status:'בקופה'}],notes:[{id:'N',content:'base'}]});
  const base=structuredClone(model.state),session={localGeneration:0,dbRevision:1,connectionMode:cloud?'supabase':'file',backendReady:true,saveQueue:Promise.resolve(),serverInfo:{}},checksSession={sharedChecksGeneration:0};
  let renders=0,indicators=0,stages=0,remote=structuredClone(base),revision=1,writeGate=null;
  const snapshots=[],written=[],ui={currentPage:'checks',bulkCollection:'checks',bulkSelected:new Set(['C'])};
  const nav=createUiNavigation({ui,renderChecks:()=>{renders++},renderDashboard:()=>{renders++},renderBank:()=>{renders++},renderCredit:()=>{renders++},refreshCheckBankIndicator:()=>{indicators++},maybeAutoRefreshBankBalance:noop,maybeAutoRefreshCreditSync:noop});
  const oldDocument=globalThis.document;t.after(()=>{globalThis.document=oldDocument});globalThis.document={getElementById:()=>null};
  const deps={...normalizer,model,session,checksSession,files:{dataFileHandle:{}},tab:{primaryTab:true},render:()=>{renders++},setSaveStatus:noop,setConnectedStatus:noop,toast:noop,showSecondaryTabGuard:noop,reportError:noop,listBackups:async()=>[],
    persistImmediateBrowserSnapshot:state=>{snapshots.push(structuredClone(state));return true},markSharedChecksPending:()=>{stages++},saveSharedChecksToCloud:noop,
    stateFromPayload:p=>({state:normalizer.normalizeState(p),meta:p._meta}),lastSavedState:()=>structuredClone(base),
    readJsonHandle:async()=>({...structuredClone(remote),_meta:{revision}}),writeJsonHandleVerified:async(_handle,payload)=>{written.push(structuredClone(payload));if(writeGate)await writeGate()}};
  const api=createStoragePersistence({...deps,...createSyncMerge(deps)});
  const editor=createDomainsChecksEditor({model,saveChecksState:api.saveChecksState,onChecksChanged:nav.checksChanged});
  return {api,editor,model,session,ui,snapshots,written,checksSession,get renders(){return renders},get indicators(){return indicators},get stages(){return stages},remote:state=>{remote=state;revision++},holdWrite:fn=>{writeGate=fn}};
}

test('local check persistence remains durable and staged but owns no render',async t=>{
  const f=fixture(t);assert.equal(await f.api.saveChecksState(),true);
  assert.equal(f.snapshots.length,1);assert.equal(f.stages,1);assert.equal(f.checksSession.sharedChecksGeneration,1);assert.equal(f.renders,0);
});
test('check status owner renders once, and an alert action preserves an unrelated active view',t=>{
  const f=fixture(t);assert.equal(f.editor.markDeposited('C'),true);assert.equal(f.renders,1);assert.equal(f.snapshots.length,1);
  assert.equal(f.editor.markDeposited('C'),false);assert.equal(f.renders,1);
  f.ui.currentPage='notes';f.editor.markCleared('C');assert.equal(f.renders,1);assert.equal(f.indicators,2);assert.equal(f.snapshots.length,2);
  assert.equal(f.snapshots.at(-1).checks[0].status,'נפרע');
});
test('check single and bulk deletion each have one UI owner',async t=>{
  const f=fixture(t);let renders=0;
  const records=createDomainsRecordsCommands({model:f.model,saveChecksState:f.api.saveChecksState,confirmDialog:async()=>true,closeModal:noop,renderCollection:()=>{renders++}});
  await records.deleteRecord('checks','C');assert.equal(renders,1);assert.equal(f.renders,0);assert.equal(f.snapshots.length,1);
  f.model.state.checks.push({id:'D',name:'D',amount:50});f.ui.bulkSelected=new Set(['D']);
  const bulk=createUiBulk({ui:f.ui,model:f.model,saveChecksState:f.api.saveChecksState,render:()=>{renders++},toast:noop,confirmDialog:async()=>true});
  await bulk.deleteBulkSelected('checks');assert.equal(renders,2);assert.equal(f.snapshots.length,2);assert.equal(f.stages,2);assert.deepEqual(f.model.state.checks,[]);
});
test('file ACK without a business change does not render; external rebase does',async t=>{
  const f=fixture(t,{cloud:false});f.model.state.notes[0].content='local';
  assert.equal(await f.api.saveState(),true);assert.equal(f.renders,0);assert.equal(f.written.length,1);
  const g=fixture(t,{cloud:false}),remote=structuredClone(g.model.state);remote.notes.push({id:'remote',content:'external'});g.remote(remote);g.model.state.notes[0].content='local';
  assert.equal(await g.api.saveState(),true);assert.equal(g.renders,1);assert.equal(g.model.state.notes[0].content,'local');assert.equal(g.model.state.notes[1].content,'external');
});
test('file rebase preserves a newer edit made during verified I/O and refreshes once',async t=>{
  const f=fixture(t,{cloud:false}),remote=structuredClone(f.model.state);remote.notes.push({id:'remote',content:'external'});f.remote(remote);
  f.holdWrite(()=>{f.model.state.notes[0].content='newer';f.session.localGeneration++});
  f.model.state.notes[0].content='first';assert.equal(await f.api.saveState(),true);
  assert.equal(f.model.state.notes[0].content,'newer');assert.equal(f.model.state.notes[1].content,'external');assert.equal(f.renders,1);
});
test('file check deletion retains explicit delete intent while merging another writer',async t=>{
  const f=fixture(t,{cloud:false}),remote=structuredClone(f.model.state);remote.notes.push({id:'remote',content:'external'});f.remote(remote);f.model.state.checks=[];
  assert.equal(await f.api.saveChecksState('',{deletedIds:['C']}),true);assert.deepEqual(f.written[0].checks,[]);assert.equal(f.model.state.notes[1].content,'external');
});
