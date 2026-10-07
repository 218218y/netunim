import test from 'node:test';
import assert from 'node:assert/strict';
import {composeActionRegistry} from '../shared/action-registry.js';
import {createCreditCardOrderView} from '../shared/credit-card-order-view.js';
import {createNotesWorkbook} from '../shared/notes-workbook.js';
import {createSpreadsheetWorkspace} from '../shared/spreadsheet-workspace.js';
import {createChecksActions,createBankActions,createShellActions,createCreditActions,createCashActions,createNotesActions,createExpensesActions,createSettingsActions,createBackupActions,createCloudActions} from '../netunim-kupa/site/assets/js/ui/actions.js';

test('action packs reject collisions and retain the exact handler and mutation metadata',()=>{
  const save=()=>{};
  Object.defineProperty(save,'startupMutationDomain',{value:'orders'});
  const actions=composeActionRegistry([{name:'orders',actions:{save}}]);
  assert.equal(actions.save,save);
  assert.equal(actions.save.startupMutationDomain,'orders');
  assert.equal(Object.getPrototypeOf(actions),null);
  assert.equal(actions.toString,undefined);
  assert.ok(Object.isFrozen(actions));
  assert.throws(()=>composeActionRegistry([{name:'a',actions:{save}},{name:'b',actions:{save}}]),/Duplicate UI action save: a and b/);
  assert.throws(()=>composeActionRegistry([{name:'a',actions:{}},{name:'a',actions:{}}]),/duplicate action pack/);
  assert.throws(()=>composeActionRegistry([{name:'a',actions:{save:null}}]),/Invalid UI action/);
});

test('Kupa capability action packs compose with the workbook, spreadsheet, and card-order actions',()=>{
  const port=new Proxy({}, {get:()=>()=>{}});
  const ui={bulkSelected:new Set()};
  const creditOrder=createCreditCardOrderView({getSync:()=>({}),saveOrder:()=>true,modal:()=>{},closeModal:()=>{},render:()=>{},escapeHtml:String});
  const workbook=createNotesWorkbook({model:{state:{notesSheet:null}},ui,saveState:()=>{},confirmDialog:()=>true,renderNotes:()=>{},uid:()=>'',esc:String,searchMatch:()=>true,site:'kupa'});
  const spreadsheet=createSpreadsheetWorkspace({domain:'kupa',request:()=>{},account:()=>'',enabled:()=>false,primary:()=>true,active:()=>false,render:()=>{},legacy:()=>null,esc:String,confirmDialog:()=>true,modal:()=>{},closeModal:()=>{}});
  const actions=composeActionRegistry([
    {name:'checks',actions:createChecksActions({domainsChecksEditor:port,domainsChecksView:port,ui,uiBulk:port,uiDateEditor:port,uiModal:port})},
    {name:'bank',actions:createBankActions({domainsBankController:port,domainsBankView:port,importFinanceConnections:()=>{},ui,uiStatus:port})},
    {name:'shell',actions:createShellActions({uiModal:port,uiNavigation:port})},
    {name:'credit',actions:createCreditActions({domainsCreditController:port,domainsCreditEditor:port,domainsCreditView:port,ui})},
    {name:'credit-order',actions:creditOrder.actions},
    {name:'cash',actions:createCashActions({domainsCashController:port,domainsCashEditor:port,domainsCashView:port,ui})},
    {name:'notes',actions:createNotesActions({domainsNotesController:port,ui})},
    {name:'notes-sheet',actions:workbook.sheetActions},
    {name:'spreadsheet-workspace',actions:spreadsheet.actions},
    {name:'expenses',actions:createExpensesActions({domainsExpensesEditor:port,domainsExpensesView:port,ui})},
    {name:'settings',actions:createSettingsActions({uiSettings:port})},
    {name:'backup',actions:createBackupActions({uiBackup:port,uiFolders:port})},
    {name:'cloud',actions:createCloudActions({syncDocument:port,uiCloud:port})},
  ]);
  assert.ok(Object.keys(actions).length>140);
  assert.equal(typeof actions['notes-sheet-page'],'function');
  assert.equal(typeof actions['spreadsheet-restore'],'function');
  assert.equal(typeof actions['credit-card-order-save'],'function');
  assert.equal(typeof actions['reset-local-site-storage'],'function');
  assert.equal(typeof actions['ack-bank-missing'],'function');
});
