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
import {computeKupaNetReadoutData} from '../netunim-orders/site/assets/js/domains/bank/readout.js';
import {ordersFinanceSummaryData} from '../shared/orders-finance.js';
import {dashboardNetPositionData} from '../netunim-kupa/site/assets/js/domains/dashboard/model.js';

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
 test(app+' shared checks: independent edits, conflicts, explicit deletion and no input mutation',()=>{
   const base=[check],local=[check,{...check,id:'L'}],remote=[check,{...check,id:'R'}],before=JSON.stringify([base,local,remote]);
   const merged=api.mergeSharedChecks(base,local,remote);
   assert.equal(merged.conflicts.length,0);assert.deepEqual(merged.checks.map(c=>c.id).sort(),['C','L','R']);
   assert.equal(JSON.stringify([base,local,remote]),before);
   assert.ok(api.mergeSharedChecks(base,[{...check,amount:110}],[{...check,amount:120}]).conflicts.length);
   const staleVsRemoteEdit=api.mergeSharedChecks(base,[],[{...check,note:'edited'}]);assert.equal(staleVsRemoteEdit.conflicts.length,0);assert.equal(staleVsRemoteEdit.checks[0].note,'edited');
   assert.ok(api.mergeSharedChecks(base,[],[{...check,note:'edited'}],{deleteIds:['C']}).conflicts.length,'explicit delete conflicts with a concurrent edit of the same check');
   assert.equal(api.mergeSharedChecks(base,[],base).checks.length,1,'missing records without explicit delete intent are preserved');
   assert.equal(api.mergeSharedChecks(base,[],base,{deleteIds:['C']}).checks.length,0,'an explicitly deleted check is removed');
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
 assert.equal((await api.rpcSaveSharedChecks([check],7,'test:checks:1',['C2'])).row.revision,8);
 assert.equal(calls[0][0],'/rest/v1/rpc/save_shared_checks_document_v4');
 assert.deepEqual(Object.keys(calls[0][1]).sort(),['p_deleted_check_ids','p_document_name','p_expected_revision','p_operation_id','p_state']);
 assert.equal(calls[0][1].p_expected_revision,7);assert.equal(calls[0][1].p_operation_id,'test:checks:1');assert.equal(calls[0][1].p_state.version,1);assert.deepEqual(calls[0][1].p_deleted_check_ids,['C2']);
 await assert.rejects(api.rpcSaveSharedChecks([check],-1,'test:checks:2'));
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



test('Orders Kupa net uses business expenses only and excludes cash while keeping checks',()=>{
 const ordersState={checks:[{id:'CHK',name:'לקוח',amount:300,dueDate:'2099-09-20',status:'בקופה'}]};
 const kupa={bank:{currentBalance:5000,asOfDate:'2099-09-01',adjustments:[]},credits:[{id:'CR',active:true,totalAmount:100,installments:1,firstChargeDate:'2099-09-15',card:'עסקי',account:'עסקי'}],creditSync:{profiles:[],cardMappings:{}},expenses:[{id:'EXP-B',active:true,recurring:false,date:'2099-09-10',amount:100,account:'עסקי'},{id:'EXP-H',active:true,recurring:false,date:'2099-09-11',amount:2150,account:'ביתי'}],cash:[{id:'CASH',amount:1000}]};
 const readout=computeKupaNetReadoutData(ordersState,kupa);
 assert.equal(readout.credit,100);assert.equal(readout.expenses,100,'home expenses must not reduce the Orders balance');assert.equal(readout.cash,1000);assert.equal(readout.checks,300);assert.equal(readout.kupa,300);assert.equal(readout.net,5100,'Orders balance is bank - future business credit - one month business expenses + checks only');
});

test('Kupa dashboard adds the canonical Orders customer and supplier balances to its cash-inclusive base net',()=>{
 const orders={suppliers:[{id:'S1'},{id:'S2'}],transactions:[{supplierId:'S1',debit:100,credit:0},{supplierId:'S2',debit:0,credit:40}],customerDebts:[{amount:500,paid:false},{amount:700,paid:true}]};
 const summary=ordersFinanceSummaryData(orders);assert.equal(summary.customerOpen,500);assert.equal(summary.supplierNet,-60);
 const combined=dashboardNetPositionData({bank:2000,credit:500,expenses:200,cash:400,checks:300,kupa:700,net:2000},summary);
 assert.equal(combined.customerOpen,500);assert.equal(combined.supplierNet,-60);assert.equal(combined.net,2440,'Kupa total keeps cash/checks in its base and then adds open customers and supplier net');
 assert.equal(dashboardNetPositionData({net:2000},null).net,null,'Kupa does not present a falsely complete total before the Orders summary is known');
});

test('Kupa notes sheet merges rows and column configuration independently',()=>{
 const k=kupaNormalizer({model:{lastNormalizeRemovedCredits:0}}),m=kupaMerge({normalizeState:k.normalizeState,prepareKupaCloudState:k.prepareKupaCloudState});
 const base=k.normalizeState({version:4,checks:[],credits:[],cash:[],rights:[],notes:[],expenses:[],cards:[],bank:{adjustments:[]}});
 const local=structuredClone(base),remote=structuredClone(base);
 local.notesSheet.rows.push({id:'ROW-1',cells:{'sheet-col-1':'100'},createdAt:'2026-09-03T08:00:00Z',updatedAt:'2026-09-03T08:00:00Z'});
 remote.notesSheet.columns[0].title='סכום';remote.notesSheet.columns[0].type='number';
 const merged=m.mergeState3Way(base,local,remote);
 assert.deepEqual(merged.conflicts,[]);assert.equal(merged.state.notesSheet.rows.length,1);assert.equal(merged.state.notesSheet.columns[0].title,'סכום');assert.equal(merged.state.notesSheet.columns[0].type,'number');
 const cloud=k.prepareKupaCloudState(merged.state);assert.equal(validKupaCloudState(cloud),true);assert.equal(cloud.notesSheet.rows[0].cells['sheet-col-1'],'100');
});

test('Orders main merge never treats a stale partial snapshot as deletion without explicit intent',()=>{
 const base=o.normalizeState({suppliers:[{id:'S',name:'Supplier'}],transactions:[{id:'T',supplierId:'S',action:'base'}],customerDebts:[{id:'D',customerName:'Debt'}],serviceCalls:[{id:'SV',customerName:'Service'}],notes:[{id:'N',content:'note'}]});
 const stale=structuredClone(base);stale.transactions=[];stale.customerDebts=[];stale.serviceCalls=[];stale.notes=[];
 const safe=om.merge3(base,stale,base);assert.deepEqual(safe.conflicts,[]);assert.equal(safe.state.transactions.length,1);assert.equal(safe.state.customerDebts.length,1);assert.equal(safe.state.serviceCalls.length,1);assert.equal(safe.state.notes.length,1);
 const intentional=om.merge3(base,stale,base,{deleteIntents:{transactions:['T'],customerDebts:['D'],serviceCalls:['SV'],notes:['N']}});assert.deepEqual(intentional.conflicts,[]);assert.equal(intentional.state.transactions.length,0);assert.equal(intentional.state.customerDebts.length,0);assert.equal(intentional.state.serviceCalls.length,0);assert.equal(intentional.state.notes.length,0);
});

test('Kupa main merge protects expenses, notes and ledgers from implicit deletion while honoring explicit intent',()=>{
 const base=k.normalizeState({version:4,checks:[],creditSync:{version:4,profiles:[],cardMappings:{}},credits:[{id:'CR',totalAmount:100,active:true}],cash:[{id:'C',amount:10}],rights:[{id:'R',amount:5}],notes:[{id:'N',content:'note'}],expenses:[{id:'E',amount:20}],cards:[],bank:{adjustments:[]}}),stale=structuredClone(base);
 stale.credits=[];stale.cash=[];stale.rights=[];stale.notes=[];stale.expenses=[];
 const safe=km.mergeState3Way(base,stale,base);assert.deepEqual(safe.conflicts,[]);for(const key of ['credits','cash','rights','notes','expenses'])assert.equal(safe.state[key].length,1,key+' is preserved');
 const intentional=km.mergeState3Way(base,stale,base,{deleteIntents:{credits:['CR'],cash:['C'],rights:['R'],notes:['N'],expenses:['E']}});assert.deepEqual(intentional.conflicts,[]);for(const key of ['credits','cash','rights','notes','expenses'])assert.equal(intentional.state[key].length,0,key+' explicit delete is honored');
});

test('Orders transport sends explicit delete intents through the v4 document RPC',async()=>{
 const calls=[];const api=orderTransport({supaFetch:async(url,options)=>{calls.push([url,JSON.parse(options.body)]);return {ok:true,text:async()=>JSON.stringify([{revision:10,state:{}}])}}});
 await api.rpcSave({suppliers:[],transactions:[],customerDebts:[],customerOrders:[],serviceCalls:[],notes:[],inventoryItems:[],inventoryCategoryOrder:[],inventoryEvents:[],warehouseOrders:[]},9,'orders:test:v4',{transactions:['T1']});
 assert.equal(calls[0][0],'/rest/v1/rpc/save_order_management_document_v4');assert.deepEqual(calls[0][1].p_delete_intents,{transactions:['T1']});
});

test('Orders cloud poll silently advances a revision when remote business data already equals local state',async()=>{
 Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
 const store=new Map();Object.defineProperty(globalThis,'localStorage',{value:{setItem:(k,v)=>store.set(k,String(v)),getItem:k=>store.get(k)??null,removeItem:k=>store.delete(k)},configurable:true});
 let applied=0,toasts=0,renders=0;const model={state:{suppliers:[{id:'S'}]}},session={cloudBusy:false,cloudRevision:5,cloudUpdatedAt:null,lastCloudState:null};
 const api=orderDocumentSync({model,files:{},session,ui:{},tab:{primaryTab:true},normalizeState:x=>x,localSnapshot:()=>{},markCloudPending:()=>{},getCloudPending:async()=>null,clearCloudPending:async()=>true,toast:()=>{toasts++},setCloud:()=>{},prepareCloudState:x=>structuredClone(x||model.state),writeStateToFolder:async()=>{},readCloud:async()=>({revision:6,updated_at:'2026-09-03T19:00:00Z',state:structuredClone(model.state)}),rpcSave:async()=>{},merge3:()=>({state:model.state,conflicts:[]}),applyOrderCloudState:()=>{applied++},cloudPendingExists:()=>false,setSave:()=>{},cloudEnabled:()=>true,loadCloudPendingState:()=>null,sameOrderCloudData:()=>true,cloudHasLocalWork:()=>false,render:()=>{renders++},readCloudMeta:async()=>({revision:6,updated_at:'2026-09-03T19:00:00Z'}),refreshKupaReadout:async()=>false,pollSharedChecks:async()=>{},refreshCloudTimestamp:()=>{}});
 await api.cloudPoll();assert.equal(session.cloudRevision,6);assert.equal(applied,0);assert.equal(toasts,0);assert.equal(renders,0);
});
