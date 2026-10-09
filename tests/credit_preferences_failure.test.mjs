import {createCreditPreferences} from '../netunim-kupa/site/assets/js/platform/credit-preferences.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createDomainsCreditController} from '../netunim-kupa/site/assets/js/domains/credit/controller.js';
import {creditSyncHeadlineState,creditSyncDiagnosticsMarkup} from '../netunim-kupa/site/assets/js/domains/credit/sync-view.js';

function fixture(t){
  const values=new Map(),messages=[];let failure=null,resets=0,commits=0,providerRuns=0,leaseClaims=0,statusRenders=0,afterCommit=()=>{};
  const storage={getItem:key=>{if(failure==='read')throw new DOMException('blocked','SecurityError');return values.get(key)??null},setItem:(key,value)=>{if(failure==='write')throw new DOMException('full','QuotaExceededError');values.set(key,String(value))},removeItem:key=>{if(failure==='write')throw new DOMException('full','QuotaExceededError');values.delete(key)}};
  const previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage');Object.defineProperty(globalThis,'localStorage',{configurable:true,value:storage});
  t.after(()=>{if(previous)Object.defineProperty(globalThis,'localStorage',previous);else delete globalThis.localStorage});
  t.mock.method(globalThis,'setTimeout',()=>1);t.mock.method(globalThis,'clearTimeout',()=>{});
  const model={state:{creditSync:{version:4,profiles:[{profileId:'old',provider:'max',accounts:[]}],errors:[]},notes:[{id:'retained',content:'unchanged'}]}};
  const ports={model,captureOperation:()=>()=>{},autoScope:()=> 'owner',toast:message=>messages.push(message),render(){},renderStatus(){statusRenders++},confirmDialog:async()=>true,saveState:async()=>true,
    bridge:{getBridgeToken:()=> 'fixture',creditStatus:async()=>({bridgeVersion:73,contractVersion:2,profiles:[{profileId:'old'}]}),resetCreditProfiles:async()=>{resets++},syncCreditCards:async()=>{providerRuns++;return {profiles:[{profileId:'retained-provider',provider:'max',accounts:[]}],errors:[]}}},
    saveFinancePatch:async mutator=>{commits++;const state=mutator(model.state);afterCommit();return {saved:true,row:{revision:2,state}}},
    claimFinanceSyncLease:async()=>{leaseClaims++;return {acquired:true}},
  };
  const api=createDomainsCreditController({...ports,preferences:createCreditPreferences({storage})});t.after(()=>api.stopAutoSync());
  return {api,ports,storage,values,model,messages,fail:value=>{failure=value},afterCommit:fn=>{afterCommit=fn},statusRenders:()=>statusRenders,leases:()=>leaseClaims,counts:()=>({resets,commits,providerRuns})};
}

test('blocked preferences keep Credit usable, pause automation and report the separate failure',async t=>{
  const f=fixture(t);f.fail('read');
  const ui=f.api.creditSyncUiState();
  assert.equal(ui.autoEnabled,false);assert.ok(ui.preferenceWarning);assert.equal(ui.error,'');
  assert.equal(creditSyncHeadlineState(ui,{sync:f.model.state.creditSync}).tone,'warn');
  assert.match(creditSyncDiagnosticsMarkup(ui,{sync:f.model.state.creditSync}),/CREDIT_PREFERENCES_UNAVAILABLE/);
  await f.api.startAutoSync();assert.equal(f.counts().providerRuns,0);
  assert.equal(f.model.state.notes[0].id,'retained');
});

test('a failed background preference read repaints the status once without repeated read/render loops',async t=>{
  const f=fixture(t);f.fail('read');await f.api.startAutoSync();
  assert.equal(f.statusRenders(),1,'the mounted status must expose the newly paused automation');
  f.api.creditSyncUiState();await f.api.startAutoSync();assert.equal(f.statusRenders(),1);
});

for(const enabled of [false,true])test(`failed ${enabled?'enable':'disable'} is reported; automation stays stopped until an explicit successful enable`,async t=>{
  const f=fixture(t);f.values.set('netunim_kupa_credit_auto_daily_v1',enabled?'0':'1');f.fail('write');
  assert.equal(f.api.setCreditAutoRefresh(enabled),false);
  assert.equal(f.api.creditSyncUiState().autoEnabled,false);assert.equal(f.api.creditSyncUiState().preferenceWarningCode,'CREDIT_PREFERENCES_QUOTA');
  f.fail(null);await f.api.startAutoSync();assert.equal(f.counts().providerRuns,0,'storage recovery alone must not resume the suspended job');
  assert.equal(f.api.setCreditAutoRefresh(true),true);assert.equal(f.api.creditSyncUiState().preferenceWarning,'');assert.equal(f.api.creditSyncUiState().autoEnabled,true);
  assert.equal(f.values.get('netunim_kupa_credit_auto_daily_v1'),'1');assert.equal(f.messages.length,1);
});

test('failed mode selection retains the previously saved mode and reports the failure',t=>{
  const f=fixture(t);f.values.set('netunim_kupa_credit_auto_mode_v1','forecast');f.fail('write');
  assert.equal(f.api.setCreditAutoMode('quick'),false);const ui=f.api.creditSyncUiState();assert.equal(ui.autoMode,'forecast');assert.equal(ui.autoEnabled,false);
  assert.ok(ui.preferenceWarning);assert.deepEqual(f.counts(),{resets:0,commits:0,providerRuns:0});
});

test('failed durable attempt prevents automatic provider entry and lease acquisition, while manual refresh remains available',async t=>{
  const f=fixture(t);f.fail('write');const before=structuredClone(f.model.state);
  assert.equal(await f.api.refreshCreditSync({auto:true}),false);assert.equal(f.counts().providerRuns,0);assert.equal(f.counts().commits,0);assert.deepEqual(f.model.state,before);
  assert.equal(f.leases(),0);
  assert.equal(f.api.creditSyncUiState().error,'');assert.ok(f.api.creditSyncUiState().preferenceWarning);
  await f.api.refreshCreditSync();assert.equal(f.counts().providerRuns,1);assert.equal(f.counts().commits,1);
});

test('disable can still be saved when preference reads are blocked; the separate warning remains truthful',t=>{
  const f=fixture(t);f.fail('read');assert.equal(f.api.setCreditAutoRefresh(false),true);
  assert.equal(f.values.get('netunim_kupa_credit_auto_daily_v1'),'0');assert.equal(f.api.creditSyncUiState().autoEnabled,false);assert.ok(f.api.creditSyncUiState().preferenceWarning);
});

test('a complete explicit reset clears the old preference failure while keeping automation disabled',async t=>{
  const f=fixture(t);f.fail('read');assert.ok(f.api.creditSyncUiState().preferenceWarning);f.fail(null);
  await f.api.resetCreditSync();const ui=f.api.creditSyncUiState();assert.equal(ui.autoEnabled,false);assert.equal(ui.preferenceWarning,'');assert.equal(ui.preferenceWarningCode,'');
});

test('malformed attempt does not schedule a new provider action or silently delete the value',async t=>{
  const f=fixture(t),key='netunim_kupa_credit_auto_attempt_v1';f.values.set(key,'not-a-time');
  await f.api.startAutoSync();assert.equal(f.counts().providerRuns,0);assert.equal(f.values.get(key),'not-a-time');
  assert.equal(f.api.creditSyncUiState().preferenceWarningCode,'CREDIT_PREFERENCES_INVALID');assert.equal(f.api.setCreditAutoRefresh(true),false);
});

test('preference failure during Finance follow-up drains the confirmed write and preserves its identity',async t=>{
  const f=fixture(t);f.afterCommit(()=>f.fail('read'));await f.api.refreshCreditSync({auto:true});
  assert.equal(f.counts().commits,1);assert.equal(f.api.creditSyncUiState().error,'');assert.ok(f.api.creditSyncUiState().preferenceWarning);
  assert.ok(f.model.state.creditSync.profiles.some(profile=>profile.profileId==='retained-provider'));
  assert.deepEqual(f.model.state.notes,[{id:'retained',content:'unchanged'}]);
});

test('preference quota after Bridge reset cannot interrupt the confirmed Finance reset',async t=>{
  const f=fixture(t);f.fail('write');await f.api.resetCreditSync();
  assert.deepEqual(f.counts(),{resets:1,commits:1,providerRuns:0});
  assert.deepEqual(f.model.state.creditSync.profiles,[]);
  const ui=f.api.creditSyncUiState();assert.equal(ui.autoEnabled,false);assert.ok(ui.preferenceWarning);assert.equal(ui.error,'');
  assert.deepEqual(f.model.state.notes,[{id:'retained',content:'unchanged'}]);
});
