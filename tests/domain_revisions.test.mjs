import test from 'node:test';
import assert from 'node:assert/strict';
import {createCleanViewCache} from '../shared/clean-view-cache.js';
import {createOrderDomainRevisions,orderViewRevision} from '../netunim-orders/site/assets/js/state/revisions.js';
import {createKupaDomainRevisions,kupaPageRevision} from '../netunim-kupa/site/assets/js/state/revisions.js';

function orderState(){return {
  suppliers:[{id:'S1',name:'Supplier'}],transactions:[{id:'T1',supplierId:'S1',amount:10}],
  customerDebts:[{id:'D1',name:'Customer'}],customerOrders:[{id:'O1',name:'Order'}],serviceCalls:[{id:'SV1'}],
  inventoryItems:[{id:'I1',name:'Panel'}],inventoryCategoryOrder:['Boards'],inventoryEvents:[{id:'IE1'}],warehouseOrders:[{id:'W1'}],
  notes:[{id:'N1',text:'note'}],checks:[{id:'C1',amount:100}],
}}
function kupaState(){return {
  cash:[{id:'C1',amount:100}],rights:[{id:'R1',amount:10}],rightsLastCalculatedDate:'2026-09-18',
  checks:[{id:'K1',amount:200}],credits:[{id:'CR1',amount:50}],cards:[{id:'CARD1'}],creditSync:{revision:1},expenses:[{id:'E1',amount:20}],
  bank:{balance:1000,feed:{rows:[{id:'B1'}]},homeFeed:{rows:[]}},notes:[{id:'N1',text:'note'}],cashflowSettings:{businessMinimum:500},
}}

class FakeNode{
  constructor(name=''){this.name=name;this.parentNode=null;this.children=[]}
  get firstChild(){return this.children[0]||null}
  appendChild(node){
    if(node instanceof FakeFragment){while(node.firstChild)this.appendChild(node.firstChild);return node}
    if(node.parentNode){const i=node.parentNode.children.indexOf(node);if(i>=0)node.parentNode.children.splice(i,1)}
    node.parentNode=this;this.children.push(node);return node
  }
  replaceChildren(...nodes){for(const child of this.children)child.parentNode=null;this.children=[];for(const node of nodes)this.appendChild(node)}
}
class FakeFragment extends FakeNode{}

test('Orders domain revisions invalidate only views that consume the changed domain',()=>{
  const ledger=createOrderDomainRevisions({}),supplier0=orderViewRevision(ledger,'supplier'),warehouse0=orderViewRevision(ledger,'warehouse'),checks0=orderViewRevision(ledger,'checks');
  ledger.touch('notes');
  assert.equal(orderViewRevision(ledger,'supplier'),supplier0,'notes must not evict supplier DOM');
  assert.equal(orderViewRevision(ledger,'warehouse'),warehouse0,'notes must not evict warehouse DOM');
  ledger.touch('suppliers');
  assert.notEqual(orderViewRevision(ledger,'supplier'),supplier0,'supplier mutation invalidates supplier DOM');
  assert.equal(orderViewRevision(ledger,'warehouse'),warehouse0,'supplier mutation must not evict warehouse DOM');
  ledger.touch('finance');
  assert.notEqual(orderViewRevision(ledger,'checks'),checks0,'checks view consumes bank activity from the finance snapshot');
  const checks1=orderViewRevision(ledger,'checks');
  ledger.touch('bankDisplay');
  assert.notEqual(orderViewRevision(ledger,'checks'),checks1,'checks view consumes the asynchronously loaded bank display archive');
});

test('Kupa domain revisions keep unrelated pages warm and propagate checks to cashflow consumers',()=>{
  const ledger=createKupaDomainRevisions({}),cash0=kupaPageRevision(ledger,'cash'),notes0=kupaPageRevision(ledger,'notes'),bank0=kupaPageRevision(ledger,'bank'),checks0=kupaPageRevision(ledger,'checks'),credit0=kupaPageRevision(ledger,'credit');
  ledger.touch('notes');
  assert.notEqual(kupaPageRevision(ledger,'notes'),notes0);
  assert.equal(kupaPageRevision(ledger,'bank'),bank0,'notes mutation must not evict bank DOM');
  const notes1=kupaPageRevision(ledger,'notes');
  ledger.touch('cash');
  assert.notEqual(kupaPageRevision(ledger,'cash'),cash0);
  assert.equal(kupaPageRevision(ledger,'notes'),notes1,'cash mutation must not evict notes DOM');
  ledger.touch('checks');
  assert.notEqual(kupaPageRevision(ledger,'bank'),bank0,'cashflow bank page consumes checks');
  assert.notEqual(kupaPageRevision(ledger,'checks'),checks0);
  assert.notEqual(kupaPageRevision(ledger,'credit'),credit0,'credit projections consume shared checks');
  assert.equal(kupaPageRevision(ledger,'notes'),notes1);
  const checks1=kupaPageRevision(ledger,'checks'),credit1=kupaPageRevision(ledger,'credit');
  ledger.touch('bankDisplay');
  assert.notEqual(kupaPageRevision(ledger,'checks'),checks1,'check bank-image actions consume the asynchronously loaded display archive');
  assert.equal(kupaPageRevision(ledger,'credit'),credit1,'display-only bank archive expansion must not evict credit derivations');
});

test('remote Orders state replacement reconciles only semantically changed collections',()=>{
  const ledger=createOrderDomainRevisions({}),before=orderState(),after=structuredClone(before),supplier0=orderViewRevision(ledger,'supplier'),warehouse0=orderViewRevision(ledger,'warehouse');
  after.warehouseOrders.push({id:'W2'});
  assert.deepEqual(ledger.reconcile(before,after),['warehouseOrders']);
  assert.equal(orderViewRevision(ledger,'supplier'),supplier0);
  assert.notEqual(orderViewRevision(ledger,'warehouse'),warehouse0);
});

test('remote Kupa state replacement separates bank metadata from feed changes',()=>{
  const ledger=createKupaDomainRevisions({}),before=kupaState(),after=structuredClone(before),credit0=kupaPageRevision(ledger,'credit'),bank0=kupaPageRevision(ledger,'bank');
  after.bank.feed.rows.push({id:'B2'});
  assert.deepEqual(ledger.reconcile(before,after),['bankFeed']);
  assert.notEqual(kupaPageRevision(ledger,'credit'),credit0,'credit reconciliation consumes bank feed data');
  assert.notEqual(kupaPageRevision(ledger,'bank'),bank0);
});

test('global epoch invalidates every cached dependency stamp for restore/import/migration',()=>{
  const orders=createOrderDomainRevisions({}),kupa=createKupaDomainRevisions({});
  const orderBefore=['supplier','customers','warehouse','checks','summary'].map(view=>orderViewRevision(orders,view));
  const kupaBefore=['dashboard','checks','credit','cash','bank','expenses','notes'].map(page=>kupaPageRevision(kupa,page));
  orders.touchAll();kupa.touchAll();
  assert.deepEqual(['supplier','customers','warehouse','checks','summary'].map((view,i)=>orderViewRevision(orders,view)!==orderBefore[i]),[true,true,true,true,true]);
  assert.deepEqual(['dashboard','checks','credit','cash','bank','expenses','notes'].map((page,i)=>kupaPageRevision(kupa,page)!==kupaBefore[i]),[true,true,true,true,true,true,true]);
});

test('remote rebase cannot restore stale cached warehouse DOM while unrelated supplier DOM remains reusable',()=>{
  const fakeDocument={createDocumentFragment:()=>new FakeFragment('fragment')},host=new FakeNode('host');host.ownerDocument=fakeDocument;
  const ledger=createOrderDomainRevisions({}),state0=orderState();
  const cache=createCleanViewCache({container:()=>host,dataRevision:view=>orderViewRevision(ledger,view),viewStateKey:()=>'',cacheable:()=>true,maxEntries:3});
  const supplier=new FakeNode('supplier'),warehouse=new FakeNode('warehouse');
  host.appendChild(supplier);cache.markRendered('supplier');
  assert.equal(cache.activate('warehouse'),false);host.appendChild(warehouse);cache.markRendered('warehouse');
  assert.equal(cache.activate('supplier'),true);assert.equal(host.firstChild,supplier);
  const state1=structuredClone(state0);state1.warehouseOrders.push({id:'W2'});ledger.reconcile(state0,state1);
  assert.equal(cache.activate('warehouse'),false,'stale detached warehouse DOM must be discarded after remote rebase');
  host.appendChild(new FakeNode('warehouse-new'));cache.markRendered('warehouse');
  assert.equal(cache.activate('supplier'),true,'unrelated supplier DOM stays warm across warehouse-only rebase');
  assert.equal(host.firstChild,supplier);
});
