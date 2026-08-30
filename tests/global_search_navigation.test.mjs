import test from 'node:test';
import assert from 'node:assert/strict';
import {createUiGlobalSearch} from '../netunim-orders/site/assets/js/ui/global-search.js';

function harness(state={}){
  const calls={views:[],renders:[],modals:[]};
  const ui={checkTab:'open',checkYear:'2026',checkSearchValue:'local'};
  const supplierUi={currentSupplierId:null,filterMode:'pending',searchText:'local',supplierYearView:'current'};
  const customerUi={customerSearch:'local',customerOrderFilter:'attention',customerTab:'orders',customerFilter:'open'};
  const serviceUi={serviceSearch:'local',serviceFilter:'open'};
  const warehouseUi={warehouseSearch:'local',warehouseTab:'stock'};
  const previousDocument=globalThis.document,previousRaf=globalThis.requestAnimationFrame;
  globalThis.document={querySelectorAll:()=>[]};
  globalThis.requestAnimationFrame=callback=>{callback();return 1};
  const search=createUiGlobalSearch({
    model:{state:{suppliers:[],transactions:[],customerDebts:[],customerOrders:[],serviceCalls:[],inventoryItems:[],inventoryEvents:[],warehouseOrders:[],checks:[],notes:[],...state}},
    ui,supplierUi,customerUi,serviceUi,warehouseUi,
    prepareView:view=>calls.views.push(view),
    render:options=>calls.renders.push(options),
    openInventoryItemModal:id=>calls.modals.push(id),
  });
  return {search,ui,supplierUi,customerUi,serviceUi,warehouseUi,calls,restore(){globalThis.document=previousDocument;globalThis.requestAnimationFrame=previousRaf}};
}

test('global result navigation reveals historical supplier transactions across year filters',()=>{
  const h=harness();
  try{
    assert.equal(h.search.navigateItem({group:'suppliers',kind:'supplier-transaction',id:'tx-1',parentId:'supplier-1'}),true);
    assert.deepEqual(h.calls.views,['supplier']);
    assert.equal(h.supplierUi.currentSupplierId,'supplier-1');
    assert.equal(h.supplierUi.filterMode,'all');
    assert.equal(h.supplierUi.searchText,'');
    assert.equal(h.supplierUi.supplierYearView,'all');
    assert.deepEqual(h.calls.renders,[{supplierScrollMode:'start'}]);
  }finally{h.restore()}
});

test('global result navigation selects filters that keep paid and closed customer records visible',()=>{
  const h=harness({customerDebts:[{id:'debt-paid',paid:true,invoiceIssued:false},{id:'debt-closed',paid:true,invoiceIssued:true}],serviceCalls:[{id:'service-1',closed:true}]});
  try{
    h.search.navigateItem({group:'customers',kind:'customer-debt',id:'debt-paid'});
    assert.equal(h.customerUi.customerTab,'debts');
    assert.equal(h.customerUi.customerFilter,'invoice');
    assert.equal(h.customerUi.customerSearch,'');
    h.search.navigateItem({group:'customers',kind:'customer-debt',id:'debt-closed'});
    assert.equal(h.customerUi.customerFilter,'closed');
    h.search.navigateItem({group:'service',kind:'service-call',id:'service-1'});
    assert.equal(h.serviceUi.serviceFilter,'closed');
    assert.equal(h.serviceUi.serviceSearch,'');
    assert.deepEqual(h.calls.views,['customers','customers','service']);
  }finally{h.restore()}
});

test('global check navigation removes local tab, year and search constraints',()=>{
  const h=harness();
  try{
    h.search.navigateItem({group:'checks',kind:'check',id:'check-1'});
    assert.deepEqual(h.calls.views,['checks']);
    assert.equal(h.ui.checkTab,'all');
    assert.equal(h.ui.checkYear,'all');
    assert.equal(h.ui.checkSearchValue,'');
    assert.equal(h.calls.renders.length,1);
  }finally{h.restore()}
});

test('global warehouse navigation opens the native destination for active, archived, order and history results',()=>{
  const h=harness({inventoryItems:[{id:'active',active:true},{id:'archived',active:false}]});
  try{
    h.search.navigateItem({group:'warehouse',kind:'inventory-item',id:'active'});
    assert.equal(h.warehouseUi.warehouseTab,'stock');
    h.search.navigateItem({group:'warehouse',kind:'warehouse-order',id:'order-1'});
    assert.equal(h.warehouseUi.warehouseTab,'orders');
    h.search.navigateItem({group:'warehouse',kind:'inventory-event',id:'event-1'});
    assert.equal(h.warehouseUi.warehouseTab,'history');
    h.search.navigateItem({group:'warehouse',kind:'inventory-item',id:'archived'});
    assert.equal(h.warehouseUi.warehouseTab,'history');
    assert.deepEqual(h.calls.modals,['archived']);
    assert.equal(h.warehouseUi.warehouseSearch,'');
    assert.deepEqual(h.calls.views,['warehouse','warehouse','warehouse','warehouse']);
  }finally{h.restore()}
});

test('unknown global result groups are rejected without navigation side effects',()=>{
  const h=harness();
  try{
    assert.equal(h.search.navigateItem({group:'unknown',kind:'x',id:'1'}),false);
    assert.deepEqual(h.calls.views,[]);
    assert.deepEqual(h.calls.renders,[]);
  }finally{h.restore()}
});
