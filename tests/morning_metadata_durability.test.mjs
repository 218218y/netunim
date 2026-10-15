import test from 'node:test';
import assert from 'node:assert/strict';
import {createDomainsCustomers} from '../netunim-orders/site/assets/js/domains/customers/composition.js';
import {createMorningMediaComposition} from '../netunim-orders/site/assets/js/composition/morning-media.js';
import {createMorningOperationScope} from '../netunim-orders/site/assets/js/core/morning-operation-scope.js';
import {morningDebtLinksMarkup} from '../netunim-orders/site/assets/js/domains/customers/view.js';

const OP='00000000-0000-4000-8000-000000000001';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}};
function fixture(t){
  const debt={id:'debt-1',amount:100,debtProgress:[{id:`MORNING:${OP}:payment`,source:'morning',kind:'payment',amount:30,createdAt:'2026-10-11T00:00:00Z'}]};
  const model={state:{customerDebts:[debt],customerOrders:[]}},writes=[],calls=[],gate=deferred(),started=deferred();let outcome=false,mutationsAllowed=true;
  const access={account:{owner:'A',epoch:1},storageOwner:'A',readable:true,writable:true};
  const label={textContent:'unresolved'},button={dataset:{morningDebtOperation:OP},isConnected:true,querySelector:()=>label};
  const root={querySelectorAll:()=>button.dataset.morningDebtOperation?[button]:[]};
  const prior=globalThis.document;globalThis.document={querySelector:()=>null,addEventListener(){},contains:()=>true};
  t.after(()=>{if(prior===undefined)delete globalThis.document;else globalThis.document=prior});
  const record=()=>structuredClone(debt);
  const save=(message,options)=>{writes.push(structuredClone(options));started.resolve();return outcome};
  const morningRequest={json:async(action,payload)=>{calls.push(action);assert.equal(action,'status');return {operation:{operation_id:payload.operation_id,state:'created',verified_at:'2026-10-11T01:00:00Z',document_id:'doc-1',document_number:'4001',document_type:400}}},pdf:async()=>assert.fail('no PDF or issuance')};
  const documentMedia=createMorningMediaComposition({request:morningRequest,modal(){},toast(){}});
  const domains=createDomainsCustomers({model,customerUi:{},customerRevision:()=>0,selectors:{customerStats:()=>({})},
    morningOperationScope:createMorningOperationScope({readAccess:()=>access}),morningRequest,documentMedia,
    uiLayout:{},uiModal:{},uiStatus:{toast(){}},uiNavigation:{},uiDateEditor:{},
    storagePersistence:{canMutate:()=>access.writable&&mutationsAllowed,scheduleSave:save,commitSave:async(...args)=>{save(...args);await gate.promise;return outcome}},
  });
  t.after(()=>domains.dispose());
  return {debt,model,button,label,root,writes,calls,gate,started,access,record,hydrate:()=>domains.documentsBrowser.hydrateDebtDocumentLinks(root),setOutcome(value){outcome=value},blockMutations(){mutationsAllowed=false}};
}
test('failed Morning metadata persistence retains its recovery marker and re-persists unchanged staged metadata',async t=>{
  const f=fixture(t),before=f.record();f.gate.resolve();await f.hydrate();
  assert.equal(f.button.dataset.morningDebtOperation,OP,'failed local save must remain retryable');
  assert.match(f.label.textContent,/לא נשמר/);assert.equal(f.debt.morningDocuments[0].documentId,'doc-1');
  f.setOutcome(true);await f.hydrate();assert.equal(f.writes.length,2,'already-staged metadata still requires persistence');
  assert.equal(f.button.dataset.morningDebtOperation,undefined);assert.doesNotMatch(f.label.textContent,/לא נשמר/);
  assert.deepEqual(f.debt.debtProgress,before.debtProgress);assert.equal(f.debt.id,before.id);assert.deepEqual(f.calls,['status']);
  await f.hydrate();assert.equal(f.writes.length,2,'confirmed links do not write on every render');
});
test('Morning hydration does not publish local completion before the commit receipt resolves',async t=>{
  const f=fixture(t);f.setOutcome(true);let finished=false;const work=f.hydrate().then(()=>{finished=true});
  await f.started.promise;
  assert.equal(f.writes.length,1);assert.equal(finished,false);assert.equal(f.button.dataset.morningDebtOperation,OP);
  f.gate.resolve();await work;assert.equal(f.button.dataset.morningDebtOperation,undefined);
});
test('a login change during the metadata commit cannot publish for the new account',async t=>{
  const f=fixture(t);f.setOutcome(true);const work=f.hydrate();await f.started.promise;
  f.access.account.epoch++;f.gate.resolve();await work;
  assert.equal(f.button.dataset.morningDebtOperation,OP);assert.equal(f.label.textContent,'unresolved');
  assert.equal(f.button.dataset.clickArg0,undefined);assert.deepEqual(f.calls,['status']);
});
test('concurrent hydration joins one metadata commit and preserves other customer edits',async t=>{
  const f=fixture(t);f.setOutcome(true);const a=f.hydrate(),b=f.hydrate();await f.started.promise;
  f.debt.note='edited while commit pending';f.gate.resolve();await Promise.all([a,b]);
  assert.equal(f.writes.length,1);assert.equal(f.debt.note,'edited while commit pending');assert.equal(f.button.dataset.morningDebtOperation,undefined);
});
test('rejected commit is observed, visibly unconfirmed and retryable without another provider read',async t=>{
  const f=fixture(t),prior=console.error,errors=[];console.error=(...args)=>errors.push(args);t.after(()=>{console.error=prior});
  const work=f.hydrate();await f.started.promise;f.gate.reject(Error('injected IDB abort'));await work;
  assert.equal(f.button.dataset.morningDebtOperation,OP);assert.match(f.label.textContent,/לא נשמר/);
  assert.equal(errors.length,1);assert.equal(errors[0][0],'morning debt metadata persistence');
});
test('a changed button or deleted debt is not published by an obsolete completion',async t=>{
  const f=fixture(t);f.setOutcome(true);const work=f.hydrate();await f.started.promise;
  f.model.state.customerDebts=[];f.button.dataset.morningDebtOperation='new-operation';f.gate.resolve();await work;
  assert.equal(f.label.textContent,'unresolved');assert.equal(f.button.dataset.morningDebtOperation,'new-operation');
  assert.equal(f.button.dataset.clickArg0,undefined);
});
test('rerendering staged links retains an explicit unsaved marker and the stable operation ID',()=>{
  const debt={morningDocuments:[{operationId:OP,documentId:'doc-1',documentNumber:'4001',documentType:400}]};
  const markup=morningDebtLinksMarkup(debt,()=> 'unconfirmed');
  assert.match(markup,/לא נשמר בחוב/);assert.ok(markup.includes(`data-morning-debt-operation="${OP}"`));
  assert.match(morningDebtLinksMarkup(debt,()=> 'pending'),/שומר פרטים/);
  assert.doesNotMatch(morningDebtLinksMarkup(debt),/data-morning-debt-operation/);
});
test('storage mutation policy rejects metadata staging even while authenticated reads remain allowed',async t=>{
  const f=fixture(t),before=f.record();f.blockMutations();await f.hydrate();
  assert.deepEqual(f.record(),before);assert.equal(f.writes.length,0);assert.equal(f.button.dataset.morningDebtOperation,OP);
  assert.match(f.label.textContent,/לא נשמר/);
});
test('a new login cannot join or have its confirmation cleared by a former login commit',async t=>{
  const f=fixture(t);f.setOutcome(true);const old=f.hydrate();await f.started.promise;
  f.access.account.epoch++;const current=f.hydrate();f.gate.resolve();await Promise.all([old,current]);
  assert.equal(f.writes.length,2);assert.equal(f.button.dataset.morningDebtOperation,undefined);
  assert.equal(f.label.textContent,'קבלה 4001');assert.deepEqual(f.calls,['status','status']);
});
