import test from 'node:test';
import assert from 'node:assert/strict';
import {createStateNormalization as kupaNormalizer} from '../netunim-kupa/site/assets/js/state/normalization.js';
import {createStateNormalization as ordersNormalizer} from '../netunim-orders/site/assets/js/state/normalization.js';
import {createSyncMerge as kupaMerge} from '../netunim-kupa/site/assets/js/sync/merge.js';
import {createSyncMerge as ordersMerge} from '../netunim-orders/site/assets/js/sync/merge.js';
import {createSyncChecks as kupaChecks} from '../netunim-kupa/site/assets/js/sync/checks.js';
import {createSyncChecks as orderChecks} from '../netunim-orders/site/assets/js/sync/checks.js';
import {createCloudTransport as orderTransport} from '../netunim-orders/site/assets/js/cloud/transport.js';
import {createDomainsBankCache as orderBankCache} from '../netunim-orders/site/assets/js/domains/bank/cache.js';
import {createSyncDocument as orderDocumentSync} from '../netunim-orders/site/assets/js/sync/document.js';
import {createUiCloud as orderUiCloud} from '../netunim-orders/site/assets/js/ui/cloud.js';
import {mergeValue, mergeValuePreferLocal} from '../netunim-kupa/site/assets/js/sync/merge-records.js';
import {cashBalanceData,rightsBalanceData} from '../netunim-kupa/site/assets/js/domains/cash/model.js';
import {validKupaCloudState} from '../netunim-kupa/site/assets/js/state/validation.js';

const k=kupaNormalizer({model:{}}),o=ordersNormalizer({});
const km=kupaMerge(k),om=ordersMerge(o);
const check={id:'C',name:'client',amount:100,dueDate:'2026-09-01',status:'בקופה'};
test('optional undefined fields survive merge and rebase without JSON.parse(undefined)',()=>{
 const conflicts=[];
 assert.equal(mergeValue(undefined,undefined,undefined,'optional',conflicts),undefined);
 assert.equal(mergeValuePreferLocal('old',undefined,'old'),undefined);
 assert.equal(mergeValue('old','local',undefined,'optional',conflicts),undefined);
 assert.deepEqual(conflicts,['optional']);
});
for(const [app,api]of [['kupa',kupaChecks({checksSession:{sharedChecksBootstrapActive:false}})],['orders',orderChecks({})]]){
 test(app+' shared checks: independent edits, conflicts, deletion and no input mutation',()=>{
   const base=[check],local=[check,{...check,id:'L'}],remote=[check,{...check,id:'R'}],before=JSON.stringify([base,local,remote]);
   const merged=api.mergeSharedChecks(base,local,remote);
   assert.equal(merged.conflicts.length,0);assert.deepEqual(merged.checks.map(c=>c.id).sort(),['C','L','R']);
   assert.equal(JSON.stringify([base,local,remote]),before);
   assert.ok(api.mergeSharedChecks(base,[{...check,amount:110}],[{...check,amount:120}]).conflicts.length);
   assert.ok(api.mergeSharedChecks(base,[],[{...check,note:'edited'}]).conflicts.length);
   assert.equal(api.mergeSharedChecks(base,[],base).checks.length,0);
 });
}
test('Kupa bank sync keeps business and home feeds independent across normalization, merge and rebase',()=>{
 const stamp='2026-08-31T18:00:00.000Z';
 const businessFeed={provider:'hapoalim',accountNumber:'123-111111',balance:4100,syncedAt:stamp,transactions:[{id:'B1',date:stamp,amount:-25,description:'עסקי'}]};
 const homeFeed={provider:'hapoalim',accountNumber:'123-222222',balance:2300,syncedAt:stamp,transactions:[{id:'H1',date:stamp,amount:-10,description:'ביתי'}]};
 const base=k.normalizeState({version:4,bank:{currentBalance:4000,updatedAt:stamp,source:'hapoalim',sourceAccount:'123-111111',bankSyncAt:stamp,feed:businessFeed,homeFeed:null,adjustments:[]}});
 assert.equal(base.bank.currentBalance,4000);assert.equal(base.bank.feed.accountNumber,'123-111111');assert.equal(base.bank.homeFeed,null);
 const local=structuredClone(base),remote=structuredClone(base);
 local.bank.homeFeed=homeFeed;remote.bank.currentBalance=4100;remote.bank.feed=businessFeed;
 const merged=km.mergeState3Way(base,local,remote);
 assert.deepEqual(merged.conflicts,[]);assert.equal(merged.state.bank.currentBalance,4100);assert.equal(merged.state.bank.feed.accountNumber,'123-111111');assert.equal(merged.state.bank.homeFeed.accountNumber,'123-222222');assert.equal(merged.state.bank.homeFeed.balance,2300);
 const rebased=km.rebaseLocalProgress(base,local,remote);
 assert.equal(rebased.bank.currentBalance,4100);assert.equal(rebased.bank.homeFeed.accountNumber,'123-222222');
});


test('Kupa cashflow minimum thresholds merge independently without cross-account overwrites',()=>{
 const base=k.normalizeState({version:4,checks:[],credits:[],cash:[],rights:[],notes:[],expenses:[],cards:[],cashflowSettings:{businessMinimum:null,homeMinimum:null},bank:{adjustments:[]}});
 const local=structuredClone(base),remote=structuredClone(base);
 local.cashflowSettings.businessMinimum=5000;remote.cashflowSettings.homeMinimum=3000;
 const merged=km.mergeState3Way(base,local,remote);
 assert.deepEqual(merged.conflicts,[]);assert.equal(merged.state.cashflowSettings.businessMinimum,5000);assert.equal(merged.state.cashflowSettings.homeMinimum,3000);
 const rebased=km.rebaseLocalProgress(base,local,remote);
 assert.equal(rebased.cashflowSettings.businessMinimum,5000);assert.equal(rebased.cashflowSettings.homeMinimum,3000);
 const cloud=k.prepareKupaCloudState(merged.state);assert.equal(cloud.cashflowSettings.businessMinimum,5000);assert.equal(cloud.cashflowSettings.homeMinimum,3000);
});

test('Kupa cash and rights are independent ledgers across normalization and cloud merge',()=>{
 const base=k.normalizeState({version:4,checks:[],credits:[],cash:[{id:'C1',amount:100}],rights:[{id:'R1',amount:40}],rightsLastCalculatedDate:'2026-08-28',notes:[{id:'N1',content:'בסיס',createdAt:'2026-08-28T10:00:00Z'}],expenses:[],cards:[]});
 assert.equal(cashBalanceData(base),100);assert.equal(rightsBalanceData(base),40);
 const local=structuredClone(base),remote=structuredClone(base);
 local.rights.push({id:'R2',amount:-10});local.rightsLastCalculatedDate='2026-09-01';remote.cash.push({id:'C2',amount:25});remote.notes.push({id:'N2',content:'פתק מרוחק',createdAt:'2026-08-29T10:00:00Z'});
 const merged=km.mergeState3Way(base,local,remote);
 assert.deepEqual(merged.conflicts,[]);assert.equal(cashBalanceData(merged.state),125);assert.equal(rightsBalanceData(merged.state),30);assert.equal(merged.state.rightsLastCalculatedDate,'2026-09-01');assert.equal(merged.state.notes.length,2);
 const rebased=km.rebaseLocalProgress(base,local,remote);
 assert.equal(cashBalanceData(rebased),125);assert.equal(rightsBalanceData(rebased),30);assert.equal(rebased.rightsLastCalculatedDate,'2026-09-01');assert.equal(rebased.notes.length,2);
 const cloud=k.prepareKupaCloudState(local);assert.equal(Object.prototype.hasOwnProperty.call(cloud,'checks'),false);assert.equal(cloud.rights.length,2);assert.equal(cloud.rightsLastCalculatedDate,'2026-09-01');assert.equal(cloud.notes.length,1);
 assert.equal(validKupaCloudState(cloud),true);assert.equal(validKupaCloudState({...cloud,rights:'bad'}),false);assert.equal(validKupaCloudState({...cloud,notes:'bad'}),false);
 const legacy=k.normalizeState({version:4,checks:[],credits:[],cash:[],expenses:[],cards:[]});assert.deepEqual(legacy.rights,[]);assert.deepEqual(legacy.notes,[]);assert.equal(legacy.rightsLastCalculatedDate,null);
});

test('Kupa rebase retains edits made during an in-flight save',()=>{
 const base=k.normalizeState({version:4,checks:[],credits:[],cash:[{id:'A',amount:10}],expenses:[],cards:[]});
 const newer=structuredClone(base);newer.cash[0].amount=15;
 const accepted=structuredClone(base);accepted.expenses.push({id:'E',amount:20});
 const rebased=km.rebaseLocalProgress(base,newer,accepted);
 assert.equal(rebased.cash[0].amount,15);assert.equal(rebased.expenses[0].amount,20);
});
test('Orders rebase and empty fields follow the record conflict contract',()=>{
 const base=o.normalizeState({suppliers:[{id:'S',name:'Supplier'}],notes:[{id:'N',content:'base'}]});
 const local=structuredClone(base),remote=structuredClone(base);
 local.notes[0].content='';remote.suppliers[0].name='remote';
 const merged=om.merge3(base,local,remote);assert.deepEqual(merged.conflicts,[]);
 assert.equal(merged.state.notes[0].content,'');assert.equal(merged.state.suppliers[0].name,'remote');
 remote.notes[0].content='other';
 const rebased=om.merge3(base,local,remote,{preferLocalConflicts:true});
 assert.equal(rebased.state.notes[0].content,'');assert.ok(rebased.conflicts.length);
});
test('shared check transport validates revisions and preserves RPC request contract',async()=>{
 const calls=[];
 const api=orderTransport({supaFetch:async(url,options)=>{calls.push([url,JSON.parse(options.body)]);return {ok:true,text:async()=>JSON.stringify([{revision:8}])}}});
 assert.equal((await api.rpcSaveSharedChecks([check],7)).row.revision,8);
 assert.equal(calls[0][0],'/rest/v1/rpc/save_shared_checks_document');
 assert.deepEqual(Object.keys(calls[0][1]).sort(),['p_document_name','p_expected_revision','p_state']);
 assert.equal(calls[0][1].p_expected_revision,7);assert.equal(calls[0][1].p_state.version,1);
 await assert.rejects(api.rpcSaveSharedChecks([check],-1));
 assert.equal(calls.length,1);
});


test('Orders Kupa readout refresh invalidates the visible dependent view only when the Kupa revision changes',async()=>{
 Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
 const checksSession={kupaReadRevision:0,kupaCloudReadState:null,kupaNetReadout:null},ui={currentView:'summary'};let fullReads=0,summaryRenders=0,metaRevision=1;
 const api=orderBankCache({checksSession,ui,computeKupaNetReadout:kupa=>({net:kupa.bank.currentBalance}),renderChecks:()=>{},renderSummary:()=>{summaryRenders++},loadSession:()=>({access_token:'x'}),readKupaReadOnlyMeta:async()=>({revision:metaRevision}),readKupaReadOnlyCloud:async()=>{fullReads++;return {revision:metaRevision,state:{bank:{currentBalance:400+metaRevision}}}}});
 assert.equal(await api.refreshKupaReadout({renderIfChanged:true}),true);assert.equal(checksSession.kupaNetReadout.net,401);assert.equal(summaryRenders,1);assert.equal(fullReads,1);
 assert.equal(await api.refreshKupaReadout({renderIfChanged:true}),true);assert.equal(summaryRenders,1);assert.equal(fullReads,1);
 metaRevision=2;assert.equal(await api.refreshKupaReadout({renderIfChanged:true}),true);assert.equal(checksSession.kupaNetReadout.net,402);assert.equal(summaryRenders,2);assert.equal(fullReads,2);
});

test('Orders cloud open loads shared checks and Kupa readout before the first requested render',async()=>{
 Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
 const store=new Map();Object.defineProperty(globalThis,'localStorage',{value:{setItem:(k,v)=>store.set(k,String(v)),getItem:k=>store.get(k)??null,removeItem:k=>store.delete(k)},configurable:true});
 const order=[];const model={state:{checks:[]}},session={cloudRevision:0,cloudUpdatedAt:null,lastCloudState:null,cloudConflictBlocked:false},checksSession={},ui={};
 const api=orderUiCloud({model,files:{dirHandle:null},tab:{primaryTab:true},session,checksSession,ui,modal:()=>{},supaConfigured:()=>true,toast:()=>{},closeModal:()=>{},authPassword:async()=>{},localSnapshot:()=>{},markCloudPending:()=>{},clearCloudPending:()=>{},setCloud:()=>{},showSecondaryTabGuard:()=>{},prepareCloudState:()=>({suppliers:[]}),render:()=>order.push('render'),writeStateToFolder:async()=>{},loadSession:()=>({access_token:'x'}),readCloud:async()=>({revision:3,updated_at:'2026-08-27T10:00:00Z',state:{suppliers:[]}}),applyOrderCloudState:()=>{},refreshKupaReadout:async opts=>{order.push('kupa');assert.deepEqual(opts,{force:true});return true},syncSharedChecksFromCloud:async()=>{order.push('checks');return true},requestCloudSave:async()=>true,restorePendingAgainstCloud:async()=>false,startPolling:()=>order.push('poll'),saveSession:()=>{},renderSettings:()=>{}});
 await api.openCloud();assert.deepEqual(order,['checks','kupa','render','poll']);
});

test('Orders polling asks Kupa refresh to invalidate a visible balance when a new Kupa revision arrives',async()=>{
 Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
 const refreshArgs=[];const api=orderDocumentSync({model:{state:{}},files:{},session:{cloudBusy:false,cloudRevision:7},ui:{},tab:{primaryTab:true},normalizeState:x=>x,localSnapshot:()=>{},markCloudPending:()=>{},clearCloudPending:()=>{},toast:()=>{},setCloud:()=>{},prepareCloudState:()=>({}),writeStateToFolder:async()=>{},readCloud:async()=>null,rpcSave:async()=>{},merge3:()=>({}),applyOrderCloudState:()=>{},cloudPendingExists:()=>false,setSave:()=>{},cloudEnabled:()=>true,loadCloudPendingState:()=>null,sameOrderCloudData:()=>true,cloudHasLocalWork:()=>false,render:()=>{},readCloudMeta:async()=>({revision:7,updated_at:'2026-08-27T10:00:00Z'}),refreshKupaReadout:async opts=>{refreshArgs.push(opts);return true},pollSharedChecks:async()=>{},refreshCloudTimestamp:()=>{}});
 await api.cloudPoll();assert.deepEqual(refreshArgs,[{renderIfChanged:true}]);
});
