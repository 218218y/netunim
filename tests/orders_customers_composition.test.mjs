import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createContexts} from '../netunim-orders/site/assets/js/state/contexts.js';
import {createOrdersCustomersRuntime} from '../netunim-orders/site/assets/js/composition/customers.js';

function ports(onSave=()=>{}){
  return {
    uiLayout:{bindScrollViewport:()=>{},mountViewLayout:()=>{}},
    uiModal:{modal:()=>{},closeModal:()=>{},confirmDialog:async()=>true,markModalDraftSaved:()=>{}},
    uiStatus:{toast:()=>{}},
    storagePersistence:{scheduleSave:onSave,canMutate:()=>true,rejectSecondaryAction:()=>false,rejectSecondaryMutation:()=>false},
    cloudAuth:{supaFetch:async()=>({})},
    uiNavigation:{setCustomerRoute:()=>{}},
    uiDateEditor:{dateEditorMarkup:()=>'',setDateValue:()=>{}},
    refreshForMorningRecovery:async()=>{},
    bankTransactions:{getTransactions:()=>[],ensureTransactions:async()=>[],onDocumentVerified:async()=>{}},
  };
}

function fixture(){
  const {model,customerUi}=createContexts();
  model.state={customerDebts:[],customerOrders:[]};
  let revision=0;
  return {model,customerUi,customers:createOrdersCustomersRuntime({model,customerUi,customerRevision:()=>revision++})};
}

test('Customers exposes totals before UI and rejects partial or double binding',()=>{
  const {model,customers}=fixture();
  model.state.customerDebts=[{id:'d1',amount:100,paid:false,invoiceIssued:false,supplied:true}];
  assert.equal(customers.customerStats().openTotal,100);
  assert.throws(()=>customers.assertReady(),/customers_ui_not_bound/);
  assert.throws(()=>customers.actions,/customers_ui_not_bound/);
  assert.throws(()=>customers.morningActions,/customers_ui_not_bound/);
  assert.throws(()=>customers.renderCustomers(),/customers_ui_not_bound/);
  assert.throws(()=>customers.recoverPendingMorningOperation(),/customers_ui_not_bound/);
  assert.throws(()=>customers.bindUi({}),/customers_layout_bindScrollViewport_required/);
  const dependencies=ports();
  assert.throws(()=>customers.bindUi({...dependencies,bankTransactions:{}}),/customers_bank_getTransactions_required/);
  assert.throws(()=>customers.bindUi({...dependencies,refreshForMorningRecovery:null}),/customers_recovery_refresh_required/);
  customers.bindUi(dependencies);
  assert.equal(customers.assertReady(),true);
  assert.throws(()=>customers.bindUi(dependencies),/customers_ui_already_bound/);
  assert.equal(typeof customers.editor.applyVerifiedMorningDocument,'function');
  assert.equal(typeof customers.view.renderCustomers,'function');
  assert.equal(customers.actions['save-debt'].startupMutationDomain,'orders');
  assert.equal(customers.morningActions['morning-create'].startupMutationDomain,'orders');
  assert.equal(typeof customers.morningActions['morning-reconcile'],'function');
});

test('Customer order actions preserve journal operations, render path, and allowed fields',()=>{
  const {model,customerUi,customers}=fixture();
  const saves=[];
  customers.bindUi(ports((message,options)=>{saves.push(options);return true}));
  const prior=globalThis.document;
  globalThis.document={querySelector:()=>null,querySelectorAll:()=>[]};
  try{
    const id=customers.editor.addCustomerOrder();
    assert.equal(model.state.customerOrders.length,1);
    assert.deepEqual(saves.at(-1).domains,['customerOrders']);
    assert.deepEqual(saves.at(-1).operations.map(row=>[row.type,row.collection,row.id]),[['put','customerOrders',id]]);
    customers.actions['save-customer-order-field']({dataset:{blurArg0:id,blurArg1:'customerName'},value:'Ada'});
    assert.equal(model.state.customerOrders[0].customerName,'Ada');
    assert.deepEqual(saves.at(-1).domains,['customerOrders']);
    customers.actions['save-customer-order-field']({dataset:{blurArg0:id,blurArg1:'non-existent'},value:'unsafe'});
    assert.equal(saves.length,2,'unlisted fields cannot initiate a save');
    assert.equal(customerUi.customerSearch,'');
  }finally{
    if(prior===undefined)delete globalThis.document;else globalThis.document=prior;
  }
});

test('Orders assembles customers and Morning once after their required producers',()=>{
  const main=fs.readFileSync(new URL('../netunim-orders/site/assets/js/main.js',import.meta.url),'utf8');
  assert.doesNotMatch(main,/from ['"]\.\/domains\/customers\//);
  assert.match(main,/const domainsCustomers=createOrdersCustomersRuntime\(/);
  assert.match(main,/domainsCustomers\.bindUi\(/);
  assert.match(main,/domainsCustomers\.assertReady\(/);
  assert.match(main,/name:'customers',actions:domainsCustomers\.actions/);
  assert.match(main,/name:'morning',actions:domainsCustomers\.morningActions/);
  assert.ok(main.indexOf('const syncDocument=createSyncDocument(')<main.indexOf('domainsCustomers.bindUi('));
  assert.ok(main.indexOf('const domainsFinanceController=createDomainsFinanceController(')<main.indexOf('domainsCustomers.bindUi('));
});
