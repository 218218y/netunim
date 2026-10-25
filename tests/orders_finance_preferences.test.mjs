import test from 'node:test';
import assert from 'node:assert/strict';
import {createAutomationPreferences} from '../netunim-orders/site/assets/js/domains/finance/automation-preferences.js';
import {createOrdersFinanceAutomation} from '../netunim-orders/site/assets/js/domains/finance/automation.js';
import {createFinanceBridgeIntegration} from '../netunim-orders/site/assets/js/integrations/bank-bridge.js';
import {bankHeadlineState,bankSyncPanelMarkup} from '../netunim-orders/site/assets/js/domains/finance/bank-connection-view.js';
import {creditHeadlineState,creditDiagnostics} from '../netunim-orders/site/assets/js/domains/finance/credit-status-view.js';

function fixture(){
  const values=new Map(),failures=[],jobs=new Map(),calls=[];let failure=null,id=0;
  const storage={getItem:key=>{if(failure?.operation==='read'&&key===failure.key)throw failure.error;return values.get(key)??null},setItem:(key,value)=>{if(failure?.operation==='write'&&key===failure.key)throw failure.error;values.set(key,value)},removeItem:key=>values.delete(key)};
  values.set('netunim_kupa_bank_bridge_token_v1','synthetic-pairing');
  const preferences=createFinanceBridgeIntegration({platform:{preferences:storage,clock:{now:()=>1000},fetchRequest:()=>assert.fail('provider request'),timers:{setTimeout(){},clearTimeout(){}},createAbortController:()=>new AbortController()}});
  const owner=createAutomationPreferences({preferences,onFailure:(kind,error)=>{failures.push({kind,...error});return undefined}});
  const scheduler=createOrdersFinanceAutomation({preferences,access:{primary:()=>true,authenticated:()=>true,online:()=>true,busy:()=>false,capture:()=>()=>{}},readLastSyncAt:()=>null,commands:{bank:async()=>{calls.push('bank')},credit:async()=>{calls.push('credit')}},timers:{setTimeout:fn=>{jobs.set(++id,fn);return id},clearTimeout:handle=>jobs.delete(handle)}});
  return {owner,scheduler,values,failures,jobs,calls,inject:(operation,key,name='SecurityError')=>{failure={operation,key,error:new DOMException('sensitive details',name)}},restore:()=>{failure=null}};
}
const key=(kind,setting)=>`netunim_orders_${kind}_auto_${setting}_v1`;
test('terminal scheduler disposal closes every mutation and stale callback without changing saved preferences',async()=>{
  const f=fixture();f.scheduler.startAutoSync();
  const callbacks=[...f.jobs.values()],saved=[...f.values];
  assert.equal(f.scheduler.dispose(),true);assert.equal(f.scheduler.dispose(),false);
  assert.equal(f.jobs.size,0);
  assert.equal(f.scheduler.startAutoSync(),false);assert.equal(f.scheduler.resumeAutoSync(),false);
  assert.equal(f.scheduler.setBankAutoEnabled(true),false);assert.equal(f.scheduler.setCreditAutoEnabled(false),false);
  assert.equal(f.scheduler.setCreditAutoMode('quick'),false);
  for(const kind of ['bank','credit']){
    assert.equal(f.scheduler.markAttempt(kind),false);assert.equal(f.scheduler.allowed(kind),false);
  }
  f.scheduler.scheduleBankAuto();f.scheduler.scheduleCreditAuto();
  for(const run of callbacks)run();
  assert.equal(await f.scheduler.maybeAutoRefreshBank(),false);assert.equal(await f.scheduler.maybeAutoRefreshCredit(),false);
  assert.deepEqual([...f.values],saved);assert.equal(f.jobs.size,0);assert.deepEqual(f.calls,[]);
});
for(const kind of ['bank','credit']){
  test(`${kind} failed disable cannot resume on login/read/reconnect without explicit permission`,async()=>{
    const f=fixture();f.scheduler.startAutoSync();assert.equal(f.jobs.size,2);
    f.inject('write',key(kind,'daily'),'QuotaExceededError');assert.equal(f.scheduler[kind==='bank'?'setBankAutoEnabled':'setCreditAutoEnabled'](false),false);
    assert.equal(f.scheduler.preferenceState()[kind+'AutoEnabled'],false);assert.equal(f.jobs.size,1);
    f.restore();f.scheduler.stopAutoSync();f.scheduler.startAutoSync();assert.equal(f.jobs.size,1);
    assert.equal(await f.scheduler[kind==='bank'?'maybeAutoRefreshBank':'maybeAutoRefreshCredit'](),false);assert.deepEqual(f.calls,[]);
    assert.equal(f.scheduler[kind==='bank'?'setBankAutoEnabled':'setCreditAutoEnabled'](true),true);assert.equal(f.jobs.size,2);
    assert.equal(f.scheduler.preferenceState()[kind+'AutomationWarning'],'');f.scheduler.stopAutoSync();assert.equal(f.jobs.size,0);
  });
  test(`${kind} failed attempt is redacted, retains raw settings and leaves the other owner eligible`,()=>{
    const f=fixture(),before=[...f.values];f.inject('write',key(kind,'attempt'),'QuotaExceededError');
    assert.equal(f.owner.markAttempt(kind),false);assert.deepEqual([...f.values],before);
    const view=f.owner.view();assert.equal(view[kind+'AutoEnabled'],false);assert.equal(view[kind==='bank'?'creditAutoEnabled':'bankAutoEnabled'],true);
    assert.equal(view[kind+'AutomationWarningCode'],'FINANCE_PREFERENCES_QUOTA');assert.equal(JSON.stringify(f.failures).includes('sensitive'),false);
    f.restore();assert.equal(f.owner.markAttempt(kind),false);assert.equal(f.owner.setEnabled(kind,true),true);assert.equal(f.owner.markAttempt(kind),true);
  });
  for(const raw of ['not-a-time','-1','1.5','9007199254740992'])test(`${kind} malformed attempt ${raw} is retained and cannot authorize automatic entry`,()=>{
    const f=fixture();f.values.set(key(kind,'attempt'),raw);assert.equal(f.owner.eligible(kind),null);
    assert.equal(f.owner.view()[kind+'AutomationWarningCode'],'FINANCE_PREFERENCES_INVALID');assert.equal(f.values.get(key(kind,'attempt')),raw);
  });
}
test('credit mode write failure retains the last saved mode and does not clear a suspension',()=>{
  const f=fixture();f.values.set(key('credit','mode'),'forecast');assert.equal(f.owner.view().creditAutoMode,'forecast');
  f.inject('write',key('credit','mode'));assert.equal(f.owner.setMode('quick'),false);assert.equal(f.owner.view().creditAutoMode,'forecast');
  f.restore();assert.equal(f.owner.setMode('quick'),true);assert.equal(f.owner.view().creditAutoMode,'quick');assert.equal(f.owner.view().creditAutoEnabled,false);
});
test('missing token storage suspends both resources without manufacturing a new token',()=>{
  const f=fixture();f.inject('read','netunim_kupa_bank_bridge_token_v1');const view=f.owner.view();
  assert.equal(view.bridgeTokenConfigured,false);assert.equal(view.bankAutoEnabled,false);assert.equal(view.creditAutoEnabled,false);assert.equal(f.values.get('netunim_kupa_bank_bridge_token_v1'),'synthetic-pairing');
});
test('Finance preference projection never publishes the computer pairing token',()=>{
  const f=fixture(),view=f.owner.view();assert.equal(view.bridgeTokenConfigured,true);
  assert.equal(JSON.stringify(view).includes('synthetic-pairing'),false);assert.equal(JSON.stringify(view).includes('getBridgeToken'),false);
});
test('automatic warning remains independent of a confirmed latest Finance result',()=>{
  const f=fixture();f.inject('write',key('bank','attempt'));f.owner.markAttempt('bank');f.inject('write',key('credit','attempt'));f.owner.markAttempt('credit');
  const snapshot={...f.owner.view(),bankLastSyncAt:'2026-10-11T10:00:00Z',creditLastSyncAt:'2026-10-11T10:00:00Z',bankStatus:{configured:true},creditSync:{profiles:[],errors:[]}};
  assert.equal(bankHeadlineState(snapshot).title,'אוטומציה מושהית');assert.equal(creditHeadlineState(snapshot).title,'אוטומציה מושהית');
  assert.match(bankSyncPanelMarkup(snapshot),/FINANCE_PREFERENCES_UNAVAILABLE/);assert.match(creditDiagnostics(snapshot),/FINANCE_PREFERENCES_UNAVAILABLE/);
});
test('1000 stop/start cycles keep a failed owner suspended with no stale callback starts',async()=>{
  const f=fixture();f.scheduler.startAutoSync();const stale=[...f.jobs.values()];f.inject('write',key('bank','daily'));f.scheduler.setBankAutoEnabled(false);f.restore();
  for(let i=0;i<1000;i++){f.scheduler.stopAutoSync();f.scheduler.startAutoSync();assert.equal(f.jobs.size,1)}
  for(const run of stale)run();await Promise.resolve();assert.deepEqual(f.calls,[]);f.scheduler.stopAutoSync();assert.equal(f.jobs.size,0);
});
