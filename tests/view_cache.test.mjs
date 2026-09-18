import test from 'node:test';
import assert from 'node:assert/strict';
import {createCleanViewCache} from '../shared/clean-view-cache.js';
import {createUiNavigation as createKupaNavigation} from '../netunim-kupa/site/assets/js/ui/navigation.js';
import {createUiNavigation as createOrdersNavigation} from '../netunim-orders/site/assets/js/ui/navigation.js';

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
function harness(){
  const document={createDocumentFragment:()=>new FakeFragment('fragment')},host=new FakeNode('host');host.ownerDocument=document;
  const revisions={a:0,b:0,c:0,d:0},states={a:'',b:'',c:'',d:''};
  const cache=createCleanViewCache({container:()=>host,dataRevision:key=>revisions[key],viewStateKey:key=>states[key],maxEntries:2});
  return {host,revisions,states,cache,node:name=>new FakeNode(name)};
}

test('clean view cache restores the exact detached DOM only while revision and UI state are unchanged',()=>{
  const h=harness(),a=h.node('a'),b=h.node('b');h.host.appendChild(a);h.cache.markRendered('a');
  assert.equal(h.cache.activate('b'),false);assert.equal(h.host.children.length,0);h.host.appendChild(b);h.cache.markRendered('b');
  assert.equal(h.cache.activate('a'),true);assert.equal(h.host.children[0],a,'restoration keeps node identity instead of rebuilding markup');
  h.revisions.a++;assert.equal(h.cache.activate('b'),true);assert.equal(h.cache.activate('a'),false,'data revision invalidates the detached DOM');assert.equal(h.host.children.length,0);
});

test('direct domain rerenders are discarded unless navigation has stamped the new UI state',()=>{
  const h=harness(),old=h.node('old'),direct=h.node('direct'),b=h.node('b');h.host.appendChild(old);h.cache.markRendered('a');
  h.states.a='changed';h.host.replaceChildren(direct); // simulates renderCustomers/renderWarehouse called directly
  assert.equal(h.cache.activate('b'),false);h.host.appendChild(b);h.cache.markRendered('b');
  h.states.a='';assert.equal(h.cache.activate('a'),false,'an unstamped direct rerender can never be restored under an older state key');
});

test('clean view cache is bounded by LRU size',()=>{
  const h=harness();
  for(const key of ['a','b','c']){h.host.appendChild(h.node(key));h.cache.markRendered(key);h.cache.activate(key==='a'?'b':key==='b'?'c':'d')}
  assert.deepEqual(h.cache.cachedKeys(),['b','c']);
});


test('Kupa navigation reuses a clean warm page and rerenders after a data revision',t=>{
  const previousDocument=globalThis.document;t.after(()=>{globalThis.document=previousDocument});
  const fakeDocument={createDocumentFragment:()=>new FakeFragment('fragment')},host=new FakeNode('content');host.ownerDocument=fakeDocument;
  const title={textContent:''},sub={textContent:''},sidebar={classList:{remove(){}}};
  fakeDocument.getElementById=id=>id==='content'?host:id==='pageTitle'?title:id==='pageSub'?sub:id==='sidebar'?sidebar:null;
  fakeDocument.querySelectorAll=()=>[];globalThis.document=fakeDocument;
  const ui={currentPage:'dashboard',bulkCollection:null,bulkSelected:new Set(),checkTab:'all',checkAccount:'all',checkYear:'all'};
  let revision=0,dashboardRenders=0,checkRenders=0;
  const draw=name=>host.appendChild(new FakeNode(name));
  const nav=createKupaNavigation({ui,dataRevision:()=>revision,renderDashboard:()=>{dashboardRenders++;draw('dashboard')},renderChecks:()=>{checkRenders++;draw('checks')},renderCredit:()=>{},renderCash:()=>{},renderBank:()=>{},renderNotes:()=>{},renderSettings:()=>{},maybeAutoRefreshBankBalance:()=>{},maybeAutoRefreshCreditSync:()=>{}});
  nav.setPage('dashboard');const firstDashboard=host.firstChild;
  nav.setPage('checks');nav.setPage('dashboard');
  assert.equal(dashboardRenders,1);assert.equal(host.firstChild,firstDashboard,'clean page restores exact DOM rather than rebuilding');
  revision++;nav.setPage('checks');nav.setPage('dashboard');
  assert.equal(checkRenders,2);assert.equal(dashboardRenders,2,'a data revision invalidates both previously rendered warm pages conservatively');
});

test('Orders navigation reuses a clean supplier view but refuses stale DOM after revision changes',t=>{
  const previousDocument=globalThis.document;t.after(()=>{globalThis.document=previousDocument});
  const fakeDocument={createDocumentFragment:()=>new FakeFragment('fragment')},host=new FakeNode('main');host.ownerDocument=fakeDocument;
  fakeDocument.getElementById=id=>id==='main'?host:null;fakeDocument.querySelectorAll=()=>[];globalThis.document=fakeDocument;
  const ui={currentView:'supplier'},supplierUi={currentSupplierId:null,filterMode:'all',searchText:'',supplierYearView:'current',supplierBulkMode:false,supplierBulkSelected:new Set(),supplierBulkAnchorId:null,supplierMoveTargetId:null},customerUi={customerTab:'debts',customerFilter:'all',customerSearch:'',customerBulkMode:false,customerBulkSelected:new Set(),customerBulkAnchorId:null},serviceUi={serviceFilter:'all',serviceSearch:'',serviceBulkMode:false,serviceBulkSelected:new Set(),serviceBulkAnchorId:null},warehouseUi={warehouseTab:'stock',inventoryLocation:'all',inventoryGrouping:'category',inventoryFilter:'all',inventoryHistoryItem:null,warehouseSearch:'',warehouseBulkMode:false,warehouseBulkSelected:new Set(),warehouseBulkAnchorId:null,warehouseOrdersPickedOpen:false,inventoryCategoryOpen:new Set(),inventoryLocationOpen:new Set()},notesUi={notesBulkMode:false,notesBulkSelected:new Set(),notesBulkAnchorId:null};
  const model={state:{suppliers:[{id:'S1'}]}},noop=()=>{};let revision=0,supplierRenders=0,customerRenders=0;
  const draw=name=>host.appendChild(new FakeNode(name));
  const nav=createOrdersNavigation({ui,model,supplierUi,customerUi,serviceUi,warehouseUi,notesUi,dataRevision:()=>revision,renderSupplier:()=>{supplierRenders++;draw('supplier')},renderCustomers:()=>{customerRenders++;draw('customers')},renderKupa:noop,renderChecks:noop,renderSummary:noop,renderService:noop,renderWarehouse:noop,renderNotes:noop,renderCalendar:noop,renderSettings:noop});
  nav.switchView('supplier');const firstSupplier=host.firstChild;nav.switchView('customers');nav.switchView('supplier');
  assert.equal(supplierRenders,1);assert.equal(host.firstChild,firstSupplier);
  revision++;nav.switchView('customers');nav.switchView('supplier');
  assert.equal(customerRenders,2);assert.equal(supplierRenders,2);
});


test('view cache applies a total node/row budget and skips oversized views without evicting useful ones',()=>{
  const document={createDocumentFragment:()=>new FakeFragment()},host=new FakeNode();host.ownerDocument=document;
  const cache=createCleanViewCache({container:host,maxEntries:10,maxNodes:5,maxRows:2});
  const draw=(key,count,row=false)=>{for(let i=0;i<count;i++){const n=new FakeNode(key);if(row)n.nodeName='TR';host.appendChild(n)}cache.markRendered(key)};
  draw('a',2);cache.activate('b');draw('b',2);cache.activate('c');
  assert.deepEqual(cache.cachedKeys(),['a','b']);
  draw('c',2);cache.activate('huge');assert.deepEqual(cache.cachedKeys(),['b','c'],'node budget evicts oldest');
  draw('huge',6);cache.activate('rows');assert.deepEqual(cache.cachedKeys(),['b','c']);
  draw('rows',3,true);cache.activate('b');assert.equal(host.firstChild.name,'b','oversized table was not cached');
  assert.deepEqual(cache.cachedKeys(),['c']);
});
