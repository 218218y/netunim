import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createOrdersSuppliersRuntime} from '../netunim-orders/site/assets/js/composition/suppliers.js';

function uiPorts(onSave,onRender,onClose){
  const uiLayout=Object.fromEntries([
    'mountViewLayout','captureSupplierViewport','restoreSupplierViewport',
    'storeSupplierViewport','scrollSupplierTransactionsEnd',
  ].map(name=>[name,()=>{}]));
  const uiModal=Object.fromEntries([
    'modal','triSelect','parseTri','confirmDialog',
  ].map(name=>[name,()=>{}]));
  uiModal.closeModal=onClose;
  return {uiLayout,uiNavigation:{render:onRender},uiModal,uiStatus:{toast:()=>{}},storagePersistence:{scheduleSave:onSave}};
}

test('Suppliers is explicitly bound before actions or rendering and preserves its save domain',()=>{
  const model={state:{suppliers:[{id:'a',name:'A'},{id:'b',name:'B'}],transactions:[]}};
  const supplierUi={currentSupplierId:null,supplierOrderDraft:['b','a']};
  const ui={currentView:'summary'};
  const suppliers=createOrdersSuppliersRuntime({model,supplierUi,ui});
  assert.equal(suppliers.orderedSuppliers().length,2);
  assert.equal(typeof suppliers.dashboardPorts().supplierBalance,'function');
  assert.throws(()=>suppliers.assertReady(),/suppliers_ui_not_bound/);
  assert.throws(()=>suppliers.renderSupplier(),/suppliers_ui_not_bound/);
  assert.throws(()=>suppliers.backupPorts(),/suppliers_ui_not_bound/);
  assert.throws(()=>suppliers.actions,/suppliers_ui_not_bound/);
  assert.throws(()=>suppliers.bindUi({}),/suppliers_layout_mountViewLayout_required/);

  let saved,rendered=0,closed=0;
  const ports=uiPorts((message,options)=>{saved={message,options}},()=>{rendered++},()=>{closed++});
  suppliers.bindUi(ports);
  assert.equal(suppliers.assertReady(),true);
  assert.throws(()=>suppliers.bindUi(ports),/suppliers_ui_already_bound/);
  assert.equal(typeof suppliers.navigation.chooseSupplier,'function');
  assert.equal(typeof suppliers.backupPorts().boolText,'function');
  assert.equal(suppliers.actions['save-supplier-order'].startupMutationDomain,'orders');
  suppliers.actions['save-supplier-order']();
  assert.deepEqual(saved.options.domains,['suppliers','transactions']);
  assert.deepEqual(saved.options.operations.map(row=>row.id),['a','b']);
  assert.deepEqual(model.state.suppliers.map(row=>row.sortOrder),[1,0]);
  assert.equal(rendered,1);
  assert.equal(closed,1);
});

test('Orders root composes Suppliers through one capability boundary',()=>{
  const main=fs.readFileSync(new URL('../netunim-orders/site/assets/js/main.js',import.meta.url),'utf8');
  assert.doesNotMatch(main,/from ['"]\.\/domains\/suppliers\//);
  assert.match(main,/suppliers\.bindUi\(/);
  assert.match(main,/suppliers\.assertReady\(/);
  assert.match(main,/name:'suppliers',actions:suppliers\.actions/);
});
