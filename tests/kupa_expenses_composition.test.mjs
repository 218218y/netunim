import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createKupaExpensesRuntime} from '../netunim-kupa/site/assets/js/composition/expenses.js';

test('Expenses exposes its Credit view before editing and saves through the expenses domain',t=>{
  const oldDocument=globalThis.document;
  t.after(()=>{globalThis.document=oldDocument});
  const fields={
    eDesc:{value:'Electricity'},eAccount:{value:'עסקי'},eAmount:{value:'120'},
    eDate:{value:'2026-10-15'},eType:{value:'monthly'},eRecurring:{value:'כן'},
    eActive:{value:'כן'},eNote:{value:''},
  };
  globalThis.document={getElementById:id=>fields[id]||null};
  const model={state:{expenses:[]}},ui={expenseSearchValue:''};
  let businessReads=0,homeReads=0;
  const cycle={targetMonth:'2026-10',expenseRows:[],recurringObligations:[]};
  const expenses=createKupaExpensesRuntime({model,ui,bankForecast:{
    business:()=>{businessReads++;return cycle},home:()=>{homeReads++;return cycle},
  }});
  assert.match(expenses.expensesMarkup(),/expenses-surface/);
  assert.equal(businessReads,1);
  assert.equal(homeReads,1);
  assert.throws(()=>expenses.actions,/expenses_editor_not_bound/);
  assert.throws(()=>expenses.bindEditor({}),/expenses_modal_armModalDraftGuard_required/);

  let saveModal,rendered=0,closed=0,armed=0;
  const saves=[];
  const ports={
    uiModal:{armModalDraftGuard:()=>{armed++},modal:(_title,_body,_confirm,onSave)=>{saveModal=onSave},closeModal:()=>{closed++}},
    uiDateEditor:{dateEditorMarkup:()=>'<input>'},uiStatus:{toast:message=>{throw new Error(message)}},
    storagePersistence:{saveState:(message,options)=>saves.push({message,options})},
    domainsRecordsCommands:{deleteRecord:()=>{}},renderCredit:()=>{rendered++},
  };
  expenses.bindEditor(ports);
  assert.equal(expenses.assertReady(),true);
  assert.throws(()=>expenses.bindEditor(ports),/expenses_editor_already_bound/);
  expenses.actions['open-expense-modal']({dataset:{}});
  assert.equal(armed,1);
  saveModal();
  assert.equal(model.state.expenses.length,1);
  assert.deepEqual(saves[0].options.domains,['expenses']);
  assert.equal(saves[0].options.operations[0].collection,'expenses');
  assert.equal(rendered,1);
  assert.equal(closed,1);
});

test('Kupa root composes Expenses through a view port and a later editor bind',()=>{
  const main=fs.readFileSync(new URL('../netunim-kupa/site/assets/js/main.js',import.meta.url),'utf8');
  assert.doesNotMatch(main,/from ['"]\.\/domains\/expenses\//);
  assert.ok(main.indexOf('const expenses=createKupaExpensesRuntime(')<main.indexOf('credit.bindView('));
  assert.ok(main.indexOf('expenses.bindEditor(')>main.indexOf('credit.bindView('));
  assert.match(main,/expensesMarkup:\(\.\.\.args\)=>expenses\.expensesMarkup/);
  assert.match(main,/name:'expenses',actions:expenses\.actions/);
});
