import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createKupaCashRuntime} from '../netunim-kupa/site/assets/js/composition/cash.js';

test('Cash binds once after its shell ports exist and keeps rights writes scoped',t=>{
  const oldDocument=globalThis.document;
  t.after(()=>{globalThis.document=oldDocument});
  const content={innerHTML:''};
  globalThis.document={getElementById:id=>id==='content'?content:null};
  const model={state:{cash:[{id:'c',amount:100}],rights:[],rightsLastCalculatedDate:null}};
  const ui={bulkSelected:new Set(),cashSearchValue:''};
  const cash=createKupaCashRuntime({model,ui});
  assert.equal(cash.cashBalance(),100);
  assert.throws(()=>cash.renderCash(),/cash_ui_not_bound/);
  assert.throws(()=>cash.actions,/cash_ui_not_bound/);
  assert.throws(()=>cash.bindUi({}),/cash_bulk_syncBulkUi_required/);

  const saved=[],synced=[];
  const uiBulk={syncBulkUi:collection=>synced.push(collection),bulkControls:()=>'',bulkHeader:()=>'',bulkCell:()=>''};
  const uiDateEditor={dateEditorMarkup:()=>'<input>'};
  const domainsDashboardView={kpi:()=>'<article></article>'};
  const uiModal={armModalDraftGuard:()=>{},modal:()=>{},closeModal:()=>{}};
  const uiStatus={toast:()=>{}};
  const storagePersistence={saveState:(message,options)=>saved.push({message,options})};
  const domainsRecordsCommands={deleteRecord:()=>{}};
  const ports={uiBulk,uiDateEditor,domainsDashboardView,uiModal,uiStatus,storagePersistence,domainsRecordsCommands};
  cash.bindUi(ports);
  assert.equal(cash.assertReady(),true);
  assert.throws(()=>cash.bindUi(ports),/cash_ui_already_bound/);
  cash.renderCash();
  assert.match(content.innerHTML,/cash-ledgers/);
  assert.deepEqual(synced,['cash','rights']);
  cash.actions['set-rights-last-calculated-date']({value:'2026-09-02'});
  assert.equal(model.state.rightsLastCalculatedDate,'2026-09-02');
  assert.deepEqual(saved[0].options.domains,['rights']);
  assert.deepEqual(saved[0].options.operations,[{type:'set',field:'rightsLastCalculatedDate',value:'2026-09-02'}]);
  model.state.cash.push({id:'c2',amount:-25});
  assert.equal(cash.cashBalance(),75);
});

test('Kupa root constructs record commands before editors and owns Cash through composition',()=>{
  const main=fs.readFileSync(new URL('../netunim-kupa/site/assets/js/main.js',import.meta.url),'utf8');
  assert.doesNotMatch(main,/from ['"]\.\/domains\/cash\//);
  assert.ok(main.indexOf('const domainsRecordsCommands=')<main.indexOf('const domainsChecksEditor='));
  assert.ok(main.indexOf('const domainsRecordsCommands=')<main.indexOf('const domainsCreditEditor='));
  assert.match(main,/cash\.bindUi\(/);
  assert.match(main,/cash\.assertReady\(/);
  assert.match(main,/name:'cash',actions:cash\.actions/);
});
