import test from 'node:test';
import assert from 'node:assert/strict';
import {createStoragePersistence} from '../netunim-kupa/site/assets/js/storage/persistence.js';
import {createStoragePending} from '../netunim-kupa/site/assets/js/storage/pending.js';
import {createSyncPending} from '../netunim-kupa/site/assets/js/sync/pending.js';
import {createSyncDocument} from '../netunim-kupa/site/assets/js/sync/document.js';
import {createSyncMerge} from '../netunim-kupa/site/assets/js/sync/merge.js';
import {createStateNormalization} from '../netunim-kupa/site/assets/js/state/normalization.js';
import {createIndexedDbConnection} from '../shared/indexed-db-connection.js';
import {createStorageBrowser as kupaBrowser} from '../netunim-kupa/site/assets/js/storage/browser.js';
import {createStorageBackup} from '../netunim-kupa/site/assets/js/storage/backup.js';
import {createDomainsCashEditor} from '../netunim-kupa/site/assets/js/domains/cash/editor.js';
import {createDomainsExpensesEditor} from '../netunim-kupa/site/assets/js/domains/expenses/editor.js';
import {createDomainsCreditEditor} from '../netunim-kupa/site/assets/js/domains/credit/editor.js';
import {createDomainsRecordsCommands} from '../netunim-kupa/site/assets/js/domains/records/commands.js';
import {BROWSER_STATE_KEY} from '../netunim-kupa/site/assets/js/state/constants.js';
import {configurePerformance,beginMeasure,performanceSummary,clearPerformance} from '../shared/runtime-performance.js';
import {supplierRenderModelData,supplierViewRowsData,balanceRowsData,supplierYearContextData} from '../netunim-orders/site/assets/js/domains/suppliers/model.js';

const noop=()=>{},clone=structuredClone;
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}}
function fixture({send=async body=>({revision:body.p_expected_revision+1,state:body.p_state}),beforeRead=noop}={}){
  const model={},normalizer=createStateNormalization({model});model.state=normalizer.normalizeState({notes:[{id:'A',content:'base'},{id:'B',content:'keep'}]});
  const session={localGeneration:0,dbRevision:10,connectionMode:'supabase',backendReady:true,serverInfo:{},saveQueue:Promise.resolve(),lastSavedSnapshot:JSON.stringify(normalizer.prepareKupaCloudState(model.state))};
  const ls=new Map(),db=new Map(),snapshots=[],sent=[];let stages=0,renders=0;
  globalThis.localStorage={getItem:key=>ls.get(key)??null,setItem:(key,value)=>ls.set(key,value),removeItem:key=>ls.delete(key)};
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});
  const storage=createStoragePending({session,idbPut:async(s,k,v)=>db.set(k,clone(v)),idbGet:async(s,k)=>{await beforeRead();return clone(db.get(k))},idbDelete:async(s,k)=>db.delete(k)});
  const deps={...normalizer,...storage,model,session,tab:{primaryTab:true},files:{},checksSession:{},setSaveStatus:noop,setCloudHeaderStatus:noop,setConnectedStatus:noop,toast:noop,showSecondaryTabGuard:noop,reportError:noop,render:()=>{renders++},backupSnapshotToComputer:async()=>{},persistImmediateBrowserSnapshot:state=>{snapshots.push(clone(state));return true},lastSavedCloudState:()=>JSON.parse(session.lastSavedSnapshot)};
  const merger=createSyncMerge(deps),pending=createSyncPending({...deps,...merger});
  const stageCloudPendingLocal=(...args)=>{stages++;return pending.stageCloudPendingLocal(...args)};
  const document=createSyncDocument({...deps,...merger,...pending,stageCloudPendingLocal,pollSharedChecks:async()=>{},readSupabaseDocument:async()=>null,supaRest:async(path,options)=>{const body=JSON.parse(options.body);sent.push(body);const row=await send(body);return {ok:true,text:async()=>JSON.stringify(row)}}});
  const api=createStoragePersistence({...deps,...merger,stageCloudPendingLocal,persistSupabaseState:document.persistSupabaseState});
  return {model,session,snapshots,sent,api,storage,document,get stages(){return stages},get renders(){return renders}};
}

test('Kupa burst durably stages every edit, sends the latest once, retains explicit deletion, and does not render on an unchanged ACK',async()=>{
  const f=fixture(),promises=[];
  for(let i=1;i<=7;i++){f.model.state.notes[0].content=String(i);if(i===3)f.model.state.notes.pop();promises.push(f.api.saveState('',i===3?{deleteIntents:{notes:['B']}}:{}));assert.equal(f.snapshots.at(-1).notes[0].content,String(i))}
  assert.equal(f.stages,7,'each action stages synchronously');
  assert.ok((await Promise.all(promises)).every(Boolean));
  assert.equal(f.sent.length,1);assert.equal(f.stages,7,'writer reuses the durable record');
  assert.equal(f.sent[0].p_state.notes[0].content,'7');assert.deepEqual(f.sent[0].p_delete_intents,{notes:['B']});
  assert.equal(f.renders,0);assert.equal(await f.storage.getCloudPending(),null);
});

test('Kupa changes during an in-flight RPC coalesce without overwriting newer local edits',async()=>{
  const gate=deferred(),started=deferred();let calls=0;
  const f=fixture({send:async body=>{if(++calls===1){started.resolve();await gate.promise}return {revision:body.p_expected_revision+1,state:body.p_state}}});
  f.model.state.notes[0].content='first';const saving=f.api.saveState();await started.promise;
  for(let i=2;i<=7;i++){f.model.state.notes[0].content=String(i);f.api.saveState()}
  gate.resolve();assert.equal(await saving,true);
  assert.equal(f.sent.length,2);assert.equal(f.sent.at(-1).p_state.notes[0].content,'7');
  assert.equal(f.model.state.notes[0].content,'7');assert.equal(await f.storage.getCloudPending(),null);
  assert.notEqual(f.sent[0].p_operation_id,f.sent[1].p_operation_id);assert.equal(f.sent[1].p_expected_revision,11);
});

test('Kupa edit during outbox read is acknowledged with its own generation, without a duplicate send',async()=>{
  let edit=null;
  const f=fixture({beforeRead:()=>{if(edit){const fn=edit;edit=null;fn()}}});
  edit=()=>{f.model.state.notes[0].content='during-read';f.api.saveState()};
  assert.equal(await f.api.saveState(),true);
  assert.equal(f.sent.length,1);assert.equal(f.sent[0].p_state.notes[0].content,'during-read');assert.equal(f.stages,2);
  assert.equal(await f.storage.getCloudPending(),null);
});

test('Kupa offline burst stays durable and resumes from the latest pending record',async()=>{
  const f=fixture();navigator.onLine=false;
  for(let i=0;i<5;i++){f.model.state.notes[0].content=String(i);f.api.saveState()}
  assert.equal(await f.session.saveQueue,false);assert.equal(f.sent.length,0);
  assert.equal(f.renders,0,'offline persistence updates sync status without rebuilding an unchanged business view');
  assert.equal((await f.storage.getCloudPending()).snapshot.notes[0].content,'4');
  navigator.onLine=true;assert.equal(await f.document.persistSupabaseState(f.model.state,'',f.session.localGeneration),true);
  assert.equal(f.sent.length,1);assert.equal(f.sent[0].p_state.notes[0].content,'4');assert.equal(f.stages,5);assert.equal(f.renders,0);
});

test('Kupa authoritative changes still render, while plain ACKs preserve the screen',async()=>{
  const f=fixture({send:async body=>{const state=clone(body.p_state);state.notes[1].content='remote';return {revision:11,state}}});
  assert.equal(await f.api.saveState(),true);assert.equal(f.renders,1);assert.equal(f.model.state.notes[1].content,'remote');
});

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

test('Kupa cloud writer waits for the existing file queue when storage mode changes',async()=>{
  const f=fixture(),fileSave=deferred();f.session.saveQueue=fileSave.promise;
  const saving=f.api.saveState();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.sent.length,0);assert.equal(f.stages,1,'durability does not wait for the old file queue');
  fileSave.resolve(true);assert.equal(await saving,true);assert.equal(f.sent.length,1);
});

test('Kupa ACK still applies normalization even when the canonical cloud projection is unchanged',async()=>{
  const f=fixture();f.model.state.cash.push({id:'C',date:'2026-09-18',type:'הכנסה',description:'cash',amount:'10'});
  assert.equal(await f.api.saveState(),true);assert.equal(f.model.state.cash[0].amount,10);assert.equal(f.renders,1);
});

test('Kupa writer normalizes legacy durable snapshots once before sending without restaging them',async()=>{
  const f=fixture(),legacy=clone(f.model.state);delete legacy.rights;delete legacy.cashflowSettings;
  await f.storage.putCloudPending({schemaVersion:4,domain:'kupa',documentName:'main',operationId:'legacy',generation:1,mutationSeq:1,baseRevision:10,baseState:legacy,snapshot:legacy,updatedAt:new Date().toISOString()});
  f.session.localGeneration=1;
  assert.equal(await f.document.persistSupabaseState(legacy,'',1),true);assert.equal(f.stages,0);
  assert.deepEqual(f.sent[0].p_state.rights,[]);assert.equal('checks' in f.sent[0].p_state,false);assert.equal('creditSync' in f.sent[0].p_state,false);
});

test('snapshot sequence reads persisted metadata once, verifies every write, and invalidates on another tab write',async t=>{
  const ls=new Map([[BROWSER_STATE_KEY,JSON.stringify({snapshotSeq:50})]]);let reads=0,storageEvent;
  const previous=globalThis.addEventListener;t.after(()=>{globalThis.addEventListener=previous});
  globalThis.addEventListener=(type,handler)=>{if(type==='storage')storageEvent=handler};
  globalThis.localStorage={getItem:key=>{reads++;return ls.get(key)??null},setItem:(key,value)=>ls.set(key,value)};
  const session={},files={},api=kupaBrowser({model:{state:{}},session,files,normalizeState:clone,idbPut:async()=>{},idbGet:async()=>null});
  assert.equal(api.persistImmediateBrowserSnapshot({value:1}),true);assert.equal(api.persistImmediateBrowserSnapshot({value:2}),true);
  assert.equal(reads,3,'one sequence read plus two read-back verifications');assert.equal(session.localSnapshotSeq,52);
  ls.set(BROWSER_STATE_KEY,JSON.stringify({snapshotSeq:90}));storageEvent({key:BROWSER_STATE_KEY});
  api.persistImmediateBrowserSnapshot({value:3});assert.equal(session.localSnapshotSeq,91);assert.equal(reads,5);
  await files.browserStateWritePromise;
});

test('normalized snapshot fast path produces identical isolated browser and cloud copies',async()=>{
  const model={},normalizer=createStateNormalization({model});model.state=normalizer.normalizeState({notes:[{id:'A',content:'original'}]});
  const canonical=clone(model.state),cloud=normalizer.prepareKupaCloudState(canonical,{normalized:true});
  assert.deepEqual(cloud,normalizer.prepareKupaCloudState(model.state));cloud.notes[0].content='changed';assert.equal(canonical.notes[0].content,'original');
  globalThis.localStorage={getItem:()=>null};const browser=kupaBrowser({model,session:{},files:{},normalizeState:normalizer.normalizeState});
  const record=browser.browserStateRecord(canonical,10,{normalized:true});assert.deepEqual(record.state,model.state);
  record.state.notes[0].content='changed';assert.equal(canonical.notes[0].content,'original');
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
