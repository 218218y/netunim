import test from 'node:test';
import assert from 'node:assert/strict';
import {createFinanceDerivationStore,financeDerivation} from '../shared/finance-derivations.js';
import {createRevisionSelector} from '../shared/revision-selector.js';
import {createResultPages} from '../shared/result-pages.js';
import {createSearchFragmentIndex} from '../shared/search-fragments.js';
import {createKupaDomainRevisions,KUPA_FINANCE_DOMAINS,kupaPageRevision} from '../netunim-kupa/site/assets/js/state/revisions.js';
import {createOrderDomainRevisions} from '../netunim-orders/site/assets/js/state/revisions.js';
import {createDomainsFinanceController} from '../netunim-orders/site/assets/js/domains/finance/controller.js';
import {createUiAlertCenter} from '../netunim-orders/site/assets/js/ui/alert-center.js';
import {createCustomerRenderSelector,customerStatsData,customerDebtStatus} from '../netunim-orders/site/assets/js/domains/customers/model.js';
import {customerDebtProgressData} from '../shared/customer-debt-progress.js';
import {createInventoryRenderStore,inventoryStatsData,inventoryLocationStatsData,inventorySearchMatch,inventoryEventViewData} from '../netunim-orders/site/assets/js/domains/inventory/model.js';
import {buildOrderSearchFragment,ORDER_SEARCH_FRAGMENTS,buildGlobalSearchEntries} from '../netunim-orders/site/assets/js/domains/search/model.js';
import {buildKupaSearchFragment,KUPA_SEARCH_FRAGMENTS,buildKupaGlobalSearchEntries} from '../netunim-kupa/site/assets/js/domains/search/model.js';
import {searchMatch,prepareSearchValues,createPreparedSearchMatcher} from '../netunim-kupa/site/assets/js/core/search.js';

test('finance cache survives unrelated mutations, invalidates every finance dependency, isolates results and bounds options',()=>{
  const ledger=createKupaDomainRevisions({}),store=createFinanceDerivationStore({revision:()=>ledger.stamp(KUPA_FINANCE_DOMAINS)}),source={};let calls=0;
  const query=(key='default')=>store.run(()=>financeDerivation(source,'test',key,()=>({n:++calls,rows:[{amount:10}]})));
  assert.equal(query().n,1);query().rows[0].amount=999;assert.equal(query().rows[0].amount,10);
  ledger.touch('notes');ledger.touch('cash');assert.equal(query().n,1);
  for(const domain of KUPA_FINANCE_DOMAINS){ledger.touch(domain);const before=calls;query();assert.equal(calls,before+1,domain)}
  ledger.touchAll();const before=calls;query();assert.equal(calls,before+1);
  for(let i=0;i<65;i++)query(String(i));const bounded=calls;query();assert.equal(calls,bounded+1,'old option entries are evicted');
  const stamp=kupaPageRevision(ledger,'credit');ledger.touch('bank');assert.notEqual(kupaPageRevision(ledger,'credit'),stamp,'bank as-of metadata changes credit reconciliation');
});

test('read selectors clone only on invalidation and never expose authoritative mutable state',()=>{
  const source={rows:[{name:'original'}]};let revision=0,calls=0;
  const select=createRevisionSelector({revision:()=>revision,select:()=>{calls++;return source}});
  const first=select();assert.equal(select(),first);assert.equal(calls,1);assert.throws(()=>{first.rows[0].name='poison'},TypeError);
  source.rows[0].name='updated';assert.equal(first.rows[0].name,'original');revision++;assert.equal(select().rows[0].name,'updated');assert.equal(calls,2);
});

test('Orders read snapshot reuses business data while keeping connection status fresh and mutation snapshots independent',()=>{
  let revision=0,token='';const state={bank:{currentBalance:10,adjustments:[]},cards:[],credits:[],creditSync:{profiles:[]}},checks=[{id:'C',amount:10}];
  const controller=createDomainsFinanceController({checksSession:{kupaCloudReadState:state},getSharedChecks:()=>checks,readRevision:()=>revision,bridge:{bankAutoEnabled:()=>false,creditAutoEnabled:()=>false,creditAutoMode:()=> 'daily',getBridgeToken:()=>token}});
  const first=controller.readSnapshot();token='configured';const second=controller.readSnapshot();
  assert.equal(first.kupa,second.kupa);assert.equal(first.bank,second.bank);assert.equal(second.bridgeTokenConfigured,true);
  assert.throws(()=>{first.kupa.checks[0].amount=1},TypeError);controller.snapshot().kupa.bank.currentBalance=999;assert.equal(state.bank.currentBalance,10);
  state.bank.currentBalance=20;revision++;assert.equal(controller.readSnapshot().bank.currentBalance,20);
});

test('alert projection avoids finance access on a warm refresh, invalidates on notes/checks/finance/archive/date and restore',()=>{
  const ledger=createOrderDomainRevisions({}),model={state:{checks:[],notes:[]}};let snapshots=0;
  const center=createUiAlertCenter({model,alertsRevision:()=>ledger.stamp(['checks','notes','finance','bankDisplay']),financeSnapshot:()=>{snapshots++;return {kupa:null,bankAlertsReady:false}}});
  const first=center.currentAlerts('2026-09-21');assert.equal(center.currentAlerts('2026-09-21'),first);assert.equal(snapshots,1);
  ledger.touch('service');ledger.touch('transactions');assert.equal(center.currentAlerts('2026-09-21'),first);assert.equal(snapshots,1);
  for(const domain of ['notes','checks','finance','bankDisplay']){ledger.touch(domain);center.currentAlerts('2026-09-21')}
  assert.equal(snapshots,5);center.currentAlerts('2026-09-22');assert.equal(snapshots,6);ledger.touchAll();center.currentAlerts('2026-09-22');assert.equal(snapshots,7);
});

test('prepared credit matching preserves dates, Hebrew, punctuation and short numeric token semantics',()=>{
  const values=['תַּשְׁלוּם','Purchase ABC-123',12,400],dates=['2026-09-21'],prepared=prepareSearchValues(values,dates);
  for(const query of ['', 'תשלום','purchase','ABC123','21/9/26','21.09.2026','12','2','400','missing'])assert.equal(createPreparedSearchMatcher(query)(prepared),searchMatch(query,values,dates),query);
});

test('customer model matches original totals/progress, is reused for searches, and reconciles remote changes',()=>{
  const ledger=createOrderDomainRevisions({}),state={customerDebts:Array.from({length:1000},(_,i)=>({id:`D${i}`,customerName:`Customer ${i}`,amount:100+i,paid:i%3===0,invoiceIssued:i%4===0,supplied:i%2===0,debtProgress:i%5===0?[{id:`P${i}`,kind:'payment',action:'apply',amount:20,createdAt:'2026-09-01'}]:[]})),customerOrders:[{id:'O'}]};
  let current=state;const select=createCustomerRenderSelector({state:()=>current,revision:()=>ledger.stamp(['customerDebts','customerOrders'])});
  const first=select();assert.deepEqual(first.stats,customerStatsData(state));
  for(const row of first.rows){assert.deepEqual(row.progress,customerDebtProgressData(row.record));assert.deepEqual(row.status,customerDebtStatus(row.record))}
  ledger.touch('service');assert.equal(select(),first);const next=structuredClone(state);next.customerDebts[0].amount=999;ledger.reconcile(state,next);current=next;
  assert.notEqual(select(),first);assert.deepEqual(select().stats,customerStatsData(next));
});

test('inventory render model groups once, matches pure calculations, keeps validation live and refreshes on revision',()=>{
  const ledger=createOrderDomainRevisions({}),state={inventoryItems:Array.from({length:100},(_,i)=>({id:`I${i}`,name:`Item ${i}`})),inventoryEvents:Array.from({length:5000},(_,i)=>({id:`E${i}`,itemId:`I${i%100}`,type:['opening','receive','reserve','order','transfer'][i%5],quantity:2,location:'מחסן קטן',fromLocation:'מחסן קטן',toLocation:'מחסן גדול',customerName:`Customer ${i}`}))};
  const expected=state.inventoryItems.map(item=>({stats:inventoryStatsData(state,item.id),locations:inventoryLocationStatsData(state,item.id),search:inventorySearchMatch(item,'Customer',state)}));
  const store=createInventoryRenderStore({state:()=>state,revision:()=>ledger.stamp(['inventory'])});
  store.run(()=>{for(let pass=0;pass<2;pass++)state.inventoryItems.forEach((item,i)=>{assert.deepEqual(inventoryStatsData(state,item.id),expected[i].stats);assert.deepEqual(inventoryLocationStatsData(state,item.id),expected[i].locations);assert.equal(inventorySearchMatch(item,'Customer',state),expected[i].search)});assert.equal(inventoryEventViewData(state,state.inventoryEvents[0]).item.name,'Item 0')});
  state.inventoryEvents[0].quantity=100;assert.notDeepEqual(inventoryStatsData(state,'I0'),expected[0].stats,'business validation is never routed through cached view data');ledger.touch('inventory');
  assert.deepEqual(store.run(()=>inventoryStatsData(state,'I0')),inventoryStatsData(state,'I0'));
  assert.throws(()=>store.run(()=>{inventoryLocationStatsData(state,'I0')['מחסן קטן'].onHand=99}),TypeError);
});

for(const app of ['orders','kupa'])test(`${app} incremental index is equivalent to cold build and only rebuilds changed fragments`,()=>{
  const orders=app==='orders',ledger=orders?createOrderDomainRevisions({}):createKupaDomainRevisions({}),definitions=orders?ORDER_SEARCH_FRAGMENTS:KUPA_SEARCH_FRAGMENTS,build=orders?buildOrderSearchFragment:buildKupaSearchFragment,cold=orders?buildGlobalSearchEntries:buildKupaGlobalSearchEntries;
  const state={suppliers:[{id:'S',name:'Supplier'}],transactions:[],customerDebts:[],customerOrders:[],serviceCalls:[],inventoryItems:[],inventoryEvents:[],warehouseOrders:[],checks:[{id:'C',name:'Check'}],cash:[],rights:[],credits:[],cards:[],expenses:[],notes:[{id:'N',content:'note'}],bank:{},creditSync:{profiles:[]}},calls=[];
  const index=createSearchFragmentIndex({fragments:Object.keys(definitions),revision:name=>ledger.stamp(definitions[name]),build:name=>{calls.push(name);return build(state,name)}});
  const first=index();assert.deepEqual(first,cold(state));assert.equal(index(),first);calls.length=0;
  state.notes[0].content='changed';ledger.touch('notes');assert.deepEqual(index(),cold(state));assert.deepEqual(calls,['notes']);calls.length=0;
  ledger.touchAll();index();assert.equal(calls.length,Object.keys(definitions).length);
});

test('pagination bounds DOM input, preserves all rows and targets global-search results after page 1',()=>{
  const ui={},pages=createResultPages({ui,action:'results-page'}),rows=Array.from({length:5000},(_,id)=>({id}));
  const first=pages.page(rows,'stock','all');assert.equal(first.rows.length,150);assert.equal(first.rows[0].id,0);assert.match(first.controls,/5000/);
  assert.equal(pages.move('stock',1),true);assert.equal(pages.page(rows,'stock','all').rows[0].id,150);
  const target=pages.page(rows,'stock','all',{target:4999});assert.ok(target.rows.some(row=>row.id===4999));assert.equal(pages.move('stock',1),false);
  assert.equal(pages.page(rows,'stock','new search').rows[0].id,0);assert.equal(rows.length,5000);
  pages.move('stock',1);assert.equal(pages.page(rows.slice(0,2),'stock','new search').rows.length,2);assert.equal(pages.move('stock',-1),false);
});
