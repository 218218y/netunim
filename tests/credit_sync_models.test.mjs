import assert from 'node:assert/strict';
import {
  CREDIT_HISTORY_DAYS,
  CREDIT_FUTURE_MONTHS,
  CREDIT_PROVIDER_CONFIG,
  creditProviderSupported,
  creditProfilePublic,
  normalizeCreditProfileInput,
  normalizeCreditScrapeAccount,
} from '../netunim-kupa/bank-bridge/lib.mjs';
import {
  CREDIT_PROVIDER_LABELS,
  creditCardMappingKey,
  creditSyncHasData,
  creditSyncHasIncludedCards,
  mergeCreditSyncResult,
  normalizeCreditSync,
  syncedInstallmentsData,
} from '../netunim-kupa/site/assets/js/domains/credit/sync-feed.js';
import {allInstallmentsData} from '../netunim-kupa/site/assets/js/domains/credit/model.js';
import {createDomainsBankBridge} from '../netunim-kupa/site/assets/js/domains/bank/bridge.js';
import {createDomainsCreditController} from '../netunim-kupa/site/assets/js/domains/credit/controller.js';

assert.deepEqual(Object.keys(CREDIT_PROVIDER_CONFIG).sort(),['amex','isracard','max','visaCal'],'bridge exposes Cal, MAX, Isracard and Amex issuer connections; Mastercard is not a separate login provider');
assert.equal(creditProviderSupported('visaCal'),true);
assert.equal(creditProviderSupported('max'),true);
assert.equal(creditProviderSupported('isracard'),true);
assert.equal(creditProviderSupported('amex'),true);
assert.equal(creditProviderSupported('mastercard'),false,'Mastercard must be connected through its issuer rather than invented as a scraper company');
assert.deepEqual(CREDIT_PROVIDER_CONFIG.visaCal.credentialFields,['username','password']);
assert.deepEqual(CREDIT_PROVIDER_CONFIG.max.credentialFields,['username','password']);
assert.deepEqual(CREDIT_PROVIDER_CONFIG.isracard.credentialFields,['id','card6Digits','password']);
assert.deepEqual(CREDIT_PROVIDER_CONFIG.amex.credentialFields,['id','card6Digits','password']);
assert.equal(CREDIT_HISTORY_DAYS,120,'credit synchronization uses a bounded historical window');
assert.equal(CREDIT_FUTURE_MONTHS,12,'credit synchronization requests a full future year for installment/charge forecasting');

const max1=normalizeCreditProfileInput({profileId:'p-max-a',provider:'max',label:'MAX א',ownerLabel:'אדם א',defaultAccount:'עסקי',username:'user-a',password:'secret-a'});
const max2=normalizeCreditProfileInput({profileId:'p-max-b',provider:'max',label:'MAX ב',ownerLabel:'אדם ב',defaultAccount:'ביתי',username:'user-b',password:'secret-b'});
assert.notEqual(max1.profileId,max2.profileId,'two identities at the same issuer remain separate profiles');
assert.notDeepEqual(max1.credentials,max2.credentials,'same-issuer profiles keep independent credentials');
assert.equal(creditProfilePublic(max1).credentials,undefined,'public bridge profile never exposes credentials');
const edited=normalizeCreditProfileInput({profileId:max1.profileId,provider:'max',label:'MAX א - חדש',username:'',password:''},max1);
assert.equal(edited.credentials.username,'user-a','editing local metadata with blank secret fields preserves encrypted credentials');
assert.equal(edited.credentials.password,'secret-a');
assert.throws(()=>normalizeCreditProfileInput({profileId:'bad',provider:'isracard',id:'123456789',card6Digits:'12345',password:'x'}),e=>e?.code==='INVALID_CARD6','Isracard requires exactly six card digits');
const isracard=normalizeCreditProfileInput({profileId:'p-isra',provider:'isracard',id:'123456789',card6Digits:'123456',password:'x',defaultAccount:'עסקי'});
const amex=normalizeCreditProfileInput({profileId:'p-amex',provider:'amex',id:'123456789',card6Digits:'654321',password:'x',defaultAccount:'ביתי'});
assert.equal(isracard.credentials.card6Digits,'123456');
assert.equal(amex.credentials.card6Digits,'654321');

const normalizedAccount=normalizeCreditScrapeAccount({
  accountNumber:'4321',balance:-1250.75,balanceDate:'2026-09-10T00:00:00.000Z',cardFrame:15000,
  txns:[
    {identifier:'deal-1',type:'installments',date:'2026-08-20T00:00:00.000Z',processedDate:'2026-09-10T00:00:00.000Z',originalAmount:-300,originalCurrency:'ILS',chargedAmount:-100,chargedCurrency:'ILS',description:'ספק',installments:{number:1,total:3},status:'completed'},
    {identifier:'refund-1',date:'2026-08-22T00:00:00.000Z',processedDate:'2026-09-10T00:00:00.000Z',originalAmount:50,originalCurrency:'ILS',chargedAmount:50,chargedCurrency:'ILS',description:'זיכוי',status:'completed'},
  ],
});
assert.equal(normalizedAccount.accountNumber,'4321');
assert.equal(normalizedAccount.txns[0].installments.total,3);
assert.equal(normalizedAccount.txns[0].chargedAmount,-100);

const previous=normalizeCreditSync({
  mode:'manual',syncedAt:'2026-08-29T09:00:00.000Z',
  profiles:[
    {profileId:'p-max-a',provider:'max',label:'MAX א',defaultAccount:'עסקי',syncedAt:'2026-08-29T09:00:00.000Z',accounts:[{accountNumber:'4321',balance:-900,txns:[{id:'old',processedDate:'2026-09-10T00:00:00.000Z',chargedAmount:-90,chargedCurrency:'ILS',description:'ישן'}]}]},
    {profileId:'p-max-b',provider:'max',label:'MAX ב',defaultAccount:'ביתי',syncedAt:'2026-08-29T09:00:00.000Z',accounts:[{accountNumber:'4321',balance:-500,txns:[{id:'keep',processedDate:'2026-09-10T00:00:00.000Z',chargedAmount:-50,chargedCurrency:'ILS',description:'יישאר'}]}]},
  ],
});
const keyA=creditCardMappingKey('p-max-a','4321'),keyB=creditCardMappingKey('p-max-b','4321');
const merged=mergeCreditSyncResult(previous,{
  syncedAt:'2026-08-30T10:00:00.000Z',
  profiles:[{profileId:'p-max-a',provider:'max',label:'MAX א',defaultAccount:'עסקי',syncedAt:'2026-08-30T10:00:00.000Z',accounts:[normalizedAccount]}],
  errors:[{profileId:'p-max-b',provider:'max',label:'MAX ב',code:'CREDIT_TIMEOUT',message:'זמנית לא זמין',at:'2026-08-30T10:00:00.000Z'}],
});
assert.equal(merged.profiles.length,2,'partial sync replaces successful profile slice without deleting failed profile data');
assert.equal(merged.profiles.find(p=>p.profileId==='p-max-b').accounts[0].txns[0].id,'keep','last successful data survives a failed profile refresh');
assert.equal(merged.syncedAt,'2026-08-30T10:00:00.000Z','shared credit sync time advances when at least one profile succeeded');
assert.equal(merged.errors.length,1);
assert.equal(merged.mode,'manual','first/partial synchronization never switches calculations away from the manual source by itself');
assert.equal(creditSyncHasData({creditSync:merged}),true);
assert.equal(merged.cardMappings[keyA]?.included,true,'v1 discovered cards migrate as included so an upgrade never silently removes existing forecast amounts');
assert.equal(merged.cardMappings[keyB]?.included,true);

const allFailed=mergeCreditSyncResult(merged,{profiles:[],errors:[{profileId:'p-max-a',provider:'max',code:'CREDIT_TIMEOUT',message:'כשל'}]});
assert.equal(allFailed.syncedAt,merged.syncedAt,'all-failed refresh preserves last successful sync timestamp');
assert.equal(allFailed.profiles.length,2,'all-failed refresh preserves every last successful profile slice');
const discoveredLater=mergeCreditSyncResult(merged,{syncedAt:'2026-08-30T11:00:00.000Z',profiles:[{profileId:'p-max-a',provider:'max',label:'MAX א',defaultAccount:'עסקי',accounts:[normalizedAccount,{accountNumber:'7777',txns:[{id:'new',processedDate:'2026-10-10T00:00:00.000Z',chargedAmount:-77,chargedCurrency:'ILS',description:'חדש'}]}]}],errors:[]});
assert.equal(discoveredLater.cardMappings[creditCardMappingKey('p-max-a','7777')]?.included,false,'cards first discovered after v2 are opt-in and cannot silently enter Kupa totals');

assert.notEqual(keyA,keyB,'same card suffix under two login identities has independent business/home mapping');
const syncedState={
  credits:[{id:'manual-1',active:true,firstChargeDate:'2026-09-10',totalAmount:999,installments:1,card:'ידני',account:'עסקי',description:'ידני'}],
  creditSync:{...merged,mode:'synced',cardMappings:{
    [keyA]:{included:true,account:'עסקי',cardName:'MAX עסקי'},
    [keyB]:{included:true,account:'ביתי',cardName:'MAX ביתי'},
  }},
};
const rows=syncedInstallmentsData(syncedState);
assert(rows.some(r=>r.profileId==='p-max-a'&&r.card==='MAX עסקי'&&r.account==='עסקי'&&r.amount===100),'issuer debit sign becomes a positive Kupa obligation using the issuer processed date');
assert(rows.some(r=>r.profileId==='p-max-a'&&r.amount===-50),'issuer refund/credit becomes a negative Kupa obligation rather than being double-counted as spending');
assert(rows.some(r=>r.profileId==='p-max-b'&&r.card==='MAX ביתי'&&r.account==='ביתי'),'same issuer/account suffix can be classified differently for another owner profile');
assert.equal(creditSyncHasIncludedCards(syncedState),true,'synced cutover has at least one explicitly included card');
assert.equal(allInstallmentsData(syncedState).some(r=>r.creditId==='manual-1'),false,'synced mode does not double-count preserved manual records');
const manualState={...syncedState,creditSync:{...syncedState.creditSync,mode:'manual'}};
assert.equal(allInstallmentsData(manualState).some(r=>r.creditId==='manual-1'),true,'manual mode remains an immediate rollback path');

const foreign=normalizeCreditSync({mode:'synced',profiles:[{profileId:'fx',provider:'visaCal',label:'כאל',defaultAccount:'עסקי',accounts:[{accountNumber:'9999',txns:[{id:'usd',processedDate:'2026-09-10T00:00:00.000Z',chargedAmount:-100,chargedCurrency:'USD',originalAmount:-100,originalCurrency:'USD',description:'עסקה דולרית'}]}]}]});
assert.equal(syncedInstallmentsData({creditSync:foreign}).length,0,'foreign-currency amounts never silently enter an ILS cash-flow forecast');
assert.equal(CREDIT_PROVIDER_LABELS.visaCal,'כאל');

const pendingAndIdless=normalizeCreditSync({mode:'synced',profiles:[{profileId:'p-cal',provider:'visaCal',label:'כאל',defaultAccount:'עסקי',accounts:[{accountNumber:'1111',txns:[
  {id:'',status:'completed',date:'2026-08-30T00:00:00.000Z',processedDate:'2026-09-10T00:00:00.000Z',chargedAmount:-25,chargedCurrency:'ILS',description:'עסקה זהה'},
  {id:'',status:'completed',date:'2026-08-30T00:00:00.000Z',processedDate:'2026-09-10T00:00:00.000Z',chargedAmount:-25,chargedCurrency:'ILS',description:'עסקה זהה'},
  {id:'pending-1',status:'pending',date:'2026-08-30T00:00:00.000Z',processedDate:'2026-08-30T00:00:00.000Z',chargedAmount:-80,chargedCurrency:'ILS',description:'ממתינה'},
]}]}]});
const pendingRows=syncedInstallmentsData({creditSync:pendingAndIdless});
assert.equal(pendingRows.filter(r=>r.amount===25).length,2,'two legitimate id-less issuer transactions are not collapsed merely because their visible fields match');
assert.equal(pendingRows.some(r=>r.description==='ממתינה'),false,'pending issuer rows never enter the cash-flow forecast with a purchase date masquerading as a billing date');

globalThis.localStorage={getItem:()=>'',setItem:()=>{},removeItem:()=>{}};
const bridgeApi=createDomainsBankBridge();
for(const method of ['creditStatus','saveCreditProfile','deleteCreditProfile','syncCreditCards']){
  assert.equal(typeof bridgeApi[method],'function',`browser bridge exposes ${method} as a callable local API method`);
}


const controllerModel={state:{creditSync:normalizeCreditSync({})}};
const creditController=createDomainsCreditController({
  model:controllerModel,
  saveState:async()=>{},toast:()=>{},render:()=>{},
  bridge:{creditStatus:async()=>({bridgeVersion:12,profiles:[]})},
  modal:()=>{},armModalDraftGuard:()=>{},closeModal:()=>{},confirmDialog:async()=>true,
});
for(const method of ['creditSyncUiState','refreshCreditBridgeStatus','openCreditConnectionModal','deleteCreditConnection','refreshCreditSync','setCreditSyncMode','setCreditCardMapping','setCreditAutoRefresh','maybeAutoRefreshCreditSync']){
  assert.equal(typeof creditController[method],'function',`credit controller exposes ${method}`);
}
await creditController.refreshCreditBridgeStatus();
creditController.setCreditAutoRefresh(false);

console.log('PASS credit sync models: multi-profile issuer credentials, safe partial merge, source cutover/rollback, card mapping and ILS forecast semantics are deterministic');
