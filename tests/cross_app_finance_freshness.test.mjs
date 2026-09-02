import assert from 'node:assert/strict';
import {createDomainsBankController} from '../netunim-kupa/site/assets/js/domains/bank/controller.js';
import {createDomainsCreditController} from '../netunim-kupa/site/assets/js/domains/credit/controller.js';

const store=new Map();
Object.defineProperty(globalThis,'localStorage',{value:{getItem:key=>store.has(key)?store.get(key):null,setItem:(key,value)=>store.set(key,String(value)),removeItem:key=>store.delete(key)},configurable:true});

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

// The production controller deliberately keeps an auto-refresh timer alive. Clear it so this focused model test exits cleanly.
creditController.setCreditAutoRefresh(false);
creditUnavailable.setCreditAutoRefresh(false);
Date.now=realDateNow;
console.log('PASS cross-app finance freshness: Kupa rechecks shared cloud timestamps and suppresses duplicate bank/credit auto scrapes');
