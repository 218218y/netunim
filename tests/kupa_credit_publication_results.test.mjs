import {createCreditPreferences} from '../netunim-kupa/site/assets/js/platform/credit-preferences.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createDomainsCreditController} from '../netunim-kupa/site/assets/js/domains/credit/controller.js';
import {creditSyncHeadlineState,creditSyncDiagnosticsMarkup} from '../netunim-kupa/site/assets/js/domains/credit/sync-view.js';

function fixture(t,fail){
  const values=new Map();t.mock.method(globalThis,'setTimeout',()=>1);t.mock.method(globalThis,'clearTimeout',()=>{});
  const previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage');Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)}});
  t.after(()=>{if(previous)Object.defineProperty(globalThis,'localStorage',previous);else delete globalThis.localStorage});
  let live=true,commits=0,checkpoints=0,providerRuns=0,remote;
  const model={state:{creditSync:{version:4,syncedAt:'2020-01-01T00:00:00Z',profiles:[],errors:[]}}},messages=[];
  const captureOperation=()=>()=>{if(!live)throw Object.assign(Error('owner changed'),{code:'FINANCE_OPERATION_SCOPE_CHANGED'})};
  const ports={model,captureOperation,autoScope:()=>null,toast:message=>messages.push(message),render(){},confirmDialog:async()=>true,
    saveState:async()=>{checkpoints++;if(fail==='throw')throw new DOMException('fixture quota','QuotaExceededError');return fail!=='false'},
    bridge:{getBridgeToken:()=> 'fixture',creditStatus:async()=>({bridgeVersion:73,contractVersion:2,profiles:[{profileId:'P'}]}),resetCreditProfiles:async()=>true,syncCreditCards:async()=>{providerRuns++;return {attemptedCount:1,syncedAt:'2026-10-09T08:00:00Z',profiles:[{profileId:'P',provider:'max',accounts:[{accountNumber:'card',txns:[{id:'same-transaction',date:'2026-10-09',processedDate:'2026-10-09',chargedAmount:12}]}]}],errors:[]}}},
    saveFinancePatch:async mutator=>{remote=mutator({creditSync:model.state.creditSync});commits++;return {saved:true,row:{revision:2,state:remote}}},
  };
  const api=createDomainsCreditController({...ports,preferences:createCreditPreferences()});t.after(()=>api.stopAutoSync());
  return {api,ports,model,messages,change:()=>{live=false},counts:()=>({commits,checkpoints,providerRuns}),remote:()=>remote};
}
for(const action of ['refresh','settings','reset'])for(const failure of ['false','throw'])test(`credit ${action}: confirmed remote commit survives ${failure} in follow-up with an explicit warning`,async t=>{
  const f=fixture(t,failure);
  const result=action==='refresh'?await f.api.refreshCreditSync():action==='settings'?await f.api.saveCreditCardOrder([]):await f.api.resetCreditSync();
  if(action==='settings')assert.equal(result,true,'an ancillary failure cannot negate a confirmed remote settings write');
  const ui=f.api.creditSyncUiState();assert.ok(ui.publicationWarning,'the incomplete follow-up must remain visible');assert.equal(ui.error,'','this is not a provider/remote-commit failure');
  const summary={sync:f.model.state.creditSync};assert.equal(creditSyncHeadlineState(ui,summary).tone,'warn');assert.match(creditSyncDiagnosticsMarkup(ui,summary),/נשמרו בענן/);
  assert.deepEqual(f.model.state.creditSync,f.remote().creditSync);assert.equal(f.counts().commits,1);assert.equal(f.counts().checkpoints,1);assert.equal(f.counts().providerRuns,action==='refresh'?1:0);
  if(action!=='settings')assert.ok(f.messages.some(message=>message===ui.publicationWarning),'operator receives the committed-but-incomplete result');
});
