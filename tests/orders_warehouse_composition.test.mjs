import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createOrdersWarehouseRuntime} from '../netunim-orders/site/assets/js/composition/warehouse.js';
import {createContexts} from '../netunim-orders/site/assets/js/state/contexts.js';

function ports(onSave, onSettings){
  return {
    uiLayout:{mountViewLayout:()=>{}},
    uiModal:{modal:()=>{},closeModal:()=>{},confirmDialog:async()=>true},
    uiStatus:{toast:()=>{}},
    storagePersistence:{scheduleSave:onSave},
    uiDateEditor:{dateEditorMarkup:()=>''},
    uiSettings:{renderSettings:onSettings},
  };
}

test('Warehouse has one validated bind phase and read-only selectors before UI',()=>{
  const {model,warehouseUi,ui}=createContexts();
  model.state={inventoryItems:[{id:'i1',name:'Chair',category:'Furniture',active:true}],inventoryEvents:[],warehouseOrders:[]};
  let revisions=0;
  const warehouse=createOrdersWarehouseRuntime({model,warehouseUi,ui,inventoryRevision:()=>revisions});
  assert.deepEqual(warehouse.orderedInventoryCategoryNames(),['Furniture']);
  assert.throws(()=>warehouse.renderWarehouse(),/warehouse_ui_not_bound/);
  assert.throws(()=>warehouse.openInventoryItemModal(),/warehouse_ui_not_bound/);
  assert.throws(()=>warehouse.actions,/warehouse_ui_not_bound/);
  assert.throws(()=>warehouse.bindUi({}),/warehouse_layout_mountViewLayout_required/);
  const readyPorts=ports(()=>{},()=>{});
  assert.throws(()=>warehouse.bindUi({...readyPorts,uiSettings:{}}),/warehouse_settings_renderSettings_required/);
  warehouse.bindUi(readyPorts);
  assert.equal(warehouse.assertReady(),true);
  assert.throws(()=>warehouse.bindUi(readyPorts),/warehouse_ui_already_bound/);
  assert.equal(warehouse.actions['save-inventory-category-order'].startupMutationDomain,'orders');
  assert.equal(warehouse.actions['set-warehouse-order-status-2'].startupMutationDomain,'orders');
});

test('Warehouse action pack retains distinct journal domains for category changes and customer orders',()=>{
  const {model,warehouseUi,ui}=createContexts();
  model.state={
    inventoryItems:[{id:'i1',name:'Chair',category:'Furniture',active:true}],
    inventoryEvents:[],inventoryCategoryOrder:[],
    warehouseOrders:[{id:'w1',customerName:'Buyer',status:'to_order'}],
  };
  ui.currentView='settings';
  warehouseUi.inventoryCategoryOrderDraft=['Furniture'];
  warehouseUi.warehouseTab='orders';
  const saved=[];
  let settingsRendered=0;
  const warehouse=createOrdersWarehouseRuntime({model,warehouseUi,ui,inventoryRevision:()=>0});
  warehouse.bindUi(ports((message,options)=>saved.push(options),()=>{settingsRendered++}));

  warehouse.actions['save-inventory-category-order']();
  assert.deepEqual(saved[0].domains,['inventory']);
  assert.deepEqual(saved[0].operations,[{type:'set',field:'inventoryCategoryOrder',value:['Furniture']}]);
  assert.equal(settingsRendered,1);

  const previousDocument=globalThis.document;
  globalThis.document={querySelector:()=>null};
  try{
    warehouse.actions['set-warehouse-order-status-2']({dataset:{clickArg0:'w1'}});
  }finally{
    if(previousDocument===undefined)delete globalThis.document;
    else globalThis.document=previousDocument;
  }
  assert.equal(model.state.warehouseOrders[0].status,'ordered');
  assert.deepEqual(saved[1].domains,['warehouseOrders']);
  assert.equal(saved[1].operations[0].collection,'warehouseOrders');
  assert.equal(saved[1].operations[0].id,'w1');
});

test('Orders root owns Warehouse only through its capability boundary',()=>{
  const main=fs.readFileSync(new URL('../netunim-orders/site/assets/js/main.js',import.meta.url),'utf8');
  assert.doesNotMatch(main,/from ['"]\.\/domains\/(inventory|warehouse)\//);
  assert.match(main,/warehouse\.bindUi\(/);
  assert.match(main,/warehouse\.assertReady\(/);
  assert.match(main,/name:'warehouse',actions:warehouse\.actions/);
  assert.match(main,/renderWarehouse:\(\.\.\.args\)=>warehouse\.renderWarehouse\(\.\.\.args\)/);
});
