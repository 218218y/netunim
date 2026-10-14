import test from 'node:test';
import assert from 'node:assert/strict';
import {createKupaBankCapability} from '../netunim-kupa/site/assets/js/composition/bank.js';
import {createBankActions} from '../netunim-kupa/site/assets/js/ui/action-packs/bank.js';
import {createDomainsBankView} from '../netunim-kupa/site/assets/js/domains/bank/view.js';
import {createBankConnectionForms} from '../netunim-kupa/site/assets/js/domains/bank/connection-forms.js';

const noop = () => {};
function gate() { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise, resolve}; }
function fixture(t) {
  const model = {state:{bank:{},checks:[]}}, jobs = new Map(), events = [], held = gate(), entered = gate();
  let next = 0, cleanup = 0;
  const timers = {setTimeout(run, delay) { jobs.set(++next, {run, delay}); return next; }, clearTimeout:id => jobs.delete(id)};
  t.mock.method(globalThis, 'setTimeout', timers.setTimeout); t.mock.method(globalThis, 'clearTimeout', timers.clearTimeout);
  const unexpected = () => assert.fail('composition performed IO or used unhydrated state');
  const bridge = {status:async()=>({bridgeVersion:74,configured:true}),getBridgeToken:() => 'fixture', autoEnabled:() => true, autoAttemptDelayMs:() => 0,
    bankDiagnostics:async () => { entered.resolve(); await held.promise; return {available:true,filename:'fixture.json',data:{version:1}}; }};
  const cloud = Object.fromEntries(['refreshFinance','claimLease','releaseLease','saveSnapshot',
    'syncTransactions','readTransactions','readTransactionSnapshot','acknowledgeMissing','syncImages','downloadImage'].map(name => [name, unexpected]));
  const persistence = {save:unexpected,recover:unexpected};
  const readout = {balance:unexpected,forecast:unexpected,observedCheckSequence:() => 7};
  const cap = createKupaBankCapability({model, session:{backendReady:true}, bridge,
    authority:{scope:{capture:() => noop,captureRead:() => noop}, automaticAccess:() => 'local:fixture'},
    checks:{hasLocalWork:unexpected,sync:unexpected,save:unexpected}, cloud,
    persistence, readout,
    revisions:{touchData:unexpected,touchDisplay:unexpected},
    platform:{timers,effects:{saveJson:() => events.push('download'),dispose:() => { cleanup++; return true; }}},
  });
  const ui = {currentPage:'bank',bankSearchValue:''};
  const view = {ui, modal:{modal:unexpected,closeModal:unexpected}, date:{dateEditorMarkup:unexpected},
    toast:message => events.push(message), render:() => events.push('render'), runFinance:unexpected, importConnections:{commands:{importConnections:unexpected},runtime:{isPending:()=>false,drain:async()=>{},dispose:()=>true}}};
  t.after(() => { held.resolve(); cap.runtime.dispose(); });
  return {cap, model, ui, cloud, bridge, persistence, readout, events, view, jobs, held, entered, cleanup:() => cleanup};
}

test('Bank construction and binding are inert, validated and do not expose internals', t => {
  const f = fixture(t);
  assert.throws(() => f.cap.assertReady(), /ui_not_bound/);
  assert.throws(() => f.cap.bindUi({...f.view,modal:{}}), /modal_required/);
  f.cap.bindUi(f.view);
  assert.equal(f.cap.assertReady(), true);
  assert.throws(() => f.cap.bindUi(f.view), /already_bound/);
  assert.equal('controller' in f.cap, false); assert.equal('view' in f.cap, false);
  assert.equal('commitBankSnapshot' in f.cap.commands, false);
  assert.equal(f.jobs.size, 0); assert.deepEqual(f.events, []);
  assert.deepEqual(f.model.state, {bank:{},checks:[]});
  assert.equal(typeof f.cap.actionPack().actions['import-finance-connections'], 'function');
});

for (const operation of ['stop','dispose']) test(`Bank ${operation} drains a held provider result with the existing ${operation === 'stop' ? 'valid' : 'closed'} publication scope`, async t => {
  const f = fixture(t), provider = gate(), entered = gate();
  f.cap.bindUi(f.view);
  let writes = 0, releases = 0;
  f.cloud.claimLease = async () => ({acquired:true,localOnly:true});
  f.cloud.refreshFinance = async () => ({verified:true,state:f.model.state});
  f.cloud.releaseLease = async (_kind,_token,{assertCurrent}) => { assertCurrent(); releases++; return true; };
  f.bridge.markAutoAttempt = noop;
  f.bridge.fetchBalance = async () => { entered.resolve(); return provider.promise; };
  f.persistence.save = async () => { writes++; return true; };
  // Rebind neither ports nor owners: the capability keeps focused injected ports.
  const pending = f.cap.commands.refreshBankBalance({auto:true});
  await entered.promise;
  assert.equal(f.cap.runtime.isPending(),true,'Bank pending state must include an accepted financial provider');
  f.cap.runtime[operation]();
  let drained = false;
  const drain = f.cap.runtime.drain().then(() => { drained = true; });
  await Promise.resolve(); assert.equal(drained,false);
  const before = [...f.events];
  provider.resolve({fetchedAt:'2026-10-12T00:00:00Z',balance:500,transactions:[]});
  assert.equal(await pending,operation === 'stop');
  await drain;
  assert.equal(f.cap.runtime.isPending(),false);
  assert.equal(writes,operation === 'stop' ? 1 : 0);
  assert.equal(releases,operation === 'stop' ? 1 : 0);
  if (operation === 'dispose') assert.deepEqual(f.events,before);
});

test('Bank disposal drains held diagnostic work without late downloads or presentation', async t => {
  const f = fixture(t); f.cap.bindUi(f.view); f.model.state = {bank:{},checks:[]};
  const reading = f.cap.commands.exportBankChequeDiagnostics(); await f.entered.promise;
  assert.equal(f.cap.runtime.dispose(), true); assert.equal(f.cap.runtime.dispose(), false);
  let drained = false;
  const drain = f.cap.runtime.drain().then(() => { drained = true; });
  await Promise.resolve(); assert.equal(drained, false);
  f.held.resolve();
  assert.equal(await reading, false); await drain;
  assert.deepEqual(f.events, []); assert.equal(f.cleanup(), 1);
  assert.equal(f.cap.presentation.renderBank(), false);
  assert.equal(await f.cap.commands.refreshBankBalance(), false);
});

test('Bank owns its search/automation deadlines and closes retained actions on disposal', async t => {
  const f = fixture(t); f.cap.bindUi(f.view); f.model.state = {bank:{},checks:[]};
  const actions = f.cap.actionPack().actions;
  actions['bank-search']({value:'active',isConnected:true});
  const search = [...f.jobs.values()][0].run;
  assert.equal(f.ui.bankSearchValue, 'active');
  f.cap.runtime.start(); assert.equal(f.jobs.size, 2);
  const automatic = [...f.jobs.values()].find(job => job.delay === 300).run;
  f.cap.runtime.dispose(); assert.equal(f.jobs.size, 0);
  search(); automatic(); await Promise.resolve();
  assert.equal(actions['bank-search']({value:'closed'}), false);
  assert.equal(f.ui.bankSearchValue, 'active');
  assert.equal(actions['refresh-bank-from-hapoalim']({dataset:{}}), false);
  assert.deepEqual(f.events, []);
});

test('Bank delegated forms pass explicit input and keep credentials outside controller DOM reads', t => {
  const inputs = Object.fromEntries(['bankBridgeTokenInput','bankUserCodeInput','bankPasswordInput',
    'bankBusinessBranchNumberInput','bankBusinessAccountNumberInput','bankHomeBranchNumberInput','bankHomeAccountNumberInput']
    .map((id, index) => [id,{value:index === 0 ? '  paired  ' : `value-${index}`} ]));
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  inputs.bankBridgeCredentialsForm={querySelector:selector=>inputs[selector.slice(1)],addEventListener:noop,removeEventListener:noop};
  Object.defineProperty(globalThis, 'document', {configurable:true,value:{getElementById:id => inputs[id]}});
  t.after(() => { if (previous) Object.defineProperty(globalThis,'document',previous); else delete globalThis.document; });
  let token, credentials;
  const commands={saveBankBridgeToken:value => { token=value; }, configureBankBridge:value => { credentials=value; }};
  const forms=createBankConnectionForms({commands,readPairing:()=>({generation:1}),isActive:()=>true});forms.bind();t.after(()=>forms.runtime.dispose());
  const actions = createBankActions({bankCommands:commands,connectionForms:forms,
    bankPresentation:{},importFinanceConnections:noop,ui:{},toast:noop});
  actions['save-bank-bridge-token']({});
  assert.equal(token,'paired'); assert.equal(inputs.bankBridgeTokenInput.value,'');
  inputs.bankBridgeTokenInput.value='replacement';
  actions['configure-bank-bridge']({});
  assert.deepEqual(credentials,{token:'replacement',userCode:'value-1',password:'value-2',businessBranchNumber:'value-3',
    businessAccountNumber:'value-4',homeBranchNumber:'value-5',homeAccountNumber:'value-6'});
  assert.equal(inputs.bankPasswordInput.value,'value-2');
});

test('Bank image presentation fences a held result before allocating native preview resources', async t => {
  let active = true;
  const entered = gate(), release = gate();
  t.mock.method(URL,'createObjectURL',() => assert.fail('disposed image allocated a URL'));
  const view = createDomainsBankView({isActive:() => active, modal:() => assert.fail('disposed image opened modal'),
    downloadBankChequeImage:async () => { entered.resolve(); await release.promise; return new Blob(['image'],{type:'image/png'}); }});
  const pending = view.openBankChequeImage('2026-10-12','fixture','front');
  await entered.promise; active = false; view.runtime.dispose(); release.resolve();
  assert.equal(await pending,false);
});

test('Bank preview releases an allocated URL when modal construction fails', async t => {
  const urls = new Set();
  t.mock.method(URL,'createObjectURL',() => { urls.add('blob:preview'); return 'blob:preview'; });
  t.mock.method(URL,'revokeObjectURL',url => urls.delete(url));
  const view = createDomainsBankView({modal:() => { throw Error('modal failure'); },
    downloadBankChequeImage:async () => new Blob(['image'],{type:'image/png'})});
  await assert.rejects(view.openBankChequeImage('2026-10-12','fixture','front'),/modal failure/);
  assert.equal(urls.size,0);
});
