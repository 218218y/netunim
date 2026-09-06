import test from 'node:test';
import assert from 'node:assert/strict';
import {createSyncDocument as ordersDocument} from '../netunim-orders/site/assets/js/sync/document.js';
import {createSyncDocument as kupaDocument} from '../netunim-kupa/site/assets/js/sync/document.js';
import {createSyncPending} from '../netunim-kupa/site/assets/js/sync/pending.js';
import {createSyncMerge as ordersMerge} from '../netunim-orders/site/assets/js/sync/merge.js';
import {createSyncMerge as kupaMerge} from '../netunim-kupa/site/assets/js/sync/merge.js';
import {createStateNormalization as ordersNormalization} from '../netunim-orders/site/assets/js/state/normalization.js';
import {createStateNormalization as kupaNormalization} from '../netunim-kupa/site/assets/js/state/normalization.js';
import {createSyncChecks as ordersChecks} from '../netunim-orders/site/assets/js/sync/checks.js';
import {createSyncChecks as kupaChecks} from '../netunim-kupa/site/assets/js/sync/checks.js';
const clone=structuredClone, noop=()=>{};
Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
globalThis.localStorage={setItem:noop,getItem:()=>null};
const o=ordersNormalization({}),k=kupaNormalization({model:{}});

for(const domain of ['orders','kupa','orders-checks','kupa-checks'])for(const same of [true,false])for(const duringClear of [false,true])test(`${domain}: lost ACK, newer generation, intervening ${same?'same':'different'} entity${duringClear?' during ACK cleanup':''}`,async()=>{
 navigator.onLine=true;
 const checks=domain.endsWith('checks'),isOrders=domain.startsWith('orders'),normalizer=isOrders?o:k;
 const prepare=checks?clone:isOrders?o.normalizeState:k.prepareKupaCloudState;
 const initial=checks?[{id:'X',name:'base',amount:10},{id:'Y',name:'other',amount:20}]:normalizer.normalizeState({notes:[{id:'X',content:'base'},{id:'Y',content:'other'}]});
 const rows=s=>checks?s:s.notes,field=checks?'amount':'content';
 const n=clone(initial);rows(n)[0][field]=checks?11:'N';
 const newer=clone(n);rows(newer)[0][field]=checks?15:'N+1';
 const remote=clone(n);rows(remote)[same?0:1][field]=checks?99:'B';
 let head=clone(initial),revision=10;const ledger=new Map();
 function serverSave(snapshot,op){if(ledger.has(op))return {operation_replayed:true,operation_revision:ledger.get(op),revision,state:checks?{checks:clone(head),bankEvents:[]}:clone(head)};head=clone(snapshot);revision++;ledger.set(op,revision);return {revision,state:clone(head)}}
 serverSave(n,'op-N'); // accepted revision 11, ACK lost
 assert.equal(revision,11);
 let pending={generation:1,operationId:'op-N',baseRevision:10,baseState:prepare(initial),snapshot:prepare(n)},calls=0;
 const session={localGeneration:2,cloudRevision:10,dbRevision:10,lastCloudState:prepare(initial),lastSavedSnapshot:JSON.stringify(prepare(initial)),serverInfo:{},backendReady:true,connectionMode:'supabase'};
 const model={state:checks?{checks:clone(newer)}:clone(duringClear?n:newer)},cs={checksGeneration:2,sharedChecksGeneration:2,checksCloudBase:clone(initial),sharedChecksBase:clone(initial)};
 const get=async()=>clone(pending),put=async value=>{pending=clone(value)},clear=async()=>{if(duringClear){model.state=checks?{checks:clone(newer)}:clone(newer);pending={...pending,generation:2,operationId:'op-newer',snapshot:prepare(newer)};return false}pending=null;return true};
 const mark=(snapshot,msg,conflict,options={})=>{pending={...pending,snapshot:clone(snapshot??model.state),...(checks?options:conflict||{}),conflict:checks?(conflict??pending?.conflict):conflict?.conflict??pending?.conflict};return true};
 const rpc=async()=>{calls++;assert.equal(calls,1,'must not publish revision 13 before explicit resolution');if(!duringClear)pending={...pending,generation:2,operationId:'op-newer',snapshot:prepare(newer)};head=clone(remote);revision=12;return {r:{ok:true},row:serverSave(n,'op-N')}};
 const deps=new Proxy({setSaveStatus:noop,setCloudHeaderStatus:noop,setCloud:noop,toast:noop,render:noop,persistChecksBase:noop,persistSharedChecksBase:noop,renderKupaDependentView:noop,recomputeKupaNetFromCache:noop,refreshCloudTimestamp:noop,persistImmediateBrowserSnapshot:noop,backupSnapshotToComputer:noop,writeStateToFolder:noop,reportError:noop,model,session,checksSession:cs,tab:{primaryTab:true},files:{},normalizeState:normalizer.normalizeState,prepareCloudState:prepare,prepareKupaCloudState:prepare,localSnapshot:noop,loadSession:()=>true,cloudEnabled:()=>true,getCloudPending:get,markCloudPending:mark,clearCloudPending:clear,cloudPendingExists:()=>!!pending,sameOrderCloudData:()=>false,applyOrderCloudState:s=>{model.state=clone(s)},applyKupaCloudState:clone,lastSavedCloudState:()=>prepare(initial),stageCloudPendingLocal:()=>pending,rpcSave:rpc,merge3:ordersMerge(o).merge3,readSharedChecksCloud:async()=>({revision:10,state:{checks:clone(initial),bankEvents:[]}}),readSharedChecksDocument:async()=>({revision:10,state:{checks:clone(initial),bankEvents:[]}}),rpcSaveSharedChecks:rpc,getChecksPending:get,getSharedChecksPending:get,markChecksPending:mark,markSharedChecksPending:mark,clearChecksPending:clear,clearSharedChecksPending:clear,checksPendingExists:()=>!!pending,sharedChecksPendingExists:()=>!!pending},{get:(target,key)=>key in target?target[key]:noop});
 if(checks){ // Stop after a successful rebase so the resulting generation can be inspected.
   const originalMark=mark;const checkedMark=(...args)=>{const result=originalMark(...args);if(!args[2])navigator.onLine=false;return result};
   const api=(isOrders?ordersChecks:kupaChecks)({...deps,markChecksPending:checkedMark,markSharedChecksPending:checkedMark});
   await api.saveSharedChecksToCloud('');navigator.onLine=true;
 }else if(isOrders){await ordersDocument(deps).saveCloudSnapshot(prepare(n),1,clone(pending));}
 else{
   const rebase=createSyncPending({session,prepareKupaCloudState:prepare,getCloudPending:get,putCloudPending:put,rebaseKupaCloudProgress:kupaMerge(k).rebaseKupaCloudProgress});
   const api=kupaDocument({...deps,supaRest:async()=>{const result=await rpc();return {ok:true,text:async()=>JSON.stringify(result.row)}},rebaseNewerPending:rebase.rebaseNewerPending});
   // Prevent poll scheduling in this deterministic single-request test.
   const timer=globalThis.setTimeout;globalThis.setTimeout=()=>0;try{await api.persistSupabaseState(prepare(n),'',1)}finally{globalThis.setTimeout=timer}
 }
 assert.equal(calls,1);assert.equal(revision,12);assert.deepEqual(head,remote);
 if(same){assert.ok(pending?.conflict,'newer local change must be durably blocked');assert.deepEqual(pending.snapshot,prepare(newer));assert.ok(pending.conflict.items?.[0]?.base!==undefined,'structured base evidence');}
 else{assert.equal(pending?.conflict??null,null);assert.equal(rows(pending.snapshot)[0][field],checks?15:'N+1');assert.equal(rows(pending.snapshot)[1][field],checks?99:'B');if(!checks){assert.equal(pending.baseRevision,12);assert.deepEqual(pending.baseState,prepare(remote))}}
});

for(const field of ['businessName','inventoryCategoryOrder','importAudit','stage2Audit'])test(`orders strict scalar ${field}`,()=>{const values=field==='businessName'?['A','B','C']:field==='inventoryCategoryOrder'?[['A'],['B'],['C']]:[{value:'A'},{value:'B'},{value:'C'}];const result=ordersMerge({normalizeState:clone}).merge3({[field]:values[0]},{[field]:values[1]},{[field]:values[2]});assert.ok(result.conflicts.includes(field))});
// Conflicts are durable decisions, even when a later remote head happens to match local.
for(const app of ['orders','kupa'])test(`${app} Shared Checks restart keeps durable conflict blocked`,async()=>{
 let requests=0;const record={generation:2,baseRevision:10,baseState:[],snapshot:[],conflict:{kind:'entity-conflict',items:[{entityId:'X'}]}},session={backendReady:true,connectionMode:'supabase'},checksSession={};
 const deps=new Proxy({model:{state:{checks:[]}},session,checksSession,tab:{primaryTab:true},loadSession:()=>true,getChecksPending:async()=>record,getSharedChecksPending:async()=>record,readSharedChecksCloud:async()=>{requests++},readSharedChecksDocument:async()=>{requests++}},{get:(t,k)=>k in t?t[k]:noop});
 const api=(app==='orders'?ordersChecks:kupaChecks)(deps);assert.equal(await api.saveSharedChecksToCloud(''),false);assert.equal(await api.syncSharedChecksFromCloud(),false);assert.equal(requests,0);
});
test('Orders restart never clears an unresolved durable conflict',async()=>{
 const state=o.normalizeState({notes:[{id:'X',content:'local'}]}),record={generation:2,baseState:state,snapshot:state,conflict:{kind:'entity-conflict',items:[{entityId:'X'}]}},session={cloudRevision:10},model={state};let stages=0;
 const deps=new Proxy({session,model,getCloudPending:async()=>record,normalizeState:o.normalizeState,markCloudPending:()=>{stages++},merge3:ordersMerge(o).merge3},{get:(t,k)=>k in t?t[k]:noop});
 await ordersDocument(deps).restorePendingAgainstCloud({revision:12,state});assert.equal(session.cloudConflictBlocked,true);assert.equal(stages,0);
});
for(const app of ['orders','kupa'])test(`${app} strict post-ACK merge retains delete protections`,()=>{
 const api=app==='orders'?ordersMerge(o).merge3:kupaMerge(k).rebaseKupaCloudProgress,norm=app==='orders'?o.normalizeState:k.normalizeState,base=norm({notes:[{id:'X',content:'base'},{id:'Y',content:'other'}]}),missing=clone(base),remote=clone(base);missing.notes=[];remote.notes[0].content='remote';
 assert.equal(api(base,missing,remote).conflicts.length,0);assert.equal(api(base,missing,remote).state.notes.length,2);
 assert.ok(api(base,missing,remote,{deleteIntents:{notes:['X']}}).conflicts.length);
 const deletion=clone(base);deletion.notes=deletion.notes.filter(x=>x.id!=='X');remote.notes[0].content='base';remote.notes[1].content='other-edit';const merged=api(base,deletion,remote,{deleteIntents:{notes:['X']}});assert.equal(merged.conflicts.length,0);assert.deepEqual(merged.state.notes.map(x=>x.id),['Y']);
});
for(const app of ['orders','kupa'])test(`${app} JSONB key order is not a remote business change`,()=>{
 const base={notes:[{id:'X',content:'base',extra:{x:1,y:2}}]},local={notes:[{id:'X',content:'local',extra:{x:1,y:2}}]},remote={notes:[{extra:{y:2,x:1},content:'base',id:'X'}]};
 const api=app==='orders'?ordersMerge({normalizeState:clone}).merge3:kupaMerge({normalizeState:clone,prepareKupaCloudState:clone}).mergeKupaCloudState3Way;
 const result=api(base,local,remote);assert.deepEqual(result.conflicts,[]);assert.equal(result.state.notes[0].content,'local');
 const checks=(app==='orders'?ordersChecks:kupaChecks)({checksSession:{}});const cb=[{id:'X',amount:10,name:'base'}],cl=[{id:'X',amount:11,name:'base'}],cr=[{name:'base',amount:10,id:'X'}];assert.deepEqual(checks.mergeSharedChecks(cb,cl,cr).conflicts,[]);
});
