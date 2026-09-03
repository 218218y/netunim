import assert from 'node:assert/strict';
import {bankRefreshDue,creditRefreshDue,BANK_AUTO_INTERVAL_MS,CREDIT_AUTO_INTERVAL_MS} from '../netunim-orders/site/assets/js/domains/finance/bridge.js';
import {normalizeBankFeed} from '../netunim-orders/site/assets/js/domains/finance/bank-feed.js';
import {creditFrameStatus,creditUpcomingCharge,creditSyncScrapeSelection,mergeCreditSyncResult,normalizeCreditSync} from '../netunim-orders/site/assets/js/domains/finance/credit-feed.js';
import {createDomainsFinanceController} from '../netunim-orders/site/assets/js/domains/finance/controller.js';
import {createDomainsFinanceView} from '../netunim-orders/site/assets/js/domains/finance/view.js';
import {creditAccountAggregate,creditDetailMonths,creditFilterAccountModels,creditMonthBuckets,creditSummary} from '../netunim-orders/site/assets/js/domains/finance/reporting.js';
import {createUiLayout} from '../netunim-orders/site/assets/js/ui/layout.js';



const ordersSelectionFeed=normalizeCreditSync({version:4,profiles:[{profileId:'selection',provider:'visaCal',accounts:[{accountNumber:'1111'},{accountNumber:'2222'}]}],cardMappings:{'selection:1111':{included:false,hidden:true},'selection:2222':{included:true,hidden:true}}});
assert.deepEqual(creditSyncScrapeSelection(ordersSelectionFeed),[{profileId:'selection',excludedAccounts:['1111']}],'Orders sends the same explicit excluded-card selection as Kupa');

const scrollUi={scrollViewportMemory:new Map()};
const layout=createUiLayout({ui:scrollUi,supplierUi:{supplierViewportMemory:new Map()}});
const loadingViewport={scrollHeight:400,clientHeight:400,scrollTop:0,scrollLeft:0};
const loadingSnapshot=layout.scrollViewportSnapshot(loadingViewport);
assert.equal(loadingSnapshot.atEnd,false,'a non-scrollable Kupa viewport is a start position, not an end position');
scrollUi.scrollViewportMemory.set('kupa:bank',loadingSnapshot);
const loadedViewport={scrollHeight:1600,clientHeight:400,scrollTop:0,scrollLeft:0};
const realRequestAnimationFrame=globalThis.requestAnimationFrame;
globalThis.requestAnimationFrame=callback=>{callback();return 1};
layout.restoreScrollViewport('kupa:bank',loadedViewport);
assert.equal(loadedViewport.scrollTop,0,'bank data arriving after the Kupa view opens keeps the viewport at the top');
const endViewport={scrollHeight:1000,clientHeight:400,scrollTop:600,scrollLeft:0};
scrollUi.scrollViewportMemory.set('kupa:bank',layout.scrollViewportSnapshot(endViewport));
const expandedViewport={scrollHeight:1400,clientHeight:400,scrollTop:0,scrollLeft:0};
layout.restoreScrollViewport('kupa:bank',expandedViewport);
assert.equal(expandedViewport.scrollTop,1000,'a genuinely scrollable viewport that was at the end still follows the end after rerender');
scrollUi.scrollViewportMemory.set('kupa:credit',layout.scrollViewportSnapshot(endViewport));
const filteredCreditViewport={scrollHeight:1400,clientHeight:400,scrollTop:0,scrollLeft:0};
layout.restoreScrollViewport('kupa:credit',filteredCreditViewport,{resetTop:true});
assert.equal(filteredCreditViewport.scrollTop,0,'an explicit credit-filter navigation reset overrides stale at-end viewport memory');
if(realRequestAnimationFrame===undefined)delete globalThis.requestAnimationFrame;else globalThis.requestAnimationFrame=realRequestAnimationFrame;

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
const ordersForecastBase=normalizeCreditSync({version:4,syncedAt:'2026-09-01T00:00:00Z',profiles:[{profileId:'orders-daily',provider:'visaCal',accounts:[{accountNumber:'9191',months:[{month:'2026-11',tier:'forecast',status:'fresh',fetchStatus:'success',fetchedAt:'2026-09-01T00:00:00Z',transactions:[{id:'orders-future-lkg',processedDate:'2026-11-10',chargedAmount:-90}]}]}]}],cardMappings:{'orders-daily:9191':{included:true,hidden:false,account:'עסקי'}}});
const ordersDailyMerged=mergeCreditSyncResult(ordersForecastBase,{syncedAt:'2026-09-03T00:00:00Z',profiles:[{profileId:'orders-daily',provider:'visaCal',coreComplete:true,accounts:[{accountNumber:'9191',months:[{month:'2026-09',tier:'core',fetchStatus:'success',fetchedAt:'2026-09-03T00:00:00Z',transactions:[]},{month:'2026-10',tier:'core',fetchStatus:'success',fetchedAt:'2026-09-03T00:00:00Z',transactions:[]}]}]}],errors:[]});
assert.equal(ordersDailyMerged.profiles[0].accounts[0].months.find(month=>month.month==='2026-11').transactions[0].id,'orders-future-lkg','Orders daily merge preserves previously fetched future installments that are outside the daily scope');assert.equal(creditMonthBuckets({creditSync:ordersDailyMerged},{view:'all',asOf:'2026-09-03'}).months.some(month=>month.key==='2026-11'&&month.total===90),true,'the preserved farther-future LKG row remains visible to the actual Orders forecast consumer after a daily refresh');
const ordersLkg=normalizeCreditSync({version:4,syncedAt:'2026-08-31T00:00:00Z',profiles:[{profileId:'p-lkg',provider:'visaCal',syncedAt:'2026-08-31T00:00:00Z',accounts:[{accountNumber:'3333',months:[{month:'2026-10',tier:'core',fetchStatus:'success',fetchedAt:'2026-08-31T00:00:00Z',transactions:[{id:'old-core',processedDate:'2026-10-10',chargedAmount:-30}]}]}]}]});
const ordersCoreFailed=mergeCreditSyncResult(ordersLkg,{profiles:[{profileId:'p-lkg',provider:'visaCal',coreComplete:false,attemptedAt:'2026-09-01T00:00:00Z',accounts:[{accountNumber:'3333',months:[{month:'2026-10',tier:'core',fetchStatus:'schema_error',lastErrorCode:'CREDIT_PROVIDER_SCHEMA_ERROR',lastErrorAt:'2026-09-01T00:00:00Z',transactions:[]},{month:'2026-11',tier:'forecast',fetchStatus:'success',fetchedAt:'2026-09-01T00:00:00Z',transactions:[{id:'uncommitted',processedDate:'2026-11-10',chargedAmount:-999}]}]}]}]});
assert.equal(ordersCoreFailed.profiles[0].accounts[0].txns[0].id,'old-core','Orders preserves the complete LKG profile when the connector reports incomplete Core coverage');
assert.equal(ordersCoreFailed.syncedAt,ordersLkg.syncedAt);
const ordersFrameBase=normalizeCreditSync({version:4,syncedAt:'2026-08-31T00:00:00Z',profiles:[{profileId:'orders-frame',provider:'visaCal',accounts:[{accountNumber:'4545',balance:-80,cardFrame:5000,frameStatus:'fresh',frameFetchStatus:'success',frameFetchedAt:'2026-08-31T00:00:00Z',months:[{month:'2026-09',tier:'core',fetchStatus:'success',fetchedAt:'2026-08-31T00:00:00Z',transactions:[]}]}]}]}),ordersFrameMerged=mergeCreditSyncResult(ordersFrameBase,{syncedAt:'2026-09-01T00:00:00Z',profiles:[{profileId:'orders-frame',provider:'visaCal',coreComplete:true,accounts:[{accountNumber:'4545',frameStatus:'missing',frameFetchStatus:'unavailable',frameErrorCode:'CREDIT_FRAMES_UNAVAILABLE',frameErrorAt:'2026-09-01T00:00:00Z',months:[{month:'2026-09',tier:'core',fetchStatus:'success',fetchedAt:'2026-09-01T00:00:00Z',transactions:[]}]}]}],errors:[{profileId:'orders-frame',provider:'visaCal',component:'frames',severity:'warning',code:'CREDIT_FRAMES_UNAVAILABLE',stage:'Frames',at:'2026-09-01T00:00:00Z'}]});
assert.equal(ordersFrameMerged.profiles[0].accounts[0].cardFrame,5000,'Orders preserves Frames Last Known Good independently of successful Core transactions');assert.equal(ordersFrameMerged.profiles[0].accounts[0].frameStatus,'stale');assert.equal(ordersFrameMerged.errors[0].severity,'warning');

const ordersFrameFeed=normalizeCreditSync({version:3,profiles:[{profileId:'limits',provider:'amex',accounts:[{accountNumber:'3333',txns:[{id:'sep',processedDate:'2026-09-10',chargedAmount:-300,chargedCurrency:'ILS',status:'completed'},{id:'oct',processedDate:'2026-10-10',chargedAmount:-200,chargedCurrency:'ILS',status:'completed'}]}]}],cardMappings:{'limits:3333':{included:true,manualFrame:4000}}});
const ordersFrameAccount=ordersFrameFeed.profiles[0].accounts[0];
assert.equal(creditFrameStatus(ordersFrameAccount,ordersFrameFeed.cardMappings['limits:3333'],'2026-09-01').available,3500,'Orders uses the same manual-frame fallback calculation as Kupa');
assert.deepEqual(creditUpcomingCharge(ordersFrameAccount,'amex','2026-09-01'),{amount:300,date:'2026-09-10',source:'transactions'},'Orders derives Amex upcoming debit from synchronized billing rows instead of an unavailable account balance');
const ordersLimitSummary=creditSummary({creditSync:ordersFrameFeed,credits:[]});
assert.equal(ordersLimitSummary.availableCreditKnownCount,1);assert.equal(ordersLimitSummary.availableCreditUnknownCount,0,'Orders exposes a complete available-credit total when every included card has an issuer or manual frame');

const selectionFeed=normalizeCreditSync({version:3,profiles:[
  {profileId:'max-filter',provider:'max',label:'MAX',defaultAccount:'עסקי',accounts:[{accountNumber:'1111',cardFrame:1000,availableCredit:700,txns:[{id:'m1',processedDate:'2026-09-12',chargedAmount:-50,chargedCurrency:'ILS',status:'completed'}]}]},
  {profileId:'isr-filter',provider:'isracard',label:'ישראכרט',defaultAccount:'עסקי',accounts:[{accountNumber:'2222',txns:[{id:'i1',processedDate:'2026-09-15',chargedAmount:-200,chargedCurrency:'ILS',status:'completed'}]}]},
  {profileId:'amex-filter',provider:'amex',label:'AMEX',defaultAccount:'ביתי',accounts:[{accountNumber:'3333',txns:[{id:'a1',processedDate:'2026-09-20',chargedAmount:-100,chargedCurrency:'ILS',status:'completed'}]}]},
],cardMappings:{'max-filter:1111':{included:true,hidden:false,account:'עסקי'},'isr-filter:2222':{included:true,hidden:false,account:'עסקי',manualFrame:1000},'amex-filter:3333':{included:true,hidden:true,account:'ביתי'}}});
const selectionSummary=creditSummary({creditSync:selectionFeed,credits:[]});
const allSelection=creditAccountAggregate(creditFilterAccountModels(selectionSummary.accounts));
assert.equal(allSelection.totalFrame,2000,'all-card total frame sums issuer and manual fallback frames through the same selected-card aggregate');
assert.equal(allSelection.totalFrameKnownCount,2);
assert.equal(allSelection.totalFrameUnknownCount,1,'unknown total frames remain explicit in the aggregate');
assert.equal(allSelection.availableCreditTotal,1500,'all-card available frame sums issuer available credit and calculated manual fallback');
assert.equal(allSelection.availableCreditKnownCount,2);
assert.equal(allSelection.availableCreditUnknownCount,1,'missing frame data stays explicit instead of fabricating a complete total');
assert.equal(allSelection.upcomingChargeTotal,350,'all-card live summary adds the next known charge of each included card');
const maxSelection=creditAccountAggregate(creditFilterAccountModels(selectionSummary.accounts,{provider:'max'}));
assert.equal(maxSelection.count,1);
assert.equal(maxSelection.totalFrame,1000,'provider/card filters drive the transactions-header total frame from the same selected account models');
assert.equal(maxSelection.availableCreditTotal,700,'provider/card filters can drive the transactions-header available frame from the same selected account models');
const businessSelection=creditAccountAggregate(creditFilterAccountModels(selectionSummary.accounts,{account:'עסקי'}));
assert.equal(businessSelection.availableCreditTotal,1500);
assert.equal(businessSelection.availableCreditUnknownCount,0,'account filters exclude unrelated cards from the selected available-frame aggregate');


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
  ui:{currentView:'kupa',kupaSubView:'credit',bankAccountView:'business',creditView:'rolling12',creditAccountFilter:'all',creditProviderFilter:'all',creditCardFilter:'all',creditDetailFocus:null},
  controller:{
    snapshot:()=>({kupa:{bank:{},creditSync:normalizeCreditSync({}),cards:[],credits:[]},bank:{},creditSync:normalizeCreditSync({}),cards:[],credits:[],bankLastSyncAt:null,creditLastSyncAt:null,bankAutoEnabled:false,creditAutoEnabled:false,bridgeTokenConfigured:true,bankBusy:false,creditBusy:false,bankError:'',creditError:'',bankErrorAt:null,creditErrorAt:null,bankStatus:null,creditStatus:null,bankStatusChecked:true,creditStatusChecked:creditViewProbeChecked,bankBridgeError:'',creditBridgeError:creditViewProbeChecked?'credit bridge offline':''}),
    refreshCreditBridgeStatus:async()=>{creditViewProbeCalls++;creditViewProbeChecked=true;return null},
  },
  checksView:{syncChecksBulkUi(){},checksCloudLabel:()=>'',checksMarkup:()=>''},dashboardView:{summaryMarkup:()=>''},mountViewLayout(){},modal(){},closeModal(){},confirmDialog:async()=>false,
});
creditFinanceView.renderKupa();
await Promise.resolve();await Promise.resolve();
assert.equal(creditViewProbeCalls,1,'failed credit availability probe is one-shot per loaded state and cannot create a render/probe loop');

const drilldownMain={innerHTML:''};
let drilldownScrolled=0;
Object.defineProperty(globalThis,'requestAnimationFrame',{value:callback=>{callback();return 1},configurable:true});
Object.defineProperty(globalThis,'document',{value:{getElementById:id=>id==='main'?drilldownMain:id==='ordersCreditDetailRegion'?{scrollIntoView:()=>{drilldownScrolled++}}:null,querySelector:()=>null},configurable:true});
const drilldownCreditSync=normalizeCreditSync({version:3,mode:'synced',profiles:[{profileId:'p1',provider:'max',label:'MAX',ownerLabel:'',defaultAccount:'עסקי',accounts:[{accountNumber:'1234',txns:[{id:'tx1',processedDate:'2026-09-15',transactionDate:'2026-08-20',chargedAmount:120,originalAmount:120,status:'completed',description:'בדיקת מיקוד'}]}]}],cardMappings:{'p1:1234':{included:true,hidden:false,account:'עסקי',cardName:'כרטיס בדיקה'}}});
const drilldownUi={currentView:'kupa',kupaSubView:'credit',bankAccountView:'business',creditView:'rolling12',creditAccountFilter:'all',creditProviderFilter:'all',creditCardFilter:'all',creditDetailFocus:null,creditSearchValue:'',creditSyncOpen:false};
const drilldownView=createDomainsFinanceView({ui:drilldownUi,controller:{snapshot:()=>({kupa:{bank:{},creditSync:drilldownCreditSync,cards:[],credits:[]},bank:{},creditSync:drilldownCreditSync,cards:[],credits:[],bankLastSyncAt:null,creditLastSyncAt:'2026-09-01T00:00:00Z',bankAutoEnabled:false,creditAutoEnabled:false,bridgeTokenConfigured:false,bankBusy:false,creditBusy:false,bankError:'',creditError:'',bankErrorAt:null,creditErrorAt:null,bankStatus:null,creditStatus:null,bankStatusChecked:true,creditStatusChecked:true,bankBridgeError:'',creditBridgeError:''})},checksView:{syncChecksBulkUi(){},checksCloudLabel:()=>'',checksMarkup:()=>''},dashboardView:{summaryMarkup:()=>''},mountViewLayout(){},modal(){},closeModal(){},confirmDialog:async()=>false});
drilldownView.renderKupa();
assert.match(drilldownMain.innerHTML,/data-action="orders-credit-detail-focus"[^>]*data-click-arg0="2026-09"[^>]*data-click-arg1="sync:p1:1234"/,'Orders forecast rows expose the same month/card drilldown identity as Kupa');
drilldownView.setCreditDetailFocus('2026-09','sync:p1:1234');
assert.deepEqual(drilldownUi.creditDetailFocus,{monthKey:'2026-09',cardKey:'sync:p1:1234'});
assert.equal(drilldownScrolled,1,'Orders forecast drilldown scrolls to the transactions region after rendering');
assert.match(drilldownMain.innerHTML,/מיקוד בכרטיס מתוך התחזית/);
assert.match(drilldownMain.innerHTML,/בדיקת מיקוד/);
drilldownView.clearCreditDetailFocus('2026-09');
assert.deepEqual(drilldownUi.creditDetailFocus,{monthKey:'2026-09',cardKey:''},'clearing a forecast card focus preserves the selected month');

const frameUiMain={innerHTML:''};
Object.defineProperty(globalThis,'document',{value:{getElementById:id=>id==='main'?frameUiMain:null,querySelector:()=>null},configurable:true});
const frameUi={currentView:'kupa',kupaSubView:'credit',bankAccountView:'business',creditView:'rolling12',creditAccountFilter:'all',creditProviderFilter:'all',creditCardFilter:'all',creditDetailFocus:null,creditSearchValue:'',creditSyncOpen:false};
const frameMountCalls=[];
const frameView=createDomainsFinanceView({ui:frameUi,controller:{snapshot:()=>({kupa:{bank:{},creditSync:selectionFeed,cards:[],credits:[]},bank:{},creditSync:selectionFeed,cards:[],credits:[],bankLastSyncAt:null,creditLastSyncAt:'2026-09-01T00:00:00Z',bankAutoEnabled:false,creditAutoEnabled:false,bridgeTokenConfigured:false,bankBusy:false,creditBusy:false,bankError:'',creditError:'',bankErrorAt:null,creditErrorAt:null,bankStatus:null,creditStatus:null,bankStatusChecked:true,creditStatusChecked:true,bankBridgeError:'',creditBridgeError:''})},checksView:{syncChecksBulkUi(){},checksCloudLabel:()=>'',checksMarkup:()=>''},dashboardView:{summaryMarkup:()=>''},mountViewLayout(options){frameMountCalls.push(options)},modal(){},closeModal(){},confirmDialog:async()=>false});
frameView.renderKupa();
assert.equal(frameMountCalls.at(-1).resetTop,false,'ordinary Kupa rerenders preserve the remembered viewport');
assert.doesNotMatch(frameUiMain.innerHTML,/credit-available-total/,'Orders removes the all-card available-frame pill from the top credit toolbar');
assert.match(frameUiMain.innerHTML,/<h3>עסקאות ותשלומים<\/h3>[\s\S]*מסגרת כוללת:<\/span><b>[^<]*2,000[\s\S]*מסגרת פנויה:<\/span><b>[^<]*1,500/,'the transactions heading carries total and available frames for the current all-card selection');
assert.match(frameUiMain.innerHTML,/credit-live-total-card[\s\S]*חיוב קרוב · כל הכרטיסים[\s\S]*350[\s\S]*מסגרת כוללת · כל הכרטיסים[\s\S]*2,000[\s\S]*מסגרת פנויה · כל הכרטיסים[\s\S]*1,500/,'live issuer data ends with one all-card card containing upcoming charge, total frame and available frame');
frameView.setCreditProviderFilter('max');
assert.equal(frameMountCalls.at(-1).resetTop,true,'changing the credit provider explicitly resets the Kupa credit viewport to the start');
assert.match(frameUiMain.innerHTML,/<h3>עסקאות ותשלומים<\/h3>[\s\S]*מסגרת כוללת:<\/span><b>[^<]*1,000[\s\S]*מסגרת פנויה:<\/span><b>[^<]*700/,'the transactions-header total and available frames follow the selected provider/card filter instead of the global total');
assert.match(frameUiMain.innerHTML,/credit-live-total-card[\s\S]*מסגרת כוללת · כל הכרטיסים[\s\S]*2,000[\s\S]*מסגרת פנויה · כל הכרטיסים[\s\S]*1,500/,'the bottom all-card live summary remains global even while the transaction filter is narrowed');
frameView.setCreditCardFilter('sync:max-filter:1111');
assert.equal(frameMountCalls.at(-1).resetTop,true,'changing the selected credit card also resets the Kupa credit viewport to the start');

const disclosureMain={innerHTML:''};
Object.defineProperty(globalThis,'document',{value:{getElementById:id=>id==='main'?disclosureMain:null},configurable:true});
const disclosureView=createDomainsFinanceView({
  ui:{currentView:'kupa',kupaSubView:'bank',bankAccountView:'business',bankSyncOpen:true,bankSearchValue:''},
  controller:{snapshot:()=>({kupa:{bank:{}},bank:{},creditSync:normalizeCreditSync({}),cards:[],credits:[],bankLastSyncAt:null,creditLastSyncAt:null,bankAutoEnabled:false,creditAutoEnabled:false,bridgeTokenConfigured:true,bankBusy:false,creditBusy:false,bankError:'',creditError:'',bankErrorAt:null,creditErrorAt:null,bankStatus:{bridgeVersion:25,configured:true},creditStatus:null,bankStatusChecked:true,creditStatusChecked:true,bankBridgeError:'',creditBridgeError:''})},
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
  controller:{snapshot:()=>({kupa:{bank:{}},bank:{},creditSync:normalizeCreditSync({}),cards:[],credits:[],bankLastSyncAt:null,creditLastSyncAt:null,bankAutoEnabled:false,creditAutoEnabled:false,bridgeTokenConfigured:true,bankBusy:false,creditBusy:false,bankError:'',creditError:'',bankErrorAt:null,creditErrorAt:null,bankStatus:{bridgeVersion:25,configured:true},creditStatus:null,bankStatusChecked:true,creditStatusChecked:true,bankBridgeError:'',creditBridgeError:''})},
  checksView:{syncChecksBulkUi(){},checksCloudLabel:()=>'',checksMarkup:()=>''},dashboardView:{summaryMarkup:()=>''},mountViewLayout(){},modal(){},closeModal(){},confirmDialog:async()=>false,
});
closedDisclosureView.renderKupa();
assert.match(closedDisclosureMain.innerHTML,/id="ordersBankSyncPanel" class="finance-sync-settings-body finance-sync-settings-page" hidden/,'closed bank synchronization settings are explicitly hidden on first render');

const baseState={version:4,businessName:'ניהול קופה',credits:[],cash:[{id:'cash-kept',amount:7}],expenses:[],cards:[{id:'card-kept',name:'כרטיס'}],creditSync:initialCredit,bank:{currentBalance:900,updatedAt:'2026-08-30T00:00:00Z',asOfDate:'2026-08-30',snapshotSeq:2,adjustments:[],feed:null,homeFeed:null}};
let cloudRow={revision:5,updated_at:'2026-09-01T00:00:00Z',state:structuredClone(baseState)};
let financeRow={revision:1,updated_at:'2026-09-01T00:00:00Z',state:{bank:null,creditSync:structuredClone(initialCredit)}};
const overlayReadout=()=>{const state=structuredClone(cloudRow.state),kupaBank=state.bank||{},financeBank=financeRow.state.bank||null;if(financeBank)state.bank={...kupaBank,...structuredClone(financeBank),adjustments:structuredClone(kupaBank.adjustments||[]),snapshotToken:kupaBank.snapshotToken??null,snapshotSeq:kupaBank.snapshotSeq??null};if(financeRow.state.creditSync)state.creditSync=structuredClone(financeRow.state.creditSync);return state};
const checksSession={kupaCloudReadState:overlayReadout(),checksBankEvents:[{seq:4,at:'2026-09-01T01:30:00Z',delta:-25,kind:'check_effect_delta',checkId:'check-4'}]};
let saveCalls=0,financeSaveCalls=0,atomicBankSaveCalls=0,bankFetchCalls=0,creditFetchCalls=0,acceptKupaCalls=0,refreshKupaCalls=0;
const archiveRows={business:[],home:[]};
function archiveRow(tx){return {id:tx.mergeKey,date:tx.date,processedDate:tx.processedDate||tx.date,amount:Number(tx.amount),currency:tx.currency||'ILS',description:tx.description||'',memo:tx.memo||'',partyName:tx.partyName||'',partyHeadline:tx.partyHeadline||'',messageHeadline:tx.messageHeadline||'',messageDetail:tx.messageDetail||'',status:tx.status||'completed',balanceAfter:tx.balanceAfter??null,bankReference:tx.bankReference||'',bankSerial:tx.bankSerial||'',activityTypeCode:tx.activityTypeCode??null,cheque:!!tx.cheque,checkDetails:tx.checkDetails??null}}
const mergeBankTransactions=async(accountKey,role,transactions)=>{const payload=(transactions||[]).map((tx,index)=>({...tx,mergeKey:`${role}:${String(tx.date||'').slice(0,10)}:${tx.id||index}`}));archiveRows[role]=payload.map(archiveRow);return {result:{inserted_count:payload.length,updated_count:0,total_count:payload.length},sourcePayload:payload}};
const readBankTransactions=async(_accountKey,role)=>structuredClone(archiveRows[role]||[]);
const saveBankSyncSnapshot=async(bankState,snapshotToken,snapshotSeq)=>{atomicBankSaveCalls++;
  // Simulate an unrelated Kupa change racing just before the atomic RPC. The server-side partial
  // update must preserve it because it edits only bank metadata + the isolated finance bank key.
  if(!cloudRow.state.cash.some(x=>x.id==='remote-cash'))cloudRow.state.cash.push({id:'remote-cash',amount:3});
  financeRow={revision:financeRow.revision+1,updated_at:'2026-09-01T02:30:30Z',state:{...structuredClone(financeRow.state),bank:structuredClone(bankState)}};
  cloudRow={revision:cloudRow.revision+1,updated_at:'2026-09-01T02:30:30Z',state:{...structuredClone(cloudRow.state),creditSync:undefined,bank:{currentBalance:null,updatedAt:null,asOfDate:null,adjustments:structuredClone(cloudRow.state.bank?.adjustments||[]),source:null,sourceAccount:null,snapshotToken,snapshotSeq}}};
  delete cloudRow.state.creditSync;
  checksSession.kupaCloudReadState=overlayReadout();
  return {finance_revision:financeRow.revision,kupa_revision:cloudRow.revision,updated_at:'2026-09-01T02:30:30Z'};
};
let lastCreditSyncOptions=null;
const bridge={
  getBridgeToken:()=> 'paired',bankAutoEnabled:()=>false,creditAutoEnabled:()=>false,setBankAutoEnabled(){},setCreditAutoEnabled(){},setBridgeToken:v=>v,
  markBankAttempt(){},markCreditAttempt(){},bankAttemptReady:()=>true,creditAttemptReady:()=>true,
  status:async()=>({bridgeVersion:25,configured:true}),creditStatus:async()=>({bridgeVersion:31,contractVersion:2,profiles:[{profileId:'p1'}]}),
  fetchBalance:async()=>{bankFetchCalls++;return {fetchedAt:'2026-09-01T02:30:00Z',accounts:{business:{balance:1500,branchNumber:'1',accountNumber:'10',transactions:[{id:'b1',date:'2026-09-01T02:00:00Z',processedDate:'2026-09-01T02:00:00Z',amount:-10,description:'עסקי',status:'completed'}]},home:{balance:400,branchNumber:'1',accountNumber:'20',transactions:[{id:'h1',date:'2026-09-01T02:00:00Z',processedDate:'2026-09-01T02:00:00Z',amount:-5,description:'ביתי',status:'completed'}]}}}},
  syncCreditCards:async options=>{lastCreditSyncOptions=structuredClone(options);creditFetchCalls++;return {syncedAt:'2026-09-01T03:00:00Z',profiles:[{profileId:'p1',provider:'max',accounts:[{accountNumber:'1111',txns:[{id:'fresh',date:'2026-09-01T03:00:00Z',chargedAmount:-75}]}]}],errors:[]}},
};
const controller=createDomainsFinanceController({
  tab:{primaryTab:true},checksSession,bridge,loadSession:()=>({access_token:'x'}),
  refreshKupaReadout:async()=>{refreshKupaCalls++;checksSession.kupaCloudReadState=overlayReadout();return true},
  readKupaReadOnlyCloud:async()=>({...structuredClone(cloudRow),state:overlayReadout()}),
  rpcSaveKupaDocument:async(state,expected)=>{saveCalls++;assert.equal(expected,cloudRow.revision);cloudRow={revision:cloudRow.revision+1,updated_at:'2026-09-01T02:31:00Z',state:structuredClone(state)};return {r:{ok:true},row:structuredClone(cloudRow)}},
  acceptKupaCloudRow:row=>{acceptKupaCalls++;cloudRow={...cloudRow,...structuredClone(row)};checksSession.kupaCloudReadState=overlayReadout();return true},
  readFinanceSyncDocument:async()=>structuredClone(financeRow),
  rpcSaveFinanceSync:async(state,expected)=>{financeSaveCalls++;assert.equal(expected,financeRow.revision);financeRow={revision:financeRow.revision+1,updated_at:'2026-09-01T02:30:30Z',state:structuredClone(state)};return {r:{ok:true},row:structuredClone(financeRow)}},
  saveBankSyncSnapshot,mergeBankTransactions,readBankTransactions,
  syncSharedChecksFromCloud:async()=>true,saveSharedChecksToCloud:async()=>true,checksHaveLocalWork:()=>false,toast:()=>{},
});
assert.equal(await controller.refreshBank({interactive:false,auto:false}),true);
assert.equal(atomicBankSaveCalls,1,'bank finance payload and Kupa watermark are committed by one atomic RPC');
assert.equal(saveCalls,0,'atomic bank sync does not issue a second full Kupa document write');
assert.equal(financeSaveCalls,0,'atomic bank sync does not issue a separate finance-document replacement write');
assert.equal(bankFetchCalls,1);
assert.equal(cloudRow.state.cash.some(x=>x.id==='remote-cash'),true,'atomic partial bank update preserves unrelated Kupa changes');
assert.equal(cloudRow.state.bank.currentBalance,null,'synchronized balance is excluded from the Kupa backup document');
assert.equal('feed' in cloudRow.state.bank,false,'business feed is excluded from the Kupa backup document');
assert.equal(financeRow.state.bank.currentBalance,1500,'business account remains the authoritative synchronized finance balance');
assert.equal(financeRow.state.bank.feed.balance,1500);
assert.equal(financeRow.state.bank.homeFeed.balance,400,'home account feed is preserved separately in finance state');
assert.equal(financeRow.state.bank.archiveAudit.business.sourceCount,1,'bank sync stores the independently read-back archive audit');
assert.equal(financeRow.state.bank.archiveBaselineAudit.business.sourceCount,1,'full manual backfill stores an immutable baseline audit');
assert.equal(financeRow.state.bank.archiveBaselineAudit.business.accountKey,'1-10','baseline audit is tied to the exact business account');
assert.equal(cloudRow.state.bank.snapshotSeq,4,'atomic bank snapshot advances the Kupa check watermark together with finance state');
const baselineAudit=structuredClone(financeRow.state.bank.archiveBaselineAudit);
assert.equal(await controller.refreshBank({interactive:false,auto:false}),true);
assert.deepEqual(financeRow.state.bank.archiveBaselineAudit,baselineAudit,'rolling 30-day refresh never overwrites the certified 365-day baseline audit');
assert.equal(financeRow.state.bank.archiveAudit.historyDays,30,'rolling refresh still records a separate latest audit');
assert.equal(bankFetchCalls,2);

checksSession.kupaCloudReadState=overlayReadout();
assert.equal(await controller.refreshBank({auto:true}),true);
assert.equal(bankFetchCalls,2,'fresh shared cloud timestamp suppresses a second automatic bank scrape');

const bankSaveCalls=saveCalls,bankFinanceSaveCalls=financeSaveCalls;
assert.equal(await controller.refreshCredit({auto:false}),true);
assert.equal(saveCalls,bankSaveCalls,'credit refresh does not write the Kupa backup document');
assert.equal(financeSaveCalls,bankFinanceSaveCalls+1,'credit refresh writes only the isolated revision-checked finance document');
assert.equal(creditFetchCalls,1);
assert.deepEqual(lastCreditSyncOptions,{interactive:false,syncMode:'full',selection:[]},'ordinary Orders manual credit refresh sends the complete 12-month scope plus the explicit excluded-card selection');
assert.equal(financeRow.state.creditSync.profiles.find(p=>p.profileId==='p1').accounts[0].txns[0].id,'fresh');
assert.equal(financeRow.state.creditSync.cardMappings['p1:1111'].included,true,'Orders refresh keeps credit card mapping choices in finance state');

const acceptsBeforeThreshold=acceptKupaCalls,refreshesBeforeThreshold=refreshKupaCalls,financeBeforeThreshold=structuredClone(financeRow.state);
assert.equal(await controller.saveCashflowMinimum('business','5000'),true,'Orders can persist the shared business cashflow threshold');
assert.equal(saveCalls,bankSaveCalls+1,'cashflow threshold updates the Kupa core document exactly once');
assert.equal(cloudRow.state.cashflowSettings.businessMinimum,5000);
assert.deepEqual(financeRow.state,financeBeforeThreshold,'saving a Kupa cashflow threshold never rewrites isolated bank/credit finance state');
assert.equal(acceptKupaCalls,acceptsBeforeThreshold,'raw Kupa RPC rows are not accepted into the finance-overlay cache after a core write');
assert.equal(refreshKupaCalls,refreshesBeforeThreshold+1,'a successful Kupa core write re-reads the merged Kupa+finance view before rendering');
assert.equal(checksSession.kupaCloudReadState.cashflowSettings.businessMinimum,5000);
assert.equal(checksSession.kupaCloudReadState.bank.feed.balance,1500,'bank feed remains visible immediately after saving the shared threshold');
assert.equal(checksSession.kupaCloudReadState.creditSync.profiles[0].accounts[0].txns[0].id,'fresh','credit feed remains visible immediately after saving the shared threshold');

Date.now=realDateNow;
console.log('PASS Orders finance sync models: four-hour bank / daily credit freshness, atomic bank snapshot + archive read-back verification, dual-account feed, newest-first transaction detail and credit mapping preservation');
