import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createKupaChecksRuntime} from '../netunim-kupa/site/assets/js/composition/checks.js';

test('Checks binds view and editor in order, and persists check mutations through the shared checks port',()=>{
  const check={id:'CHK-1',name:'Customer',status:'בקופה',account:'עסקי',amount:120,dueDate:'2026-11-01'};
  const model={state:{checks:[check]}};
  const ui={bulkSelected:new Set(),checkSearchValue:''};
  const checks=createKupaChecksRuntime({model,ui});
  assert.equal(checks.checksBalance(),120);
  assert.equal(checks.depositedBalance(),0);
  assert.throws(()=>checks.renderChecks(),/checks_view_not_bound/);
  assert.throws(()=>checks.markCheckSeriesManual({}),/checks_editor_not_bound/);
  assert.throws(()=>checks.bindEditor(),/checks_view_not_bound/);
  assert.throws(()=>checks.bindView({}),/checks_bulk_syncBulkUi_required/);

  const uiBulk=Object.fromEntries(['syncBulkUi','bulkControls','bulkHeader','bulkCell','deleteBulkSelected','toggleBulkMode','toggleBulkRow','toggleBulkVisible'].map(name=>[name,()=>{}]));
  checks.bindView({uiBulk,getBankImageContext:()=>({})});
  assert.throws(()=>checks.bindView({uiBulk,getBankImageContext:()=>({})}),/checks_view_already_bound/);
  assert.throws(()=>checks.actions,/checks_editor_not_bound/);

  const saved=[];
  let changed=0;
  const uiDateEditor=Object.fromEntries(['checkDateEditorMarkup','setCheckDateValue','normalizeCheckModalDates','applyCheckDatePicker','handleCheckDatePartBlur','handleCheckDatePartInput','handleCheckDatePartKeydown','openCheckDatePicker'].map(name=>[name,()=>{}]));
  const ports={
    uiBulk,uiDateEditor,
    uiModal:{armModalDraftGuard:()=>{},modal:()=>{},closeModal:()=>{}},
    uiStatus:{toast:()=>{}},storagePersistence:{saveChecksState:(message,options)=>saved.push({message,options})},
    domainsRecordsCommands:{deleteRecord:()=>{}},uiNavigation:{checksChanged:()=>{changed++}},
  };
  checks.bindEditor(ports);
  assert.equal(checks.assertReady(),true);
  assert.throws(()=>checks.bindEditor(ports),/checks_editor_already_bound/);
  checks.actions['mark-deposited']({dataset:{clickArg0:check.id}});
  assert.equal(checks.checksBalance(),0);
  assert.equal(checks.depositedBalance(),120);
  assert.equal(saved.length,1);
  assert.deepEqual(saved[0].options.operations.map(({collection,id,mode})=>({collection,id,mode})),[{collection:'checks',id:check.id,mode:'replace'}]);
  assert.equal(changed,1);
});

test('Kupa root binds Checks after finance and before interactive startup',()=>{
  const main=fs.readFileSync(new URL('../netunim-kupa/site/assets/js/main.js',import.meta.url),'utf8');
  assert.doesNotMatch(main,/from ['"]\.\/domains\/checks\//);
  assert.ok(main.indexOf('const checks=createKupaChecksRuntime(')<main.indexOf('const uiDateEditor='));
  assert.ok(main.indexOf('checks.bindView(')>main.indexOf('}=composeKupaFinance('));
  assert.ok(main.indexOf('checks.bindEditor(')>main.indexOf('const domainsRecordsCommands='));
  assert.ok(main.indexOf('checks.assertReady()')<main.indexOf('const lifecycle='));
  assert.match(main,/name:'checks',actions:checks\.actions/);
});
