import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createContexts} from '../netunim-orders/site/assets/js/state/contexts.js';
import {createOrdersServiceRuntime} from '../netunim-orders/site/assets/js/composition/service.js';

function ports(onSave=()=>{}){
  return {
    uiLayout:{mountViewLayout:()=>{}},
    uiModal:{modal:()=>{},closeModal:()=>{},confirmDialog:async()=>true},
    uiStatus:{toast:()=>{}},
    storagePersistence:{scheduleSave:onSave},
    uiDateEditor:{dateEditorMarkup:()=>''},
  };
}
function fixture(){
  const {model,serviceUi}=createContexts();
  model.state={serviceCalls:[]};
  return {model,serviceUi,service:createOrdersServiceRuntime({model,serviceUi,serviceRevision:()=>0})};
}

test('Service requires complete UI ports and binds once',()=>{
  const {service}=fixture();
  assert.throws(()=>service.renderService(),/service_ui_not_bound/);
  assert.throws(()=>service.actions,/service_ui_not_bound/);
  assert.throws(()=>service.bindUi({}),/service_layout_mountViewLayout_required/);
  assert.throws(()=>service.bindUi({...ports(),uiDateEditor:{}}),/service_date_dateEditorMarkup_required/);
  const dependencies=ports();
  service.bindUi(dependencies);
  assert.equal(service.assertReady(),true);
  assert.throws(()=>service.bindUi(dependencies),/service_ui_already_bound/);
  assert.equal(service.actions['toggle-service-flag'].startupMutationDomain,'orders');
  assert.equal(service.actions['save-service'].startupMutationDomain,'orders');
});

test('Service actions preserve service-only journal scope and replace operation',()=>{
  const {model,service}=fixture();
  model.state.serviceCalls=[{id:'s1',customerName:'Ada',closed:false,followUp:false}];
  const saves=[];
  service.bindUi(ports((message,options)=>{saves.push(options);return true}));
  const oldDocument=globalThis.document,oldCSS=globalThis.CSS;
  globalThis.document={querySelector:()=>null,querySelectorAll:()=>[]};
  globalThis.CSS={escape:value=>value};
  try{
    service.actions['toggle-service-flag']({dataset:{clickArg0:'s1',clickArg1:'followUp'}});
    assert.equal(model.state.serviceCalls[0].followUp,true);
    assert.deepEqual(saves[0].domains,['service']);
    assert.deepEqual(saves[0].operations.map(row=>[row.type,row.collection,row.id]),[['put','serviceCalls','s1']]);
  }finally{
    if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument;
    if(oldCSS===undefined)delete globalThis.CSS;else globalThis.CSS=oldCSS;
  }
});

test('Orders main wires Service through one capability instead of individual controllers',()=>{
  const main=fs.readFileSync(new URL('../netunim-orders/site/assets/js/main.js',import.meta.url),'utf8');
  assert.doesNotMatch(main,/from ['"]\.\/domains\/service\//);
  assert.match(main,/service\.bindUi\(/);
  assert.match(main,/service\.assertReady\(/);
  assert.match(main,/name:'service',actions:service\.actions/);
  assert.match(main,/renderService:\(\.\.\.args\)=>service\.renderService\(\.\.\.args\)/);
});
