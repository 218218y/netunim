import test from 'node:test';
import assert from 'node:assert/strict';
import {withExpectedConsoleErrors} from './helpers/expected-console.mjs';
import {createStorageBrowser as ordersBrowser} from '../netunim-orders/site/assets/js/storage/browser.js';
import {createStorageBrowser as kupaBrowser} from '../netunim-kupa/site/assets/js/storage/browser.js';
import {createStoragePersistence} from '../netunim-orders/site/assets/js/storage/persistence.js';
import {createStateNormalization} from '../netunim-orders/site/assets/js/state/normalization.js';
import {STORAGE_KEY} from '../netunim-orders/site/assets/js/state/constants.js';
const clone=structuredClone,noop=()=>{};
function stores(){const ls=new Map(),db=new Map();let failLS=false,failIDB=false,beforeGet=null,beforeDelete=null;
 globalThis.localStorage={getItem:k=>ls.get(k)??null,setItem:(k,v)=>{if(failLS)throw Error('quota');ls.set(k,v)},removeItem:k=>ls.delete(k)};
 globalThis.indexedDB={open:()=>{const request={};queueMicrotask(()=>{if(failIDB){request.error=Error('idb unavailable');request.onerror();return}request.result={close:noop,transaction:store=>{const tx={objectStore:()=>({put:(value,key)=>{queueMicrotask(()=>{db.set(store+key,clone(value));tx.oncomplete?.()})},get:key=>{const r={};queueMicrotask(()=>{r.result=clone(db.get(store+key));if(beforeGet){const callback=beforeGet;beforeGet=null;callback()}r.onsuccess?.()});return r},delete:key=>{queueMicrotask(()=>{if(beforeDelete){const callback=beforeDelete;beforeDelete=null;callback()}db.delete(store+key);tx.oncomplete?.()})}})};return tx}};request.onsuccess()});return request}};
 return {ls,db,set beforeDelete(callback){beforeDelete=callback},set beforeGet(callback){beforeGet=callback},set failLS(v){failLS=v},set failIDB(v){failIDB=v}};
}
function fixture(){const normalizer=createStateNormalization({}),model={state:normalizer.normalizeState({notes:[{id:'X',content:'base'}]})},session={localGeneration:0,cloudRevision:10,lastCloudState:clone(model.state)},files={};const browser=ordersBrowser({model,session,files,prepareState:clone,prepareCloudState:(value=model.state)=>{const next=clone(value);delete next.checks;return next},normalizeState:normalizer.normalizeState});const persistence=createStoragePersistence({model,session,tab:{primaryTab:true},...browser,cloudEnabled:()=>true,setSave:noop,setCloud:noop,folderSaveTitle:noop});return {browser,persistence,session,model,files}}
const stageFailureDiagnostics=(ls,idb)=>!ls&&idb?[
 ['local snapshot','quota'],
 ['cloud pending cache','quota'],['cloud pending cache','quota'],['cloud pending cache','quota'],
]:ls&&!idb?[
 ['browser state mirror','idb unavailable'],['orders outbox IndexedDB','idb unavailable'],
 ['orders outbox load','idb unavailable'],['orders outbox repair','idb unavailable'],
 ['orders outbox load','idb unavailable'],['orders outbox repair','idb unavailable'],
]:[
 ['local snapshot','quota'],['cloud pending cache','quota'],
 ['browser state mirror','idb unavailable'],['orders outbox IndexedDB','idb unavailable'],
];

for(const [ls,idb] of [[false,true],[true,false],[false,false]])test(`Orders stage before timer: LocalStorage=${ls}, IndexedDB=${idb}`,()=>withExpectedConsoleErrors(stageFailureDiagnostics(ls,idb),async()=>{const store=stores(),f=fixture();store.failLS=!ls;store.failIDB=!idb;f.model.state.notes[0].content='new';f.persistence.scheduleSave();clearTimeout(f.session.saveTimer);await f.session.ordersOutboxCommitPromise?.catch(noop);if(ls||idb){assert.equal((await f.browser.getCloudPending())?.snapshot.notes[0].content,'new');const restart=fixture();assert.equal((await restart.browser.getCloudPending())?.snapshot.notes[0].content,'new')}else{assert.ok(f.session.ordersOutboxCommitPromise,'must attempt outbox even when browser mirror fails');await assert.rejects(f.browser.getCloudPending(),/outbox/)}await f.files.browserStateWritePromise;}));

test('new undurable generation cannot fall back to older durable generation',()=>withExpectedConsoleErrors(stageFailureDiagnostics(false,false),async()=>{const store=stores(),f=fixture();f.persistence.scheduleSave();clearTimeout(f.session.saveTimer);await f.session.ordersOutboxCommitPromise;store.failLS=true;store.failIDB=true;f.model.state.notes[0].content='latest';f.persistence.scheduleSave();clearTimeout(f.session.saveTimer);await f.session.ordersOutboxCommitPromise?.catch(noop);await assert.rejects(f.browser.getCloudPending(),/outbox/);await f.files.browserStateWritePromise}));

for(const app of ['orders','kupa'])test(`${app} browser restart picks sequence despite clock rollback`,async()=>{const store=stores();let f,api,files,session,recordA,recordB;if(app==='orders'){f=fixture();api=f.browser;files=f.files;session=f.session;api.localSnapshot();await files.browserStateWritePromise;recordA=store.ls.get(STORAGE_KEY);f.model.state.notes[0].content='new';api.localSnapshot();await files.browserStateWritePromise;recordB=JSON.parse(store.ls.get(STORAGE_KEY));recordB._meta={...recordB._meta,savedAt:'2000-01-01T00:00:00Z'};for(const [key,row]of store.db)if(row.payload){row.payload=recordB;row.savedAt=Date.parse('2000-01-01');store.db.set(key,row)}const a=JSON.parse(recordA);a._meta={...a._meta,savedAt:'2030-01-01T00:00:00Z'};store.ls.set(STORAGE_KEY,JSON.stringify(a));f=fixture();assert.equal(await f.browser.restoreBrowserStateFallback(),true);assert.equal(f.model.state.notes[0].content,'new');}
 else{files={};session={};let idb;const make=()=>kupaBrowser({model:{state:{}},session,files,normalizeState:clone,idbPut:async(s,k,v)=>{idb=clone(v)},idbGet:async()=>clone(idb)});api=make();recordA=api.browserStateRecord({value:'A'});recordA.savedAt='2030-01-01T00:00:00Z';api.persistBrowserStateSync(recordA);recordB=api.browserStateRecord({value:'B'});recordB.savedAt='2000-01-01T00:00:00Z';idb=recordB;session={};api=make();assert.equal((await api.loadBrowserState()).state.value,'B');await files.browserStateWritePromise;}
});
test('Orders staging cannot advance pending lineage merely because cloud metadata advanced',async()=>{stores();const f=fixture();f.persistence.scheduleSave();clearTimeout(f.session.saveTimer);await f.session.ordersOutboxCommitPromise;f.session.cloudRevision=12;f.session.lastCloudState={...f.session.lastCloudState,businessName:'remote'};f.model.state.notes[0].content='newer';f.persistence.scheduleSave();clearTimeout(f.session.saveTimer);const pending=await f.browser.getCloudPending();assert.equal(pending.baseRevision,10);assert.notEqual(pending.baseState.businessName,'remote');await f.files.browserStateWritePromise});
for(const success of [true,false])test(`manual save awaits durable staging (IndexedDB ${success?'commits':'fails'})`,()=>withExpectedConsoleErrors(success?[
 ['local snapshot','quota'],['cloud pending cache','quota'],['cloud pending cache','quota'],
]:[
 ['local snapshot','quota'],['cloud pending cache','quota'],['browser state mirror','idb unavailable'],
 ['orders outbox IndexedDB','idb unavailable'],['manual durable staging','orders_outbox_persistence_failed'],
],async()=>{const store=stores(),f=fixture();store.failLS=true;store.failIDB=!success;let sends=0;const statuses=[];const api=createStoragePersistence({model:f.model,session:f.session,tab:{primaryTab:true},...f.browser,cloudEnabled:()=>true,cloudHasLocalWork:()=>true,sameBusinessData:()=>false,requestCloudSave:async()=>{assert.equal((await f.browser.getCloudPending()).snapshot.notes[0].content,'base');sends++;return true},setSave:(text)=>statuses.push(text),setCloud:noop,folderSaveTitle:noop,folderBackupAvailable:()=>false,syncFolderAccessButton:noop,loadSession:()=>null,checksHaveLocalWork:()=>false,toast:noop});await api.manualSaveNow();assert.equal(sends,success?1:0);await f.files.browserStateWritePromise}));

test('Orders recovery read cannot repair an older outbox over a mutation staged during its read',async()=>{const store=stores(),f=fixture();f.persistence.scheduleSave();clearTimeout(f.session.saveTimer);await f.session.ordersOutboxCommitPromise;store.beforeGet=()=>{f.model.state.notes[0].content='during-read';f.persistence.scheduleSave();clearTimeout(f.session.saveTimer)};const pending=await f.browser.getCloudPending();assert.equal(pending.snapshot.notes[0].content,'during-read');assert.equal((await fixture().browser.getCloudPending()).snapshot.notes[0].content,'during-read');await f.files.browserStateWritePromise});

test('Orders ACK cleanup cannot erase a mutation staged during IndexedDB deletion',async()=>{const store=stores(),f=fixture();f.persistence.scheduleSave();clearTimeout(f.session.saveTimer);await f.session.ordersOutboxCommitPromise;const acknowledged=f.session.localGeneration;store.beforeDelete=()=>{f.model.state.notes[0].content='during-clear';f.persistence.scheduleSave();clearTimeout(f.session.saveTimer)};assert.equal(await f.browser.clearCloudPending(acknowledged),false);assert.equal((await f.browser.getCloudPending()).snapshot.notes[0].content,'during-clear');assert.equal((await fixture().browser.getCloudPending()).snapshot.notes[0].content,'during-clear');await f.files.browserStateWritePromise});
import {createStorageChecks} from '../netunim-orders/site/assets/js/storage/checks.js';
import {createSyncChecksState} from '../netunim-kupa/site/assets/js/sync/checks-state.js';
import {createStoragePending} from '../netunim-kupa/site/assets/js/storage/pending.js';
import {createSyncPending} from '../netunim-kupa/site/assets/js/sync/pending.js';
for(const domain of ['orders-checks','kupa-checks','kupa'])for(const phase of ['read','delete'])test(`${domain} mutation during outbox ${phase} survives restart`,async()=>{
 stores();const db=new Map();let hook=null;const checks=domain!=='kupa',isOrders=domain==='orders-checks';
 function fixture(){const session={localGeneration:1,dbRevision:10},checksSession={checksGeneration:1,sharedChecksGeneration:1},model={state:{checks:[{id:'X',amount:10}]}},deps={session,checksSession,model,normalizeState:clone,prepareKupaCloudState:clone,
 idbPut:async(...args)=>{const value=args.pop(),key=args.pop();await Promise.resolve();db.set(key,clone(value))},
 idbGet:async(...args)=>{const value=clone(db.get(args.at(-1)));if(phase==='read'&&hook){const action=hook;hook=null;action()}return value},
 idbDelete:async(...args)=>{if(phase==='delete'&&hook){const action=hook;hook=null;action()}await Promise.resolve();db.delete(args.at(-1))}};
 const api=isOrders?createStorageChecks(deps):checks?createSyncChecksState(deps):createStoragePending(deps),staging=checks?null:createSyncPending({...deps,...api,lastSavedCloudState:()=>({notes:[{id:'X',content:'base'}]}),setSaveStatus:noop,setCloudHeaderStatus:noop});
 return {get:isOrders?api.getChecksPending:checks?api.getSharedChecksPending:api.getCloudPending,clear:isOrders?api.clearChecksPending:checks?api.clearSharedChecksPending:api.clearCloudPending,
 stage:(generation)=>{checksSession.checksGeneration=generation;checksSession.sharedChecksGeneration=generation;session.localGeneration=generation;if(checks)(isOrders?api.markChecksPending:api.markSharedChecksPending)([{id:'X',amount:generation}]);else staging.stageCloudPendingLocal({notes:[{id:'X',content:String(generation)}]},'',10,null,generation)},commit:()=>checks?(isOrders?checksSession.checksOutboxCommitPromise:checksSession.sharedChecksOutboxCommitPromise):session.cloudOutboxCommitPromise};}
 const f=fixture();f.stage(1);await f.commit();hook=()=>f.stage(2);if(phase==='delete')assert.equal(await f.clear(1),false);const pending=await f.get();assert.equal(pending.generation,2);assert.equal((await fixture().get()).generation,2);
});
test('Kupa durable conflict metadata supersedes the equal-generation clean cache',async()=>{
 stores();const db=new Map(),session={localGeneration:1,dbRevision:10};const deps={session,idbPut:async(s,k,v)=>db.set(k,clone(v)),idbGet:async(s,k)=>clone(db.get(k)),idbDelete:async(s,k)=>db.delete(k)};const api=createStoragePending(deps);
 const record={schemaVersion:4,domain:'kupa',documentName:'main',operationId:'fixture',generation:1,mutationSeq:5,baseRevision:10,baseState:{notes:[]},snapshot:{notes:[]},updatedAt:'2026-01-01T00:00:00Z',conflict:null};await api.putCloudPending(record);const pending=await api.getCloudPending();await api.putCloudPending({...pending,conflict:{kind:'entity-conflict',items:[{entityId:'X'}]},savedAt:'2026-01-02T00:00:00Z'});assert.ok((await api.getCloudPending()).conflict);assert.ok((await createStoragePending({...deps,session:{localGeneration:0}}).getCloudPending()).conflict);
});
