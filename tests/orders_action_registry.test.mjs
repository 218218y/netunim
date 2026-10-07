import test from 'node:test';
import assert from 'node:assert/strict';
import {composeActionRegistry} from '../shared/action-registry.js';
import {createCreditCardOrderView} from '../shared/credit-card-order-view.js';
import {createNotesWorkbook} from '../shared/notes-workbook.js';
import {createSpreadsheetWorkspace} from '../shared/spreadsheet-workspace.js';
import {createExternalActionPacks,createAlertsActions,createFinanceBankActions,createFinanceCreditActions,createChecksActions,createShellActions,createDashboardActions,createSuppliersActions,createCustomersActions,createMorningActions,createServiceActions,createWarehouseActions,createBackupActions,createCloudActions,createNotesActions,createCalendarActions,wrapMutationActions} from '../netunim-orders/site/assets/js/ui/actions.js';

test('Orders capability packs compose with the exact startup mutation domains',()=>{
  const port=new Proxy({}, {get:()=>()=>{}});
  const ui={checksBulkSelected:new Set()};
  const creditOrder=createCreditCardOrderView({getSync:()=>({}),saveOrder:()=>true,modal:()=>{},closeModal:()=>{},render:()=>{},escapeHtml:String});
  const workbook=createNotesWorkbook({model:{state:{notesSheet:null}},ui,saveState:()=>{},confirmDialog:()=>true,renderNotes:()=>{},uid:()=>'',esc:String,searchMatch:()=>true,site:'orders'});
  const spreadsheet=createSpreadsheetWorkspace({domain:'orders',request:()=>{},account:()=>'',enabled:()=>false,primary:()=>true,active:()=>false,render:()=>{},legacy:()=>null,esc:String,confirmDialog:()=>true,modal:()=>{},closeModal:()=>{}});
  const actions=composeActionRegistry([
    ...createExternalActionPacks({notesSheetActions:{...workbook.sheetActions,...spreadsheet.actions},creditOrderActions:creditOrder.actions}),
    {name:'alerts',actions:createAlertsActions({uiAlertCenter:port})},
    {name:'finance-bank',actions:createFinanceBankActions({domainsFinanceController:port,domainsFinanceView:port,importFinanceConnections:()=>{},ui,uiStatus:port})},
    {name:'finance-credit',actions:createFinanceCreditActions({domainsFinanceView:port,ui})},
    {name:'checks',actions:createChecksActions({domainsBankCache:port,domainsChecksEditor:port,domainsChecksView:port,domainsFinanceView:port,ui,uiDateEditor:port,uiModal:port})},
    {name:'shell',actions:createShellActions({uiModal:port})},
    {name:'dashboard',actions:createDashboardActions({domainsDashboardView:port,domainsFinanceView:port,ui})},
    {name:'suppliers',actions:createSuppliersActions({domainsSuppliersBulk:port,domainsSuppliersEditor:port,domainsSuppliersNavigation:port,domainsSuppliersOrder:port,domainsSuppliersView:port,supplierUi:{}})},
    {name:'customers',actions:createCustomersActions({customerUi:{},domainsCustomers:port})},
    {name:'morning',actions:createMorningActions({domainsCustomers:port})},
    {name:'service',actions:createServiceActions({domainsServiceView:port,servicePorts:port,serviceUi:{}})},
    {name:'warehouse',actions:createWarehouseActions({domainsWarehouseView:port,uiModal:port,warehousePorts:port,warehouseUi:{}})},
    {name:'backup',actions:createBackupActions({ui,uiBackup:port,uiFolders:port,uiModal:port})},
    {name:'cloud',actions:createCloudActions({uiCloud:port})},
    {name:'notes',actions:createNotesActions({domainsNotesController:port})},
    {name:'calendar',actions:createCalendarActions({calendarPorts:port})},
  ]);
  assert.ok(Object.keys(actions).length>320);
  for(const [name,domain] of Object.entries({
    'save-supplier':'orders','save-check':'checks','refresh-orders-credit':'finance',
    'calendar-save-event':'calendar','apply-json-restore':'all',
    'spreadsheet-restore':'notes','credit-card-order-save':'finance',
  }))assert.equal(actions[name].startupMutationDomain,domain,name);
  assert.equal(actions['choose-supplier'].startupMutationDomain,undefined);
  const wrapped=wrapMutationActions(actions,()=>false);
  assert.equal(wrapped['save-supplier'].startupMutationDomain,'orders');
  assert.equal(Object.getPrototypeOf(wrapped),null);
});
