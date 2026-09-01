import assert from 'node:assert/strict';
import {bankRefreshDue,creditRefreshDue,BANK_AUTO_INTERVAL_MS,CREDIT_AUTO_INTERVAL_MS} from '../netunim-orders/site/assets/js/domains/finance/bridge.js';
import {normalizeBankFeed} from '../netunim-orders/site/assets/js/domains/finance/bank-feed.js';
import {mergeCreditSyncResult,normalizeCreditSync} from '../netunim-orders/site/assets/js/domains/finance/credit-feed.js';
import {createDomainsFinanceController} from '../netunim-orders/site/assets/js/domains/finance/controller.js';
import {createDomainsFinanceView} from '../netunim-orders/site/assets/js/domains/finance/view.js';
import {creditDetailMonths,creditMonthBuckets} from '../netunim-orders/site/assets/js/domains/finance/reporting.js';

const now=Date.parse('2026-09-01T02:00:00.000Z');
const realDateNow=Date.now;
Date.now=()=>Date.parse('2026-09-01T03:00:00.000Z');
assert.equal(BANK_AUTO_INTERVAL_MS,4*60*60*1000,'Orders bank cadence matches Kupa at four hours');
assert.equal(CREDIT_AUTO_INTERVAL_MS,24*60*60*1000,'Orders credit cadence remains daily');
assert.equal(bankRefreshDue(null,now),true);
assert.equal(bankRefreshDue(new Date(now-BANK_AUTO_INTERVAL_MS+1).toISOString(),now),false);
assert.equal(bankRefreshDue(new Date(now-BANK_AUTO_INTERVAL_MS).toISOString(),now),true);
assert.equal(creditRefreshDue(new Date(now-CREDIT_AUTO_INTERVAL_MS+1).toISOString(),now),false);
assert.equal(creditRefreshDue(new Date(now-CREDIT_AUTO_INTERVAL_MS).toISOString(),now),true);

const bank=normalizeBankFeed({balance:1234,syncedAt:'2026-09-01T01:00:00Z',accountNumber:'123-456',transactions:[
  {id:'a',date:'2026-09-01T00:00:00Z',amount:5,description:'הפקדה'},
  {id:'a',date:'2026-09-01T00:00:00Z',amount:5,description:'הפקדה'},
]});
assert.equal(bank.transactions.length,1,'Orders normalizes the same canonical bank feed instead of duplicating rows');

const initialCredit=normalizeCreditSync({version:3,syncedAt:'2026-08-31T00:00:00Z',profiles:[{profileId:'p1',provider:'max',accounts:[{accountNumber:'1111',txns:[{id:'old',date:'2026-08-31T00:00:00Z',chargedAmount:-50}]}]}],cardMappings:{'p1:1111':{included:true,account:'עסקי',cardName:'עסקי'}}});
const mergedCredit=mergeCreditSyncResult(initialCredit,{syncedAt:'2026-09-01T00:00:00Z',profiles:[{profileId:'p2',provider:'visaCal',accounts:[{accountNumber:'2222',txns:[{id:'new',date:'2026-09-01T00:00:00Z',chargedAmount:-20}]}]}],errors:[{profileId:'p1',message:'temporary'}]});
assert.equal(mergedCredit.profiles.length,2,'partial issuer success preserves previous profiles');
assert.equal(mergedCredit.cardMappings['p1:1111'].included,true,'existing card classification survives cross-app refresh');


const forecastKey='forecast:4444';
const forecastState={credits:[],creditSync:normalizeCreditSync({version:3,profiles:[{profileId:'forecast',provider:'max',defaultAccount:'עסקי',accounts:[{accountNumber:'4444',txns:[
  {id:'past',processedDate:'2026-08-20',chargedAmount:-40,chargedCurrency:'ILS',description:'כבר נגבה'},
  {id:'sep',processedDate:'2026-09-10',chargedAmount:-100,chargedCurrency:'ILS',description:'ספטמבר'},
  {id:'nov',processedDate:'2026-11-10',chargedAmount:-200,chargedCurrency:'ILS',description:'נובמבר'},
  {id:'mar',processedDate:'2027-03-10',chargedAmount:-300,chargedCurrency:'ILS',description:'מרץ'},
]}]}],cardMappings:{[forecastKey]:{included:true,hidden:false,account:'עסקי'}}})};
const rollingForecast=creditMonthBuckets(forecastState,{view:'rolling12',asOf:'2026-09-01'});
assert.deepEqual(rollingForecast.months.map(month=>month.key),['2026-09','2026-11','2027-03'],'rolling 12-month forecast omits empty months and already-collected history');
const yearForecast=creditMonthBuckets(forecastState,{view:'2026',asOf:'2026-09-01'});
assert.deepEqual(yearForecast.months.map(month=>month.key),['2026-09','2026-11'],'year forecast shows only future months that actually carry a non-zero charge');

const detailSortKey='detail-sort:7777';
const detailSortState={credits:[],creditSync:normalizeCreditSync({version:3,profiles:[{profileId:'detail-sort',provider:'max',ownerLabel:'יעקב',defaultAccount:'עסקי',accounts:[{accountNumber:'7777',txns:[
  {id:'older-purchase',date:'2026-08-03',transactionDate:'2026-08-03',processedDate:'2026-09-10',chargedAmount:-30,chargedCurrency:'ILS',description:'עסקה ישנה'},
  {id:'newer-purchase',date:'2026-08-28',transactionDate:'2026-08-28',processedDate:'2026-09-05',chargedAmount:-40,chargedCurrency:'ILS',description:'עסקה חדשה'},
]}]}],cardMappings:{[detailSortKey]:{included:true,hidden:false,account:'עסקי'}}})};
const septemberDetails=creditDetailMonths(detailSortState,{asOf:'2026-09-01'}).find(month=>month.key==='2026-09');
assert.deepEqual(septemberDetails.items.map(row=>row.description),['עסקה חדשה','עסקה ישנה'],'Orders transaction/payment detail is sorted by purchase date newest-first, independent of card or billing-date order');

Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});

const probeChecksSession={kupaCloudReadState:{version:4,bank:{},creditSync:normalizeCreditSync({}),cards:[],credits:[]},checksBankEvents:[]};
let bankProbeCalls=0,creditProbeCalls=0;
const probeBridge={
  getBridgeToken:()=> 'paired',bankAutoEnabled:()=>false,creditAutoEnabled:()=>false,setBankAutoEnabled(){},setCreditAutoEnabled(){},setBridgeToken:v=>v,
  status:async()=>{bankProbeCalls++;const error=new Error('bridge offline');error.code='BRIDGE_UNAVAILABLE';throw error},
  creditStatus:async()=>{creditProbeCalls++;const error=new Error('credit bridge offline');error.code='BRIDGE_UNAVAILABLE';throw error},
};
const probeController=createDomainsFinanceController({
  tab:{primaryTab:true},checksSession:probeChecksSession,bridge:probeBridge,loadSession:()=>({access_token:'x'}),
  refreshKupaReadout:async()=>true,readKupaReadOnlyCloud:async()=>({revision:1,state:structuredClone(probeChecksSession.kupaCloudReadState)}),rpcSaveKupaDocument:async()=>{throw new Error('not used')},acceptKupaCloudRow:()=>true,
  syncSharedChecksFromCloud:async()=>true,saveSharedChecksToCloud:async()=>true,checksHaveLocalWork:()=>false,toast:()=>{},
});
await probeController.refreshBankBridgeStatus({quiet:true});
await probeController.refreshCreditBridgeStatus({quiet:true});
const passiveProbeSnapshot=probeController.snapshot();
assert.equal(passiveProbeSnapshot.bankStatusChecked,true,'bank bridge availability probe records completion even when the local bridge is offline');
assert.equal(passiveProbeSnapshot.creditStatusChecked,true,'credit bridge availability probe records completion even when the local bridge is offline');
assert.equal(passiveProbeSnapshot.bankError,'','passive bank availability failure is not recorded as a fresh bank synchronization failure');
assert.equal(passiveProbeSnapshot.bankErrorAt,null);
assert.equal(passiveProbeSnapshot.creditError,'','passive credit availability failure is not recorded as a fresh credit synchronization failure');
assert.equal(passiveProbeSnapshot.creditErrorAt,null);
assert.equal(passiveProbeSnapshot.bankBridgeError,'bridge offline');
assert.equal(passiveProbeSnapshot.creditBridgeError,'credit bridge offline');

let viewProbeCalls=0,viewProbeChecked=false;
const mainStub={innerHTML:'',querySelector:()=>null};
Object.defineProperty(globalThis,'document',{value:{getElementById:id=>id==='main'?mainStub:null},configurable:true});
const financeView=createDomainsFinanceView({
  ui:{currentView:'kupa',kupaSubView:'bank',bankAccountView:'business'},
  controller:{
    snapshot:()=>({kupa:{bank:{}},bank:{},creditSync:normalizeCreditSync({}),cards:[],credits:[],bankLastSyncAt:null,creditLastSyncAt:null,bankAutoEnabled:false,creditAutoEnabled:false,bridgeTokenConfigured:true,bankBusy:false,creditBusy:false,bankError:'',creditError:'',bankErrorAt:null,creditErrorAt:null,bankStatus:null,creditStatus:null,bankStatusChecked:viewProbeChecked,creditStatusChecked:false,bankBridgeError:viewProbeChecked?'bridge offline':'',creditBridgeError:''}),
    refreshBankBridgeStatus:async()=>{viewProbeCalls++;viewProbeChecked=true;return null},
  },
  checksView:{syncChecksBulkUi(){},checksCloudLabel:()=>'',checksMarkup:()=>''},dashboardView:{summaryMarkup:()=>''},mountViewLayout(){},modal(){},closeModal(){},confirmDialog:async()=>false,
});
financeView.renderKupa();
await Promise.resolve();await Promise.resolve();
assert.equal(viewProbeCalls,1,'failed bank availability probe is one-shot per loaded state and cannot create a render/probe loop');

let creditViewProbeCalls=0,creditViewProbeChecked=false;
const creditFinanceView=createDomainsFinanceView({
  ui:{currentView:'kupa',kupaSubView:'credit',bankAccountView:'business',creditView:'rolling12',creditAccountFilter:'all',creditProviderFilter:'all',creditCardFilter:'all',creditDetailMonth:''},
  controller:{
    snapshot:()=>({kupa:{bank:{},creditSync:normalizeCreditSync({}),cards:[],credits:[]},bank:{},creditSync:normalizeCreditSync({}),cards:[],credits:[],bankLastSyncAt:null,creditLastSyncAt:null,bankAutoEnabled:false,creditAutoEnabled:false,bridgeTokenConfigured:true,bankBusy:false,creditBusy:false,bankError:'',creditError:'',bankErrorAt:null,creditErrorAt:null,bankStatus:null,creditStatus:null,bankStatusChecked:true,creditStatusChecked:creditViewProbeChecked,bankBridgeError:'',creditBridgeError:creditViewProbeChecked?'credit bridge offline':''}),
    refreshCreditBridgeStatus:async()=>{creditViewProbeCalls++;creditViewProbeChecked=true;return null},
  },
  checksView:{syncChecksBulkUi(){},checksCloudLabel:()=>'',checksMarkup:()=>''},dashboardView:{summaryMarkup:()=>''},mountViewLayout(){},modal(){},closeModal(){},confirmDialog:async()=>false,
});
creditFinanceView.renderKupa();
await Promise.resolve();await Promise.resolve();
assert.equal(creditViewProbeCalls,1,'failed credit availability probe is one-shot per loaded state and cannot create a render/probe loop');

const disclosureMain={innerHTML:''};
Object.defineProperty(globalThis,'document',{value:{getElementById:id=>id==='main'?disclosureMain:null},configurable:true});
const disclosureView=createDomainsFinanceView({
  ui:{currentView:'kupa',kupaSubView:'bank',bankAccountView:'business',bankSyncOpen:true,bankSearchValue:''},
  controller:{snapshot:()=>({kupa:{bank:{}},bank:{},creditSync:normalizeCreditSync({}),cards:[],credits:[],bankLastSyncAt:null,creditLastSyncAt:null,bankAutoEnabled:false,creditAutoEnabled:false,bridgeTokenConfigured:true,bankBusy:false,creditBusy:false,bankError:'',creditError:'',bankErrorAt:null,creditErrorAt:null,bankStatus:{bridgeVersion:21,configured:true},creditStatus:null,bankStatusChecked:true,creditStatusChecked:true,bankBridgeError:'',creditBridgeError:''})},
  checksView:{syncChecksBulkUi(){},checksCloudLabel:()=>'',checksMarkup:()=>''},dashboardView:{summaryMarkup:()=>''},mountViewLayout(){},modal(){},closeModal(){},confirmDialog:async()=>false,
});
disclosureView.renderKupa();
assert.match(disclosureMain.innerHTML,/data-action="toggle-orders-bank-sync-options"[^>]*aria-expanded="true"/,'Kupa rerenders preserve the UI-owned open synchronization state on the status button');
assert.match(disclosureMain.innerHTML,/id="ordersBankSyncPanel" class="finance-sync-settings-body finance-sync-settings-page"(?![^>]*hidden)/,'Kupa rerenders keep the synchronization settings panel visible when UI state is open');
assert.ok(disclosureMain.innerHTML.indexOf('<div class="kupa-subcontent">')<disclosureMain.innerHTML.indexOf('id="ordersBankSyncPanel"'),'the bank synchronization settings panel is rendered inside the main scroll content, not the fixed Kupa header');
assert.match(disclosureMain.innerHTML,/data-input="orders-bank-search"/,'bank account controls expose an independent transaction search field');
assert.match(disclosureMain.innerHTML,/<form id="ordersBankCredentialsForm"[\s\S]*type="password"[\s\S]*<\/form>/,'bank password input belongs to a real form so Chromium does not emit the password-outside-form warning');

const closedDisclosureMain={innerHTML:''};
Object.defineProperty(globalThis,'document',{value:{getElementById:id=>id==='main'?closedDisclosureMain:null},configurable:true});
const closedDisclosureView=createDomainsFinanceView({
  ui:{currentView:'kupa',kupaSubView:'bank',bankAccountView:'business',bankSyncOpen:false,bankSearchValue:''},
  controller:{snapshot:()=>({kupa:{bank:{}},bank:{},creditSync:normalizeCreditSync({}),cards:[],credits:[],bankLastSyncAt:null,creditLastSyncAt:null,bankAutoEnabled:false,creditAutoEnabled:false,bridgeTokenConfigured:true,bankBusy:false,creditBusy:false,bankError:'',creditError:'',bankErrorAt:null,creditErrorAt:null,bankStatus:{bridgeVersion:21,configured:true},creditStatus:null,bankStatusChecked:true,creditStatusChecked:true,bankBridgeError:'',creditBridgeError:''})},
  checksView:{syncChecksBulkUi(){},checksCloudLabel:()=>'',checksMarkup:()=>''},dashboardView:{summaryMarkup:()=>''},mountViewLayout(){},modal(){},closeModal(){},confirmDialog:async()=>false,
});
closedDisclosureView.renderKupa();
assert.match(closedDisclosureMain.innerHTML,/id="ordersBankSyncPanel" class="finance-sync-settings-body finance-sync-settings-page" hidden/,'closed bank synchronization settings are explicitly hidden on first render');

const baseState={version:4,businessName:'ניהול קופה',credits:[],cash:[{id:'cash-kept',amount:7}],expenses:[],cards:[{id:'card-kept',name:'כרטיס'}],creditSync:initialCredit,bank:{currentBalance:900,updatedAt:'2026-08-30T00:00:00Z',asOfDate:'2026-08-30',snapshotSeq:2,adjustments:[],feed:null,homeFeed:null}};
let cloudRow={revision:5,updated_at:'2026-09-01T00:00:00Z',state:structuredClone(baseState)};
const checksSession={kupaCloudReadState:structuredClone(baseState),checksBankEvents:[{seq:4,at:'2026-09-01T01:30:00Z',delta:-25,kind:'check_effect_delta',checkId:'check-4'}]};
let saveCalls=0,bankFetchCalls=0,creditFetchCalls=0,injectConflict=true;
const bridge={
  getBridgeToken:()=> 'paired',bankAutoEnabled:()=>false,creditAutoEnabled:()=>false,setBankAutoEnabled(){},setCreditAutoEnabled(){},setBridgeToken:v=>v,
  markBankAttempt(){},markCreditAttempt(){},bankAttemptReady:()=>true,creditAttemptReady:()=>true,
  status:async()=>({bridgeVersion:21,configured:true}),creditStatus:async()=>({bridgeVersion:20,profiles:[{profileId:'p1'}]}),
  fetchBalance:async()=>{bankFetchCalls++;return {fetchedAt:'2026-09-01T02:30:00Z',accounts:{business:{balance:1500,branchNumber:'1',accountNumber:'10',transactions:[{id:'b1',date:'2026-09-01T02:00:00Z',amount:-10,description:'עסקי'}]},home:{balance:400,branchNumber:'1',accountNumber:'20',transactions:[{id:'h1',date:'2026-09-01T02:00:00Z',amount:-5,description:'ביתי'}]}}}},
  syncCreditCards:async()=>{creditFetchCalls++;return {syncedAt:'2026-09-01T03:00:00Z',profiles:[{profileId:'p1',provider:'max',accounts:[{accountNumber:'1111',txns:[{id:'fresh',date:'2026-09-01T03:00:00Z',chargedAmount:-75}]}]}],errors:[]}},
};
const controller=createDomainsFinanceController({
  tab:{primaryTab:true},checksSession,bridge,loadSession:()=>({access_token:'x'}),
  refreshKupaReadout:async()=>{checksSession.kupaCloudReadState=structuredClone(cloudRow.state);return true},
  readKupaReadOnlyCloud:async()=>structuredClone(cloudRow),
  rpcSaveKupaDocument:async(state,expected)=>{saveCalls++;assert.equal(expected,cloudRow.revision);if(injectConflict){injectConflict=false;cloudRow={...cloudRow,revision:cloudRow.revision+1,state:{...cloudRow.state,cash:[...cloudRow.state.cash,{id:'remote-cash',amount:3}]}};return {r:{ok:false},j:{message:'revision_conflict'},txt:'revision_conflict'}}cloudRow={revision:cloudRow.revision+1,updated_at:'2026-09-01T02:31:00Z',state:structuredClone(state)};return {r:{ok:true},row:structuredClone(cloudRow)}},
  acceptKupaCloudRow:row=>{checksSession.kupaCloudReadState=structuredClone(row.state);return true},
  syncSharedChecksFromCloud:async()=>true,saveSharedChecksToCloud:async()=>true,checksHaveLocalWork:()=>false,toast:()=>{},
});
assert.equal(await controller.refreshBank({interactive:false,auto:false}),true);
assert.equal(saveCalls,2,'bank write retries on revision conflict');
assert.equal(bankFetchCalls,1);
assert.equal(cloudRow.state.cash.some(x=>x.id==='remote-cash'),true,'retry rebases bank-only mutation over unrelated Kupa changes');
assert.equal(cloudRow.state.bank.currentBalance,1500,'business account remains the authoritative Kupa balance');
assert.equal(cloudRow.state.bank.feed.balance,1500);
assert.equal(cloudRow.state.bank.homeFeed.balance,400,'home account feed is preserved separately');
assert.equal(cloudRow.state.bank.snapshotSeq,4,'Orders uses the observed shared-check watermark before a new bank snapshot');

checksSession.kupaCloudReadState=structuredClone(cloudRow.state);
assert.equal(await controller.refreshBank({auto:true}),true);
assert.equal(bankFetchCalls,1,'fresh shared cloud timestamp suppresses a second automatic bank scrape');

const bankSaveCalls=saveCalls;
assert.equal(await controller.refreshCredit({auto:false}),true);
assert.equal(saveCalls,bankSaveCalls+1,'credit refresh writes through the same revision-checked Kupa RPC');
assert.equal(creditFetchCalls,1);
assert.equal(cloudRow.state.creditSync.profiles.find(p=>p.profileId==='p1').accounts[0].txns[0].id,'fresh');
assert.equal(cloudRow.state.creditSync.cardMappings['p1:1111'].included,true,'Orders refresh keeps Kupa card mapping choices');

Date.now=realDateNow;
console.log('PASS Orders finance sync models: four-hour bank / daily credit freshness, revision-safe bank mutation, dual-account feed, newest-first transaction detail and credit mapping preservation');
