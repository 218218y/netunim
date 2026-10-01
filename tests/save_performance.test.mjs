import test from 'node:test';
import assert from 'node:assert/strict';
import {createStateNormalization} from '../netunim-kupa/site/assets/js/state/normalization.js';
import {createIndexedDbConnection} from '../shared/indexed-db-connection.js';
import {createStorageBrowser as kupaBrowser} from '../netunim-kupa/site/assets/js/storage/browser.js';
import {createStorageBackup} from '../netunim-kupa/site/assets/js/storage/backup.js';
import {createDomainsCashEditor} from '../netunim-kupa/site/assets/js/domains/cash/editor.js';
import {createDomainsExpensesEditor} from '../netunim-kupa/site/assets/js/domains/expenses/editor.js';
import {createDomainsCreditEditor} from '../netunim-kupa/site/assets/js/domains/credit/editor.js';
import {createDomainsRecordsCommands} from '../netunim-kupa/site/assets/js/domains/records/commands.js';
import {configurePerformance,beginMeasure,performanceSummary,clearPerformance} from '../shared/runtime-performance.js';
import {supplierRenderModelData,supplierViewRowsData,balanceRowsData,supplierYearContextData} from '../netunim-orders/site/assets/js/domains/suppliers/model.js';

const noop=()=>{},clone=structuredClone;

test('Kupa local mutation owners refresh their own view without relying on persistence renders',async t=>{
  const previousDocument=globalThis.document;t.after(()=>{globalThis.document=previousDocument});
  const fields=new Map(),field=(id,value)=>fields.set(id,{value,String(){return this.value}}).get(id);
  globalThis.document={getElementById:id=>fields.get(id)};
  let saves=0,cashRenders=0,creditRenders=0,closed=0;
  const common={armModalDraftGuard:noop,modal:noop,deleteRecord:noop,saveState:()=>{saves++},toast:message=>{throw new Error(message)},closeModal:()=>{closed++},dateEditorMarkup:noop};

  field('mType','הכנסה');field('mDate','2026-09-18');field('mDesc','Cash');field('mAmount','120');field('mNote','note');
  const cashModel={state:{cash:[],rights:[]}},cash=createDomainsCashEditor({...common,model:cashModel,renderCash:()=>{cashRenders++}});
  cash.saveCash('');
  assert.equal(cashModel.state.cash.length,1);assert.equal(cashModel.state.cash[0].amount,120);assert.equal(cashRenders,1);

  field('eDesc','Rent');field('eAccount','עסקי');field('eAmount','50');field('eDate','2026-09-18');field('eType','חיוב קבוע');field('eRecurring','כן');field('eActive','כן');field('eNote','');
  const expenseModel={state:{expenses:[]}},expenses=createDomainsExpensesEditor({...common,model:expenseModel,renderCredit:()=>{creditRenders++}});
  expenses.saveExpense('');assert.equal(expenseModel.state.expenses.length,1);assert.equal(creditRenders,1);

  field('cAccount','עסקי');field('cOwner','Owner');field('cCard','VISA');field('cDesc','Legacy');field('cTx','2026-09-18');field('cTotal','90');field('cParts','1');field('cFirst','2026-10-10');field('cActive','כן');field('cNote','');
  const creditModel={state:{credits:[{id:'CR1',createdAt:'2026-01-01'}],cards:[],creditSync:{}}},credit=createDomainsCreditEditor({...common,model:creditModel,nextChargeDate:noop,setDateValue:noop,renderCredit:()=>{creditRenders++}});
  credit.saveCredit('CR1');assert.equal(creditModel.state.credits[0].totalAmount,90);assert.equal(creditRenders,2);

  const deletedModel={state:{cash:[{id:'C1'}],checks:[]}},rendered=[];
  const records=createDomainsRecordsCommands({model:deletedModel,saveState:()=>{saves++},saveChecksState:noop,closeModal:()=>{closed++},confirmDialog:async()=>true,renderCollection:name=>rendered.push(name)});
  assert.equal(await records.deleteRecord('cash','C1'),true);assert.deepEqual(rendered,['cash']);assert.equal(deletedModel.state.cash.length,0);
  assert.equal(saves,4);assert.equal(closed,4);
});

test('supplier render model groups once, preserves financial/year semantics and sees subsequent in-place edits',()=>{
  const state={suppliers:Array.from({length:100},(_,i)=>({id:String(i)})),transactions:Array.from({length:10000},(_,i)=>({id:'T'+i,supplierId:String(i%100),sequence:10000-i,debit:i/100,credit:i%3,yearEnd:i<100?2025:null,supplied:i%2===0?false:true,invoiceReceived:true,signed:true}))};
  let scans=0;const iterator=state.transactions[Symbol.iterator].bind(state.transactions);state.transactions[Symbol.iterator]=function(){scans++;return iterator()};
  const derived=supplierRenderModelData(state);assert.equal(scans,1);
  for(const supplier of state.suppliers){assert.deepEqual(derived.get(supplier.id).balances,balanceRowsData(state,supplier.id));assert.deepEqual(derived.get(supplier.id).context,supplierYearContextData(state,supplier.id))}
  for(const year of ['current','all','2025'])for(const filter of ['all','pending','invoice'])assert.deepEqual(supplierViewRowsData(state,['99','0'],year,filter,derived),supplierViewRowsData(state,['99','0'],year,filter));
  const before=derived.get('0').balance;state.transactions[0].credit+=123;
  assert.equal(supplierRenderModelData(state).get('0').balance,before+123);
});

test('IndexedDB connection shares concurrent opens and recovers from failure, versionchange and unexpected close',async()=>{
  let opens=0,closes=0,fail=true;
  globalThis.indexedDB={open:()=>{opens++;const request={};queueMicrotask(()=>{if(fail){request.error=new Error('unavailable');request.onerror()}else{request.result={close:()=>{closes++}};request.onsuccess()}});return request}};
  const open=createIndexedDbConnection('test',2,noop);
  await assert.rejects(open(),/unavailable/);fail=false;
  const [a,b]=await Promise.all([open(),open()]);assert.equal(a,b);assert.equal(opens,2);
  a.onversionchange();assert.equal(closes,1);const c=await open();assert.notEqual(a,c);
  c.onclose();assert.notEqual(await open(),c);assert.equal(opens,4);
});

test('V2 snapshot sequence never reads or writes the legacy full-state cache',()=>{
  let reads=0,writes=0;const sequences=[];
  globalThis.localStorage={getItem:()=>{reads++;return null},setItem:()=>{writes++}};
  const session={localSnapshotSeq:50},files={},storageV2={cutoverActive:true,persist:(_state,_options,metadata)=>{sequences.push(metadata.snapshotSeq);return {handled:true,emergencyDurable:true,committed:Promise.resolve()}}};
  const api=kupaBrowser({storageV2,model:{state:{}},session,files,normalizeState:clone,idbGet:async()=>null});
  assert.equal(api.persistImmediateBrowserSnapshot({value:1}),true);assert.equal(api.persistImmediateBrowserSnapshot({value:2}),true);
  api.persistImmediateBrowserSnapshot({value:3});
  assert.deepEqual(sequences,[51,52,53]);assert.equal(reads,0);assert.equal(writes,0);
});

test('normalized cloud projection stays detached without a V1 browser snapshot copy',async()=>{
  const model={},normalizer=createStateNormalization({model});model.state=normalizer.normalizeState({notes:[{id:'A',content:'original'}]});
  const canonical=clone(model.state),cloud=normalizer.prepareKupaCloudState(canonical,{normalized:true});
  assert.deepEqual(cloud,normalizer.prepareKupaCloudState(model.state));cloud.notes[0].content='changed';assert.equal(canonical.notes[0].content,'original');
  const browser=kupaBrowser({model,session:{},files:{},normalizeState:normalizer.normalizeState});
  assert.equal(browser.browserStateRecord,undefined);
});

test('backup ACK fast path skips directory scans but retains the latest payload and rechecks a changed directory',async()=>{
  let scans=0,writes=0;
  const directory=()=>({async *entries(){scans++},getFileHandle:async()=>({}),removeEntry:async()=>{}});
  const model={},normalizer=createStateNormalization({model});model.state=normalizer.normalizeState({notes:[{id:'A',content:'first'}]});
  const files={backupsDirHandle:directory()},session={dbRevision:10,serverInfo:{}};let stored;
  const api=createStorageBackup({files,model,session,...normalizer,writeJsonHandle:async(h,payload)=>{stored=clone(payload);writes++},readJsonHandle:async()=>clone(stored)});
  try{
    assert.ok(await api.backupSnapshotToComputer());const initialScans=scans;assert.equal(writes,1);
    model.state.notes[0].content='second';await api.backupSnapshotToComputer();
    model.state.notes[0].content='latest';await api.backupSnapshotToComputer();
    assert.equal(scans,initialScans);assert.equal(writes,1);assert.equal(files.pendingAutoBackupPayload.notes[0].content,'latest');
    files.backupsDirHandle=directory();assert.ok(await api.backupSnapshotToComputer());assert.ok(scans>initialScans);assert.equal(writes,2);
  }finally{api.clearPendingAutomaticBackup()}
});

test('performance diagnostics are opt-in, bounded and resettable',()=>{
  clearPerformance();beginMeasure('disabled')();assert.deepEqual(performanceSummary(),{});
  configurePerformance(true);for(let i=0;i<150;i++)beginMeasure('sample')();
  assert.equal(performanceSummary().sample.count,120);assert.ok(performanceSummary().sample.p95>=0);
  const finish=beginMeasure('disabled-before-finish');configurePerformance(false);finish();assert.equal(performanceSummary()['disabled-before-finish'],undefined);
  clearPerformance();assert.deepEqual(performanceSummary(),{});
});
