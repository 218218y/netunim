import assert from 'node:assert/strict';
import {financeRefreshDue,FINANCE_AUTO_INTERVAL_MS} from '../netunim-orders/site/assets/js/domains/finance/bridge.js';
import {normalizeBankFeed} from '../netunim-orders/site/assets/js/domains/finance/bank-feed.js';
import {mergeCreditSyncResult,normalizeCreditSync} from '../netunim-orders/site/assets/js/domains/finance/credit-feed.js';
import {createDomainsFinanceController} from '../netunim-orders/site/assets/js/domains/finance/controller.js';

const now=Date.parse('2026-09-01T02:00:00.000Z');
assert.equal(financeRefreshDue(null,now),true);
assert.equal(financeRefreshDue(new Date(now-FINANCE_AUTO_INTERVAL_MS+1).toISOString(),now),false);
assert.equal(financeRefreshDue(new Date(now-FINANCE_AUTO_INTERVAL_MS).toISOString(),now),true);

const bank=normalizeBankFeed({balance:1234,syncedAt:'2026-09-01T01:00:00Z',accountNumber:'123-456',transactions:[
  {id:'a',date:'2026-09-01T00:00:00Z',amount:5,description:'הפקדה'},
  {id:'a',date:'2026-09-01T00:00:00Z',amount:5,description:'הפקדה'},
]});
assert.equal(bank.transactions.length,1,'Orders normalizes the same canonical bank feed instead of duplicating rows');

const initialCredit=normalizeCreditSync({version:3,syncedAt:'2026-08-31T00:00:00Z',profiles:[{profileId:'p1',provider:'max',accounts:[{accountNumber:'1111',txns:[{id:'old',date:'2026-08-31T00:00:00Z',chargedAmount:-50}]}]}],cardMappings:{'p1:1111':{included:true,account:'עסקי',cardName:'עסקי'}}});
const mergedCredit=mergeCreditSyncResult(initialCredit,{syncedAt:'2026-09-01T00:00:00Z',profiles:[{profileId:'p2',provider:'visaCal',accounts:[{accountNumber:'2222',txns:[{id:'new',date:'2026-09-01T00:00:00Z',chargedAmount:-20}]}]}],errors:[{profileId:'p1',message:'temporary'}]});
assert.equal(mergedCredit.profiles.length,2,'partial issuer success preserves previous profiles');
assert.equal(mergedCredit.cardMappings['p1:1111'].included,true,'existing card classification survives cross-app refresh');

Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
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

console.log('PASS Orders finance sync models: shared 24h freshness, revision-safe bank mutation, dual-account feed and credit mapping preservation');
