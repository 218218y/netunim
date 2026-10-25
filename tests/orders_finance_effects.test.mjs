import test from 'node:test';
import assert from 'node:assert/strict';
import {createOrdersFinanceControllerFixture as createDomainsFinanceController} from './orders_finance_controller_fixture.mjs';
import {createFinanceBrowserEffects} from '../shared/finance-browser-effects.js';

test('a disposed Finance controller cannot restart automatic timers or write computer preferences',t=>{
  const jobs=new Map();let next=0,writes=0;
  t.mock.method(globalThis,'setTimeout',run=>{jobs.set(++next,run);return next});
  t.mock.method(globalThis,'clearTimeout',id=>jobs.delete(id));
  const controller=createDomainsFinanceController({
    effects:{...createFinanceBrowserEffects(),isOnline:()=>true},tab:{primaryTab:true},checksSession:{},toast:()=>{},
    loadSession:()=>({user:{id:'fixture'}}),
    operationScope:{capture:()=>()=>{},captureRead:()=>()=>{}},
    bridge:{getBridgeToken:()=> 'fixture',bankAutoEnabled:()=>true,creditAutoEnabled:()=>true,creditAutoMode:()=> 'smart',
      setBankAutoEnabled:()=>{writes++},setCreditAutoEnabled:()=>{writes++},setCreditAutoMode:()=>{writes++},
      markBankAttempt:()=>{writes++},markCreditAttempt:()=>{writes++}},
  });
  t.after(()=>controller.runtime.dispose());
  controller.startAutoSync();
  assert.equal(jobs.size,2);
  const staleTimers=[...jobs.values()];
  assert.equal(controller.runtime.dispose(),true);
  assert.equal(jobs.size,0);
  controller.startAutoSync();controller.resumeAutoSync();
  controller.setBankAutoEnabled(true);controller.setCreditAutoEnabled(true);controller.setCreditAutoMode('quick');
  for(const run of staleTimers)run();
  assert.equal(jobs.size,0,'disposal is terminal even when a former start/resume callback survives');
  assert.equal(writes,0,'disposed controller ports cannot persist automatic permission or cooldown changes');
});

for (const kind of ['bank', 'credit']) {
  test(`${kind} diagnostic export failure releases its temporary URL and anchor`, async t => {
    const urls = new Set(), anchors = new Set();
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const anchor = {remove:() => anchors.delete(anchor), click() { throw Error('injected click failure'); }};
    Object.defineProperty(globalThis, 'document', {configurable:true, value:{
      createElement:() => anchor, body:{appendChild:node => anchors.add(node)},
    }});
    t.after(() => { if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; });
    t.mock.method(URL, 'createObjectURL', () => { urls.add('blob:fixture'); return 'blob:fixture'; });
    t.mock.method(URL, 'revokeObjectURL', url => urls.delete(url));
    t.mock.method(globalThis, 'setTimeout', () => 1);
    const result = {available:true, filename:'diagnostic.json', data:{version:1}};
    const controller = createDomainsFinanceController({
      effects:createFinanceBrowserEffects(),
      tab:{primaryTab:true}, checksSession:{}, toast:() => {},
      operationScope:{capture:() => () => {}, captureRead:() => () => {}},
      bridge:{getBridgeToken:() => 'fixture', bankAutoEnabled:() => false,
        creditAutoEnabled:() => false, creditAutoMode:() => 'quick',
        bankDiagnostics:async () => result, creditDataDiagnostics:async () => result},
    });
    assert.equal(await controller[kind === 'bank' ? 'exportBankChequeDiagnostics' : 'exportCreditDataDiagnostics'](), false);
    assert.equal(urls.size, 0, 'a failed click must revoke the already allocated URL');
    assert.equal(anchors.size, 0, 'a failed click must remove the already appended anchor');
  });
}
