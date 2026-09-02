import assert from 'node:assert/strict';
import {createDomainsBankController} from '../netunim-kupa/site/assets/js/domains/bank/controller.js';
import {createDomainsCreditController} from '../netunim-kupa/site/assets/js/domains/credit/controller.js';
import {createSyncDocument} from '../netunim-kupa/site/assets/js/sync/document.js';
import {createStateNormalization} from '../netunim-kupa/site/assets/js/state/normalization.js';

const store=new Map();
Object.defineProperty(globalThis,'localStorage',{value:{getItem:key=>store.has(key)?store.get(key):null,setItem:(key,value)=>store.set(key,String(value)),removeItem:key=>store.delete(key)},configurable:true});
Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});

const realDateNow=Date.now;
Date.now=()=>Date.parse('2026-09-01T05:00:00.000Z');
const old='2026-08-30T00:00:00.000Z',fresh='2026-09-01T04:00:00.000Z';
let bankFetches=0,bankMarks=0;
const bankModel={state:{bank:{source:'hapoalim',updatedAt:old,bankSyncAt:old,feed:{version:4,provider:'hapoalim',balance:100,syncedAt:old,transactions:[]}},checks:[]}};
const bankController=createDomainsBankController({
  model:bankModel,session:{backendReady:true,connectionMode:'supabase'},checksSession:{},
  sharedChecksHaveLocalWork:()=>false,saveState:async()=>true,syncSharedChecksFromCloud:async()=>true,sharedChecksObservedSequence:()=>0,
  toast:()=>{},render:()=>{},
  bridge:{getBridgeToken:()=> 'paired',markAutoAttempt:()=>{bankMarks++},fetchBalance:async()=>{bankFetches++;throw new Error('must not scrape')},autoEnabled:()=>true,autoAttemptDelayMs:()=>0},
  refreshFinanceCloudSnapshot:async()=>({verified:true,state:{bank:{source:'hapoalim',updatedAt:fresh,bankSyncAt:fresh,feed:{version:4,provider:'hapoalim',balance:200,syncedAt:fresh,transactions:[]}}}}),
});
assert.equal(await bankController.refreshBankBalance({auto:true}),true);
assert.equal(bankFetches,0,'Kupa bank auto refresh must not scrape when Orders already refreshed the shared Kupa document');
assert.equal(bankMarks,1,'Kupa records a local cooldown when a remote fresh snapshot suppresses a stale local auto attempt');

let bankUnavailableFetches=0;
const bankUnavailable=createDomainsBankController({
  model:bankModel,session:{backendReady:true,connectionMode:'supabase'},checksSession:{},sharedChecksHaveLocalWork:()=>false,saveState:async()=>true,
  syncSharedChecksFromCloud:async()=>true,sharedChecksObservedSequence:()=>0,toast:()=>{},render:()=>{},
  bridge:{getBridgeToken:()=> 'paired',markAutoAttempt:()=>{},fetchBalance:async()=>{bankUnavailableFetches++},autoEnabled:()=>true,autoAttemptDelayMs:()=>0},
  refreshFinanceCloudSnapshot:async()=>({verified:false,state:null}),
});
assert.equal(await bankUnavailable.refreshBankBalance({auto:true}),false);
assert.equal(bankUnavailableFetches,0,'Kupa bank auto refresh fails closed when shared cloud freshness cannot be verified');

let creditFetches=0;
const creditModel={state:{creditSync:{version:3,mode:'synced',syncedAt:old,profiles:[],errors:[],cardMappings:{}}}};
const creditController=createDomainsCreditController({
  model:creditModel,saveState:async()=>true,toast:()=>{},render:()=>{},modal:()=>{},armModalDraftGuard:()=>{},closeModal:()=>{},confirmDialog:async()=>true,
  bridge:{creditStatus:async()=>{throw new Error('must not query bridge status')},syncCreditCards:async()=>{creditFetches++;throw new Error('must not scrape')}},
  refreshFinanceCloudSnapshot:async()=>({verified:true,state:{creditSync:{version:3,mode:'synced',syncedAt:fresh,profiles:[],errors:[],cardMappings:{}}}}),
});
assert.equal(await creditController.refreshCreditSync({auto:true}),true);
assert.equal(creditFetches,0,'Kupa credit auto refresh must not scrape when Orders already refreshed the shared Kupa document');

let creditUnavailableFetches=0;
const creditUnavailable=createDomainsCreditController({
  model:creditModel,saveState:async()=>true,toast:()=>{},render:()=>{},modal:()=>{},armModalDraftGuard:()=>{},closeModal:()=>{},confirmDialog:async()=>true,
  bridge:{creditStatus:async()=>({bridgeVersion:24,profiles:[{profileId:'p1'}]}),syncCreditCards:async()=>{creditUnavailableFetches++}},
  refreshFinanceCloudSnapshot:async()=>({verified:false,state:null}),
});
await creditUnavailable.refreshCreditSync({auto:true});
assert.equal(creditUnavailableFetches,0,'Kupa credit auto refresh fails closed when shared cloud freshness cannot be verified');


let lockedBankFetches=0,lockedBankReleases=0;
const lockedBank=createDomainsBankController({
  model:bankModel,session:{backendReady:true,connectionMode:'supabase'},checksSession:{},sharedChecksHaveLocalWork:()=>false,saveState:async()=>true,
  syncSharedChecksFromCloud:async()=>true,sharedChecksObservedSequence:()=>0,toast:()=>{},render:()=>{},
  bridge:{getBridgeToken:()=> 'paired',fetchBalance:async()=>{lockedBankFetches++},autoEnabled:()=>true,autoAttemptDelayMs:()=>0},
  claimFinanceSyncLease:async kind=>{assert.equal(kind,'bank');return {acquired:false,leasedUntil:'2026-09-01T05:10:00.000Z'}},
  releaseFinanceSyncLease:async()=>{lockedBankReleases++;return true},
});
assert.equal(await lockedBank.refreshBankBalance({auto:false}),false);
assert.equal(lockedBankFetches,0,'a denied shared bank lease must stop before the local Bridge opens a bank session');
assert.equal(lockedBankReleases,0,'a client must not release a lease it never acquired');

let lockedCreditFetches=0,lockedCreditReleases=0;
const lockedCredit=createDomainsCreditController({
  model:creditModel,saveState:async()=>true,toast:()=>{},render:()=>{},modal:()=>{},armModalDraftGuard:()=>{},closeModal:()=>{},confirmDialog:async()=>true,
  bridge:{creditStatus:async()=>({bridgeVersion:24,profiles:[{profileId:'p1'}]}),syncCreditCards:async()=>{lockedCreditFetches++}},
  claimFinanceSyncLease:async kind=>{assert.equal(kind,'credit');return {acquired:false,leasedUntil:'2026-09-01T05:10:00.000Z'}},
  releaseFinanceSyncLease:async()=>{lockedCreditReleases++;return true},
});
assert.equal(await lockedCredit.refreshCreditSync({auto:false}),false);
assert.equal(lockedCreditFetches,0,'a denied shared credit lease must stop before the local Bridge opens issuer sessions');
assert.equal(lockedCreditReleases,0,'a client must not release a credit lease it never acquired');

let raceBankReads=0,raceBankFetches=0,raceBankReleases=0;
const raceBank=createDomainsBankController({
  model:bankModel,session:{backendReady:true,connectionMode:'supabase'},checksSession:{},sharedChecksHaveLocalWork:()=>false,saveState:async()=>true,
  syncSharedChecksFromCloud:async()=>true,sharedChecksObservedSequence:()=>0,toast:()=>{},render:()=>{},
  bridge:{getBridgeToken:()=> 'paired',markAutoAttempt:()=>{},fetchBalance:async()=>{raceBankFetches++},autoEnabled:()=>true,autoAttemptDelayMs:()=>0},
  refreshFinanceCloudSnapshot:async()=>({verified:true,state:{bank:{source:'hapoalim',bankSyncAt:++raceBankReads===1?old:fresh,feed:{version:4,provider:'hapoalim',balance:200,syncedAt:raceBankReads===1?old:fresh,transactions:[]}}}}),
  claimFinanceSyncLease:async()=>({acquired:true,leasedUntil:'2026-09-01T05:20:00.000Z'}),
  releaseFinanceSyncLease:async()=>{raceBankReleases++;return true},
});
assert.equal(await raceBank.refreshBankBalance({auto:true}),true);
assert.equal(raceBankReads,2,'bank auto refresh rechecks the shared timestamp after atomically acquiring its lease');
assert.equal(raceBankFetches,0,'if another machine completed while this machine was acquiring the lease, no duplicate bank scrape starts');
assert.equal(raceBankReleases,1,'an acquired bank lease is released even when the post-claim freshness check suppresses scraping');

let raceCreditReads=0,raceCreditFetches=0,raceCreditReleases=0;
const raceCredit=createDomainsCreditController({
  model:creditModel,saveState:async()=>true,toast:()=>{},render:()=>{},modal:()=>{},armModalDraftGuard:()=>{},closeModal:()=>{},confirmDialog:async()=>true,
  bridge:{creditStatus:async()=>({bridgeVersion:24,profiles:[{profileId:'p1'}]}),syncCreditCards:async()=>{raceCreditFetches++}},
  refreshFinanceCloudSnapshot:async()=>({verified:true,state:{creditSync:{version:3,mode:'synced',syncedAt:++raceCreditReads===1?old:fresh,profiles:[],errors:[],cardMappings:{}}}}),
  claimFinanceSyncLease:async()=>({acquired:true,leasedUntil:'2026-09-01T05:20:00.000Z'}),
  releaseFinanceSyncLease:async()=>{raceCreditReleases++;return true},
});
assert.equal(await raceCredit.refreshCreditSync({auto:true}),true);
assert.equal(raceCreditReads,2,'credit auto refresh rechecks the shared timestamp after atomically acquiring its lease');
assert.equal(raceCreditFetches,0,'if another machine completed while this machine was acquiring the lease, no duplicate issuer scrape starts');
assert.equal(raceCreditReleases,1,'an acquired credit lease is released after the post-claim freshness check');


const dirtyModel={state:{version:4,cash:[{id:'local-cash',amount:77}],rights:[],notes:[],expenses:[],credits:[],cards:[],checks:[],bank:{currentBalance:null,updatedAt:null,asOfDate:null,adjustments:[{id:'local-adjustment',amount:25}],source:null,sourceAccount:null,snapshotToken:'LOCAL-SNAPSHOT',snapshotSeq:7},creditSync:{version:3,mode:'synced',syncedAt:old,profiles:[],errors:[],cardMappings:{}}}};
const normalization=createStateNormalization({model:dirtyModel});dirtyModel.state=normalization.normalizeState(dirtyModel.state);
const savedBase=normalization.prepareKupaCloudState({...structuredClone(dirtyModel.state),cash:[]});
const financeOnlyRemote=structuredClone(savedBase);financeOnlyRemote.cash=[];financeOnlyRemote.bank={...financeOnlyRemote.bank,currentBalance:4321,updatedAt:fresh,source:'hapoalim',bankSyncAt:fresh,feed:{version:4,provider:'hapoalim',accountNumber:'1-2',balance:4321,syncedAt:fresh,transactions:[]}};financeOnlyRemote.creditSync={version:3,mode:'synced',syncedAt:fresh,profiles:[],errors:[],cardMappings:{}};
const dirtySession={connectionMode:'supabase',backendReady:true,dbRevision:8,financeRevision:3,financeUpdatedAt:null,cloudSyncBusy:false,cloudWriteBusy:false,cloudConflictPending:false};
let dirtyRenders=0;
const dirtySync=createSyncDocument({
  model:dirtyModel,session:dirtySession,checksSession:{},tab:{primaryTab:true},
  prepareKupaCloudState:(...args)=>normalization.prepareKupaCloudState(...args),applyKupaCloudState:(...args)=>normalization.applyKupaCloudState(...args),
  getCloudPending:async()=>null,readSupabaseDocument:async()=>({revision:8,financeRevision:4,financeUpdatedAt:fresh,state:structuredClone(financeOnlyRemote)}),
  lastSavedCloudState:()=>structuredClone(savedBase),persistImmediateBrowserSnapshot:()=>{},render:()=>{dirtyRenders++},pollSharedChecks:async()=>{},
});
await dirtySync.cloudPoll();
assert.equal(dirtyModel.state.cash[0].id,'local-cash','finance-only polling must not overwrite an unsaved local Kupa edit with the remote Kupa payload');
assert.equal(dirtyModel.state.bank.currentBalance,4321,'finance-only polling still applies the newer shared bank payload');
assert.equal(dirtyModel.state.bank.adjustments[0].id,'local-adjustment','finance-only polling preserves Kupa-owned bank adjustments');
assert.equal(dirtyModel.state.bank.snapshotToken,'LOCAL-SNAPSHOT','finance-only polling preserves the Kupa-owned bank watermark');
assert.equal(dirtyModel.state.creditSync.syncedAt,fresh,'finance-only polling applies the newest shared credit timestamp');
assert.equal(dirtySession.financeRevision,4);
assert.equal(dirtyRenders,1);


const persistModel={state:{version:4,businessName:'קופה',checks:[],credits:[],cash:[],rights:[],notes:[],expenses:[{id:'EXP-1',description:'משכנתא',account:'ביתי',amount:5000,date:'2026-09-05',type:'קבוע',recurring:true,active:true}],cards:[],bank:{currentBalance:4321,updatedAt:fresh,asOfDate:'2026-09-01',adjustments:[],source:'hapoalim',sourceAccount:'biz',snapshotToken:'WATERMARK',snapshotSeq:11,feed:{version:4,provider:'hapoalim',accountNumber:'biz',balance:4321,syncedAt:fresh,transactions:[]},homeFeed:{version:4,provider:'hapoalim',accountNumber:'home',balance:8765,syncedAt:fresh,transactions:[]}},creditSync:{version:3,mode:'synced',syncedAt:fresh,profiles:[],errors:[],cardMappings:{}}}};
const persistNormalization=createStateNormalization({model:persistModel});persistModel.state=persistNormalization.normalizeState(persistModel.state);
const persistedBase=persistNormalization.prepareKupaCloudState({...structuredClone(persistModel.state),expenses:[]});
const persistSession={connectionMode:'supabase',backendReady:true,dbRevision:4,financeRevision:9,financeUpdatedAt:fresh,cloudSyncBusy:false,cloudWriteBusy:false,cloudConflictPending:false,cloudDocumentName:'main',localGeneration:1,lastSavedSnapshot:JSON.stringify(persistedBase),serverInfo:{}};
let pendingPersist=null,persistRenders=0,persistRpcRevision=4;
const persistSync=createSyncDocument({
  model:persistModel,session:persistSession,checksSession:{},tab:{primaryTab:true},
  prepareKupaCloudState:(...args)=>persistNormalization.prepareKupaCloudState(...args),applyKupaCloudState:(...args)=>persistNormalization.applyKupaCloudState(...args),
  getCloudPending:async()=>pendingPersist,stageCloudPendingLocal:(snapshot,msg,baseRevision,baseState,generation,conflict=false)=>(pendingPersist={snapshot:structuredClone(snapshot),msg,baseRevision,baseState:structuredClone(baseState),generation,conflict}),
  clearCloudPending:async()=>{pendingPersist=null;return true},rebaseNewerPending:async()=>false,lastSavedCloudState:()=>structuredClone(persistedBase),
  supaRest:async(path,{body})=>{assert.match(path,/save_kupa_document/);const payload=JSON.parse(body);return {ok:true,text:async()=>JSON.stringify({revision:++persistRpcRevision,state:payload.p_state,updated_at:'2026-09-01T04:05:00.000Z'})}},
  persistImmediateBrowserSnapshot:()=>{},backupSnapshotToComputer:async()=>{},render:()=>{persistRenders++},toast:()=>{},setSaveStatus:()=>{},setCloudHeaderStatus:()=>{},reportError:()=>{},pollSharedChecks:async()=>{},
});
const expenseSnapshot=persistNormalization.prepareKupaCloudState(persistModel.state);
assert.equal(await persistSync.persistSupabaseState(expenseSnapshot,'ההוצאה נשמרה',1),true);
assert.equal(persistModel.state.expenses[0].description,'משכנתא','a normal Kupa save keeps the newly persisted expense visible');
assert.equal(persistModel.state.bank.currentBalance,4321,'a Kupa document save must not erase the synchronized business bank overlay');
assert.equal(persistModel.state.bank.homeFeed.balance,8765,'a Kupa document save must not erase the synchronized home bank overlay');
assert.equal(persistModel.state.creditSync.syncedAt,fresh,'a Kupa document save must not reset synchronized credit status to unsynchronized');
assert.equal(persistSession.financeRevision,9,'saving Kupa-owned data does not invent or roll back the independent finance revision');
assert.equal(persistRenders,1);

// A manual business balance is Kupa-owned even when an older synchronized feed is still retained for diagnostics.
persistModel.state.bank={...persistModel.state.bank,currentBalance:1111,updatedAt:'2026-09-01T04:10:00.000Z',asOfDate:'2026-09-01',source:'manual',sourceAccount:null};
persistModel.state.expenses.push({id:'EXP-2',description:'הוצאה עסקית',account:'עסקי',amount:50,date:'2026-09-06',type:'קבוע',recurring:true,active:true});
persistSession.localGeneration=2;
const manualSnapshot=persistNormalization.prepareKupaCloudState(persistModel.state);
assert.equal(await persistSync.persistSupabaseState(manualSnapshot,'הוצאה נוספת נשמרה',2),true);
assert.equal(persistModel.state.bank.currentBalance,1111,'a Kupa save must preserve the authoritative manual business balance rather than revive an older finance balance');
assert.equal(persistModel.state.bank.source,'manual','manual bank ownership remains in the Kupa document after unrelated saves');
assert.equal(persistModel.state.bank.feed.accountNumber,'biz','finance-owned synchronized feed metadata remains available alongside a manual business snapshot');
assert.equal(persistModel.state.bank.homeFeed.balance,8765,'the independent home feed remains available after a manual business snapshot is saved');
assert.equal(persistModel.state.creditSync.syncedAt,fresh,'credit synchronization state remains finance-owned in mixed manual/synchronized bank mode');

// The production controller deliberately keeps an auto-refresh timer alive. Clear it so this focused model test exits cleanly.
creditController.setCreditAutoRefresh(false);
creditUnavailable.setCreditAutoRefresh(false);
lockedCredit.setCreditAutoRefresh(false);
raceCredit.setCreditAutoRefresh(false);
Date.now=realDateNow;
console.log('PASS cross-app finance freshness: cloud timestamps are canonical and distributed leases suppress simultaneous / raced bank and credit scrapes');
