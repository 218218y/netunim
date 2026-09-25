import test from 'node:test';
import assert from 'node:assert/strict';
import {withExpectedConsoleErrors} from './helpers/expected-console.mjs';
import {createStorageBrowser as ordersBrowser} from '../netunim-orders/site/assets/js/storage/browser.js';
import {createStorageBrowser as kupaBrowser} from '../netunim-kupa/site/assets/js/storage/browser.js';
import {INITIAL_STATE as ORDERS_INITIAL_STATE} from '../netunim-orders/site/assets/js/state/constants.js';
const clone=structuredClone,noop=()=>{};
function stores(){const ls=new Map(),db=new Map();let failLS=false,failIDB=false,beforeGet=null,beforeDelete=null;
 globalThis.localStorage={getItem:k=>ls.get(k)??null,setItem:(k,v)=>{if(failLS)throw Error('quota');ls.set(k,v)},removeItem:k=>ls.delete(k)};
 globalThis.indexedDB={open:()=>{const request={};queueMicrotask(()=>{if(failIDB){request.error=Error('idb unavailable');request.onerror();return}request.result={close:noop,transaction:store=>{if(failIDB)throw Error('idb unavailable');const tx={objectStore:()=>({put:(value,key)=>{queueMicrotask(()=>{db.set(store+key,clone(value));tx.oncomplete?.()})},get:key=>{const r={};queueMicrotask(()=>{r.result=clone(db.get(store+key));if(beforeGet){const callback=beforeGet;beforeGet=null;callback()}r.onsuccess?.()});return r},delete:key=>{queueMicrotask(()=>{if(beforeDelete){const callback=beforeDelete;beforeDelete=null;callback()}db.delete(store+key);tx.oncomplete?.()})}})};return tx}};request.onsuccess()});return request}};
 return {ls,db,set beforeDelete(callback){beforeDelete=callback},set beforeGet(callback){beforeGet=callback},set failLS(v){failLS=v},set failIDB(v){failIDB=v}};
}
for(const app of ['orders','kupa'])test(`${app} cannot create a V1 snapshot when the V2 journal is unavailable`,()=>{
 const store=stores(),files={},session={localSnapshotSeq:0,cloudRevision:0,dbRevision:0,storageProtocolBlocked:false};
 const storageV2={cutoverActive:false,persist:()=>({handled:false,reason:'not-ready'})};
 const browser=app==='orders'
  ?ordersBrowser({storageV2,model:{state:structuredClone(ORDERS_INITIAL_STATE)},session,files,normalizeState:x=>x,legacyDrainActive:()=>true,legacyWriteAllowed:()=>true})
  :kupaBrowser({storageV2,model:{state:{}},session,files,legacyDrainActive:()=>true,legacyWriteAllowed:()=>true});
 assert.throws(()=>app==='orders'?browser.localSnapshot():browser.persistImmediateBrowserSnapshot(),/storage_v2_write_unavailable/);
 assert.equal(store.ls.size,0);assert.equal(store.db.size,0);
});

for(const app of ['orders','kupa'])test(`${app} exposes the V2 commit promise while emergency durability is pending`,async()=>{
 const store=stores(),files={},session={localSnapshotSeq:0,cloudRevision:0,dbRevision:0,storageProtocolBlocked:false};
 let settle;const committed=new Promise(resolve=>{settle=resolve});
 const storageV2={cutoverActive:true,persist:()=>({handled:true,emergencyDurable:false,committed})};
 const browser=app==='orders'
  ?ordersBrowser({storageV2,model:{state:structuredClone(ORDERS_INITIAL_STATE)},session,files,normalizeState:x=>x})
  :kupaBrowser({storageV2,model:{state:{}},session,files});
 assert.equal(app==='orders'?browser.localSnapshot():browser.persistImmediateBrowserSnapshot(),false);
 assert.equal(files.storageV2CommitPromise,committed);assert.equal(store.ls.size,0);assert.equal(store.db.size,0);
 settle();await committed;
});

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
 invalidate:checks?noop:api.invalidateCloudPendingHead,
 stage:(generation)=>{checksSession.checksGeneration=generation;checksSession.sharedChecksGeneration=generation;session.localGeneration=generation;if(checks)(isOrders?api.markChecksPending:api.markSharedChecksPending)([{id:'X',amount:generation}]);else staging.stageCloudPendingLocal({notes:[{id:'X',content:String(generation)}]},'',10,null,generation)},commit:()=>checks?(isOrders?checksSession.checksOutboxCommitPromise:checksSession.sharedChecksOutboxCommitPromise):session.cloudOutboxCommitPromise};}
 const f=fixture();f.stage(1);await f.commit();if(domain==='kupa'&&phase==='read')f.invalidate();hook=()=>f.stage(2);if(phase==='delete')assert.equal(await f.clear(1),false);const pending=await f.get();assert.equal(pending.generation,2);assert.equal((await fixture().get()).generation,2);
});

test('Kupa degraded outbox head is not trusted until the failed IndexedDB mirror is repaired',()=>withExpectedConsoleErrors([['pending idb save failed','idb unavailable']],async()=>{
 const ls=new Map(),db=new Map(),session={localGeneration:1,dbRevision:10,cloudDocumentName:'main'};let failIDB=true,reads=0;
 globalThis.localStorage={getItem:key=>ls.get(key)??null,setItem:(key,value)=>ls.set(key,value),removeItem:key=>ls.delete(key)};
 const api=createStoragePending({session,idbPut:async(s,k,v)=>{if(failIDB)throw Error('idb unavailable');db.set(k,clone(v))},idbGet:async(s,k)=>{reads++;if(failIDB)throw Error('idb unavailable');return clone(db.get(k))},idbDelete:async(s,k)=>db.delete(k)});
 const state={notes:[{id:'X',content:'repair-me'}]},record={schemaVersion:4,domain:'kupa',documentName:'main',operationId:'repair',generation:1,mutationSeq:1,baseRevision:10,baseState:state,snapshot:state,deleteIntents:{}};
 const staged=await api.putCloudPending(record);assert.equal(staged.localOk,true);assert.equal(staged.durable,false);assert.equal(db.size,0);failIDB=false;assert.equal((await api.getCloudPending()).snapshot.notes[0].content,'repair-me');assert.ok(reads>=2);assert.equal(db.get('cloud-pending-v3').snapshot.notes[0].content,'repair-me');
}));

test('Kupa durable outbox never downgrades to a stale head',async()=>{
 const ls=new Map(),db=new Map(),session={localGeneration:2,dbRevision:10,cloudDocumentName:'main'};
 globalThis.localStorage={getItem:key=>ls.get(key)??null,setItem:(key,value)=>ls.set(key,value),removeItem:key=>ls.delete(key)};
 const api=createStoragePending({session,idbPut:async(s,k,v)=>db.set(k,clone(v)),idbGet:async(s,k)=>clone(db.get(k)),idbDelete:async(s,k)=>db.delete(k)});
 const state={notes:[{id:'X',content:'value'}]},base={schemaVersion:4,domain:'kupa',documentName:'main',baseRevision:10,baseState:state,snapshot:state,deleteIntents:{}};
 const newer={...base,operationId:'newer',generation:2,mutationSeq:2},older={...base,operationId:'older',generation:1,mutationSeq:1};
 assert.equal((await api.putCloudPending(newer)).durable,true);
 const result=await api.putCloudPending(older);
 assert.equal(result.superseded,true);assert.equal(db.get('cloud-pending-v3').generation,2);assert.equal(db.get('cloud-pending-v3').mutationSeq,2);
});

test('Kupa durable conflict metadata supersedes the equal-generation clean cache',async()=>{
 stores();const db=new Map(),session={localGeneration:1,dbRevision:10};const deps={session,idbPut:async(s,k,v)=>db.set(k,clone(v)),idbGet:async(s,k)=>clone(db.get(k)),idbDelete:async(s,k)=>db.delete(k)};const api=createStoragePending(deps);
 const record={schemaVersion:4,domain:'kupa',documentName:'main',operationId:'fixture',generation:1,mutationSeq:5,baseRevision:10,baseState:{notes:[]},snapshot:{notes:[]},updatedAt:'2026-01-01T00:00:00Z',conflict:null};await api.putCloudPending(record);const pending=await api.getCloudPending();await api.putCloudPending({...pending,conflict:{kind:'entity-conflict',items:[{entityId:'X'}]},savedAt:'2026-01-02T00:00:00Z'});assert.ok((await api.getCloudPending()).conflict);assert.ok((await createStoragePending({...deps,session:{localGeneration:0}}).getCloudPending()).conflict);
});
