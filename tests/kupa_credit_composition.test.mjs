import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createKupaCreditRuntime} from '../netunim-kupa/site/assets/js/composition/credit.js';

test('Credit waits for its finance controller, then binds editing without enabling manual creation',()=>{
  const model={state:{credits:[],cards:[],creditSync:{profiles:[],cardMappings:{}}}};
  const ui={creditSearchValue:''};
  const credit=createKupaCreditRuntime({model,ui});
  assert.throws(()=>credit.renderCredit(),/credit_view_not_bound/);
  assert.throws(()=>credit.bindEditor(),/credit_view_not_bound/);
  assert.throws(()=>credit.bindView({}),/credit_controller_creditSyncUiState_required/);

  const controller={creditSyncUiState:()=>({}),refreshCreditBridgeStatus:()=>{}};
  const uiBulk=Object.fromEntries(['syncBulkUi','bulkControls','bulkHeader','bulkCell'].map(name=>[name,()=>{}]));
  const uiDateEditor={dateEditorMarkup:()=>'<input>',setDateValue:()=>{}};
  const viewPorts={controller,uiBulk,uiDateEditor,financeDerivations:{run:fn=>fn()},domainRevisions:{stamp:()=>0},expensesMarkup:()=>''};
  credit.bindView(viewPorts);
  assert.throws(()=>credit.bindView(viewPorts),/credit_view_already_bound/);
  assert.throws(()=>credit.actions,/credit_editor_not_bound/);

  const messages=[];
  const editorPorts={
    uiModal:{armModalDraftGuard:()=>{},modal:()=>{},closeModal:()=>{}},
    uiDateEditor,uiStatus:{toast:message=>messages.push(message)},
    storagePersistence:{saveState:()=>{}},domainsRecordsCommands:{deleteRecord:()=>{}},
  };
  credit.bindEditor(editorPorts);
  assert.equal(credit.assertReady(),true);
  assert.throws(()=>credit.bindEditor(editorPorts),/credit_editor_already_bound/);
  credit.actions['open-credit-modal-2']({dataset:{clickArg0:''}});
  assert.equal(model.state.credits.length,0);
  assert.equal(messages.length,1);
});

test('Kupa root binds Credit after finance, then delegates UI through its public ports',()=>{
  const main=fs.readFileSync(new URL('../netunim-kupa/site/assets/js/main.js',import.meta.url),'utf8');
  assert.doesNotMatch(main,/from ['"]\.\/domains\/credit\/(?:selectors|view|editor)\.js['"]/);
  assert.ok(main.indexOf('const credit=createKupaCreditRuntime(')<main.indexOf('const uiNavigation='));
  assert.ok(main.indexOf('credit.bindView(')>main.indexOf('}=composeKupaFinance('));
  assert.ok(main.indexOf('credit.bindEditor(')>main.indexOf('const domainsRecordsCommands='));
  assert.match(main,/name:'credit',actions:credit\.actions/);
});
