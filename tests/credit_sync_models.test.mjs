import assert from 'node:assert/strict';
import {
  CREDIT_HISTORY_DAYS,
  CREDIT_FUTURE_MONTHS,
  CREDIT_PROVIDER_CONFIG,
  creditProviderSupported,
  creditProfilePublic,
  creditProfilesShareLoginIdentity,
  normalizeCreditProfileInput,
  normalizeCreditScrapeAccount,
  creditScrapeFailure,
} from '../netunim-kupa/bank-bridge/lib.mjs';
import {
  CREDIT_SYNC_VERSION,
  CREDIT_PROVIDER_LABELS,
  creditCardMappingKey,
  creditSyncHasData,
  creditSyncHasIncludedCards,
  mergeCreditSyncResult,
  normalizeCreditSync,
  syncedInstallmentsData,
  syncedCreditSeries,
} from '../netunim-kupa/site/assets/js/domains/credit/sync-feed.js';
import {allInstallmentsData,businessInstallmentsData,nextCreditCycleData,nextBusinessCreditCycleData,creditDetailPartitionsData,CREDIT_DETAIL_HISTORY_DAYS} from '../netunim-kupa/site/assets/js/domains/credit/model.js';
import {createDomainsBankBridge} from '../netunim-kupa/site/assets/js/domains/bank/bridge.js';
import {bankLongTermPositionData} from '../netunim-kupa/site/assets/js/domains/bank/model.js';
import {createDomainsCreditController} from '../netunim-kupa/site/assets/js/domains/credit/controller.js';
import {createStateNormalization} from '../netunim-kupa/site/assets/js/state/normalization.js';

assert.equal(CREDIT_SYNC_VERSION,3,'credit feed v3 is the synced-primary/additive-manual model');
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
assert.equal(creditProfilesShareLoginIdentity(max1,max2),false,'different usernames at the same issuer remain separate login identities');
const maxDuplicate=normalizeCreditProfileInput({profileId:'p-max-a-duplicate',provider:'max',label:'MAX duplicate',username:'user-a',password:'different-secret'});
assert.equal(creditProfilesShareLoginIdentity(max1,maxDuplicate),true,'the same provider username is one login identity even when a second card/password entry is attempted');
assert.equal(creditProfilePublic(max1).credentials,undefined,'public bridge profile never exposes credentials');
const edited=normalizeCreditProfileInput({profileId:max1.profileId,provider:'max',label:'MAX א - חדש',username:'',password:''},max1);
assert.equal(edited.credentials.username,'user-a','editing local metadata with blank secret fields preserves encrypted credentials');
assert.equal(edited.credentials.password,'secret-a');
assert.throws(()=>normalizeCreditProfileInput({profileId:'bad',provider:'isracard',id:'123456789',card6Digits:'12345',password:'x'}),e=>e?.code==='INVALID_CARD6','Isracard requires exactly six card digits');
const isracard=normalizeCreditProfileInput({profileId:'p-isra',provider:'isracard',id:'123456789',card6Digits:'123456',password:'x',defaultAccount:'עסקי'});
const amex=normalizeCreditProfileInput({profileId:'p-amex',provider:'amex',id:'123456789',card6Digits:'654321',password:'x',defaultAccount:'ביתי'});
assert.equal(isracard.credentials.card6Digits,'123456');
assert.equal(amex.credentials.card6Digits,'654321');
const isracardSameOwnerDifferentCard=normalizeCreditProfileInput({profileId:'p-isra-2',provider:'isracard',id:'123456789',card6Digits:'999999',password:'other'});
assert.equal(creditProfilesShareLoginIdentity(isracard,isracardSameOwnerDifferentCard),true,'Isracard uses one connection per identity; another card suffix must not create a duplicate login profile');
assert.equal(creditProfilesShareLoginIdentity(isracard,amex),false,'Isracard and Amex remain separate provider identities even for the same ID');
const secretMarker='DO_NOT_PERSIST_THIS_PASSWORD';
const htmlFailure=creditScrapeFailure({errorType:'GENERIC',errorMessage:`fetchPostWithinPage parse error: Unexpected token '<', "<!DOCTYPE html>"; url: https://he.americanexpress.co.il/services/ProxyRequestHandler.ashx?reqName=ValidateIdData; data: {"Sisma":"${secretMarker}"}`},amex);
assert.equal(htmlFailure.code,'CREDIT_LOGIN_HTML_RESPONSE','HTML returned by the Amex validation JSON endpoint is classified explicitly');
assert.equal(htmlFailure.message.includes(secretMarker),false,'technical scraper errors never expose credential-bearing request payloads');
assert.match(htmlFailure.message,/ValidateIdData/,'Amex immediate-close diagnostic identifies the exact pre-password stage rather than guessing at the password');

const normalizedAccount=normalizeCreditScrapeAccount({
  accountNumber:'4321',balance:-1250.75,balanceDate:'2026-09-10T00:00:00.000Z',cardFrame:15000,
  txns:[
    {identifier:'deal-1',type:'installments',date:'2026-08-20T00:00:00.000Z',processedDate:'2026-09-10T00:00:00.000Z',originalAmount:-300,originalCurrency:'ILS',chargedAmount:-100,chargedCurrency:'ILS',description:'ספק',installments:{number:1,total:3},status:'completed'},
    {identifier:'refund-1',date:'2026-08-22T00:00:00.000Z',processedDate:'2026-09-10T00:00:00.000Z',originalAmount:50,originalCurrency:'ILS',chargedAmount:50,chargedCurrency:'ILS',description:'זיכוי',status:'completed'},
  ],
});
assert.equal(normalizedAccount.accountNumber,'4321');
assert.equal(normalizedAccount.cardFrame,15000);
assert.equal(normalizedAccount.availableCredit,null,'an issuer credit limit is not mislabeled as available credit without provider proof');
assert.equal(normalizedAccount.txns[0].installments.total,3);
assert.equal(normalizedAccount.txns[0].chargedAmount,-100);
const maxFrame=normalizeCreditScrapeAccount({accountNumber:'9999',balance:-1250.75,cardFrame:15000},'max');
assert.equal(maxFrame.availableCredit,13749.25,'MAX OpenToBuy is recovered exactly from the scraper-defined balance and credit limit');
const missingNumbers=normalizeCreditScrapeAccount({accountNumber:'0000',balance:null,cardFrame:null,availableCredit:null});
assert.equal(missingNumbers.balance,null);assert.equal(missingNumbers.cardFrame,null);assert.equal(missingNumbers.availableCredit,null);

const previous=normalizeCreditSync({
  version:1,mode:'manual',syncedAt:'2026-08-29T09:00:00.000Z',
  profiles:[
    {profileId:'p-max-a',provider:'max',label:'MAX א',ownerLabel:'אדם א',defaultAccount:'עסקי',syncedAt:'2026-08-29T09:00:00.000Z',accounts:[{accountNumber:'4321',balance:-900,txns:[{id:'old',processedDate:'2026-09-10T00:00:00.000Z',chargedAmount:-90,chargedCurrency:'ILS',description:'ישן'}]}]},
    {profileId:'p-max-b',provider:'max',label:'MAX ב',ownerLabel:'אדם ב',defaultAccount:'ביתי',syncedAt:'2026-08-29T09:00:00.000Z',accounts:[{accountNumber:'4321',balance:-500,txns:[{id:'keep',processedDate:'2026-09-10T00:00:00.000Z',chargedAmount:-50,chargedCurrency:'ILS',description:'יישאר'}]}]},
  ],
});
const keyA=creditCardMappingKey('p-max-a','4321'),keyB=creditCardMappingKey('p-max-b','4321');
const merged=mergeCreditSyncResult(previous,{
  syncedAt:'2026-08-30T10:00:00.000Z',
  profiles:[{profileId:'p-max-a',provider:'max',label:'MAX א',ownerLabel:'אדם א',defaultAccount:'עסקי',syncedAt:'2026-08-30T10:00:00.000Z',accounts:[normalizedAccount]}],
  errors:[{profileId:'p-max-b',provider:'max',label:'MAX ב',code:'CREDIT_TIMEOUT',message:'זמנית לא זמין',at:'2026-08-30T10:00:00.000Z'}],
});
assert.equal(merged.profiles.length,2,'partial sync replaces successful profile slice without deleting failed profile data');
assert.equal(merged.profiles.find(p=>p.profileId==='p-max-b').accounts[0].txns[0].id,'keep','last successful data survives a failed profile refresh');
assert.equal(merged.syncedAt,'2026-08-30T10:00:00.000Z','shared credit sync time advances when at least one profile succeeded');
assert.equal(merged.errors.length,1);
const structuredFailure=normalizeCreditSync({errors:[{profileId:'p-amex',provider:'amex',code:'CREDIT_AUTOMATION_BLOCKED',stage:'LoginPage',httpStatus:403,message:'חסימה',at:'2026-08-30T10:00:00.000Z'}]}).errors[0];
assert.equal(structuredFailure.stage,'LoginPage','credit diagnostics preserve the safe failure stage');
assert.equal(structuredFailure.httpStatus,403,'credit diagnostics preserve the issuer HTTP status without retaining response HTML');
assert.equal(merged.mode,'synced','v3 has one canonical synchronized source marker; manual mode no longer exists as a calculation switch');
assert.equal(creditSyncHasData({creditSync:merged}),true);
assert.equal(merged.cardMappings[keyA]?.included,true,'v1 discovered cards migrate as included so an upgrade never silently removes existing forecast amounts');
assert.equal(merged.cardMappings[keyB]?.included,true);
assert.equal(merged.cardMappings[keyA]?.hidden,false,'existing cards migrate as visible unless explicitly hidden');

const allFailed=mergeCreditSyncResult(merged,{profiles:[],errors:[{profileId:'p-max-a',provider:'max',code:'CREDIT_TIMEOUT',message:'כשל'}]});
assert.equal(allFailed.syncedAt,merged.syncedAt,'all-failed refresh preserves last successful sync timestamp');
assert.equal(allFailed.profiles.length,2,'all-failed refresh preserves every last successful profile slice');
const sanitizedHistoricalError=normalizeCreditSync({errors:[{profileId:'p-isra',message:`fetchPostWithinPage parse error <!DOCTYPE html> password=${secretMarker}`}]}).errors[0];
assert.equal(sanitizedHistoricalError.message.includes(secretMarker),false,'historical technical bridge errors are scrubbed before display/re-persistence');
const discoveredLater=mergeCreditSyncResult(merged,{syncedAt:'2026-08-30T11:00:00.000Z',profiles:[{profileId:'p-max-a',provider:'max',label:'MAX א',ownerLabel:'אדם א',defaultAccount:'עסקי',accounts:[normalizedAccount,{accountNumber:'7777',txns:[{id:'new',processedDate:'2026-10-10T00:00:00.000Z',chargedAmount:-77,chargedCurrency:'ILS',description:'חדש'}]}]}],errors:[]});
assert.equal(discoveredLater.cardMappings[creditCardMappingKey('p-max-a','7777')]?.included,false,'cards first discovered after v2 remain opt-in when upgraded to v3');
assert.equal(discoveredLater.cardMappings[creditCardMappingKey('p-max-a','7777')]?.hidden,false);

assert.notEqual(keyA,keyB,'same card suffix under two login identities has independent business/home mapping');
const syncedState={
  credits:[{id:'manual-1',active:true,firstChargeDate:'2026-09-10',totalAmount:999,installments:1,card:'ידני',account:'עסקי',ownerLabel:'אדם א',description:'ידני'}],
  creditSync:{...merged,cardMappings:{
    [keyA]:{included:true,hidden:false,account:'עסקי',cardName:'MAX עסקי'},
    [keyB]:{included:true,hidden:false,account:'ביתי',cardName:'MAX ביתי'},
  }},
};
const rows=syncedInstallmentsData(syncedState);
assert(rows.some(r=>r.profileId==='p-max-a'&&r.card==='MAX עסקי'&&r.account==='עסקי'&&r.ownerLabel==='אדם א'&&r.amount===100),'issuer debit sign becomes a positive Kupa obligation with owner/business classification');
assert(rows.some(r=>r.profileId==='p-max-a'&&r.amount===-50),'issuer refund/credit becomes a negative Kupa obligation rather than being double-counted as spending');
assert(rows.some(r=>r.profileId==='p-max-b'&&r.card==='MAX ביתי'&&r.account==='ביתי'),'same issuer/account suffix can be classified differently for another owner profile');
assert.equal(creditSyncHasIncludedCards(syncedState),true,'at least one synchronized card is explicitly included');
assert(businessInstallmentsData(syncedState).every(r=>r.account==='עסקי'),'business cash-flow selector excludes every home-classified card while the general credit report keeps both classifications');
assert(allInstallmentsData(syncedState).some(r=>r.account==='ביתי'),'home included cards remain present in ordinary credit reporting');
assert.equal(nextBusinessCreditCycleData(syncedState,'2026-09-01').rows.some(r=>r.account==='ביתי'),false,'the business next-cycle calculation cannot select a home card');
assert.equal(allInstallmentsData(syncedState).some(r=>r.creditId==='manual-1'),true,'manual additions are additive to synchronized issuer rows, never an alternative mode');
const businessOnlyBankState={version:4,checks:[],cash:[],expenses:[],cards:[],bank:{currentBalance:1000,asOfDate:'2999-09-01',adjustments:[]},creditSync:normalizeCreditSync({version:3,profiles:[
  {profileId:'biz',provider:'max',defaultAccount:'עסקי',accounts:[{accountNumber:'1000',txns:[{id:'biz-tx',processedDate:'2999-09-10',chargedAmount:-100,chargedCurrency:'ILS',description:'עסקי'}]}]},
  {profileId:'home',provider:'max',defaultAccount:'ביתי',accounts:[{accountNumber:'2000',txns:[{id:'home-tx',processedDate:'2999-09-10',chargedAmount:-250,chargedCurrency:'ILS',description:'ביתי'}]}]},
],cardMappings:{
  [creditCardMappingKey('biz','1000')]:{included:true,hidden:false,account:'עסקי'},
  [creditCardMappingKey('home','2000')]:{included:true,hidden:false,account:'ביתי'},
}}),credits:[]};
const businessBankPosition=bankLongTermPositionData(businessOnlyBankState);
assert.equal(allInstallmentsData(businessOnlyBankState).reduce((sum,row)=>sum+row.amount,0),350,'credit reporting still contains both included business and home obligations');
assert.equal(businessBankPosition.credit,100,'bank long-term credit subtraction includes only the business-classified obligation');
assert.equal(businessBankPosition.net,900,'home credit cannot reduce the business Kupa net position');

const legacyModeState={...syncedState,creditSync:{...syncedState.creditSync,mode:'manual'}};
assert.equal(normalizeCreditSync(legacyModeState.creditSync).mode,'synced','a legacy manual mode flag is normalized away');
assert(allInstallmentsData(legacyModeState).some(r=>r.source==='credit_sync'),'legacy mode flags cannot disable issuer calculations');

const series=syncedCreditSeries(syncedState,'2026-09-01');
const dealSeries=series.find(x=>x.description==='ספק');
assert(dealSeries,'included visible synchronized purchases become detail-table series');
assert.equal(dealSeries.totalAmount,300,'issuer original amount supplies the synchronized series total when it covers known installments');
assert.equal(dealSeries.remainingCount,3,'installment progress is derived from explicit installment numbers');
assert.equal(dealSeries.next.part,1);
assert.equal(dealSeries.partial,true,'missing future installment rows are flagged rather than silently invented');

const historyKey=creditCardMappingKey('history','1000');
const historyState={credits:[],creditSync:normalizeCreditSync({version:3,profiles:[{profileId:'history',provider:'max',accounts:[{accountNumber:'1000',txns:[
  {id:'active',processedDate:'2026-10-01',chargedAmount:-30,chargedCurrency:'ILS',description:'פעילה'},
  {id:'recent',processedDate:'2026-08-15',chargedAmount:-40,chargedCurrency:'ILS',description:'הסתיימה לאחרונה'},
  {id:'old',processedDate:'2026-05-01',chargedAmount:-50,chargedCurrency:'ILS',description:'היסטוריה ישנה'},
]}]}],cardMappings:{[historyKey]:{included:true,hidden:false,account:'עסקי'}}})};
const partitions=creditDetailPartitionsData(historyState,'2026-09-01');
assert.equal(CREDIT_DETAIL_HISTORY_DAYS,60);
assert.deepEqual(partitions.active.map(x=>x.series.description),['פעילה'],'regular detail contains only obligations with a future charge');
assert.deepEqual(partitions.history.map(x=>x.series.description),['הסתיימה לאחרונה'],'completed rows stay in a separate bounded history');
assert.equal(partitions.olderCount,1,'older completed rows remain in source data without cluttering either ordinary or recent-history detail');

const collisionState={credits:[],creditSync:normalizeCreditSync({version:3,profiles:[
  {profileId:'owner-a',provider:'max',accounts:[{accountNumber:'1111',txns:[{id:'a',processedDate:'2026-09-10',chargedAmount:-10,chargedCurrency:'ILS'}]}]},
  {profileId:'owner-b',provider:'max',accounts:[{accountNumber:'1111',txns:[{id:'b',processedDate:'2026-09-20',chargedAmount:-20,chargedCurrency:'ILS'}]}]},
],cardMappings:{[creditCardMappingKey('owner-a','1111')]:{included:true,cardName:'אותו שם'},[creditCardMappingKey('owner-b','1111')]:{included:true,cardName:'אותו שם'}}})};
assert.equal(nextCreditCycleData(collisionState,'2026-09-01').rows.length,2,'same display name/card suffix under different login identities cannot collapse one card cycle');

const hiddenState={...syncedState,creditSync:{...syncedState.creditSync,cardMappings:{...syncedState.creditSync.cardMappings,[keyA]:{...syncedState.creditSync.cardMappings[keyA],hidden:true}}}};
const hiddenForecast=syncedInstallmentsData(hiddenState);
assert(hiddenForecast.some(r=>r.profileId==='p-max-a'&&r.hidden===true),'hidden is a presentation flag and does not remove an included card from cash-flow calculation');
assert.equal(syncedCreditSeries(hiddenState,'2026-09-01').some(r=>r.profileId==='p-max-a'),false,'hidden cards are absent from the detailed synchronized purchase table');

const foreign=normalizeCreditSync({version:3,profiles:[{profileId:'fx',provider:'visaCal',label:'כאל',defaultAccount:'עסקי',accounts:[{accountNumber:'9999',txns:[{id:'usd',processedDate:'2026-09-10T00:00:00.000Z',chargedAmount:-100,chargedCurrency:'USD',originalAmount:-100,originalCurrency:'USD',description:'עסקה דולרית'}]}]}],cardMappings:{[creditCardMappingKey('fx','9999')]:{included:true,hidden:false,account:'עסקי'}}});
assert.equal(syncedInstallmentsData({creditSync:foreign}).length,0,'foreign-currency amounts never silently enter an ILS cash-flow forecast');
assert.equal(CREDIT_PROVIDER_LABELS.visaCal,'כאל');

const pendingAndIdless=normalizeCreditSync({version:1,profiles:[{profileId:'p-cal',provider:'visaCal',label:'כאל',defaultAccount:'עסקי',accounts:[{accountNumber:'1111',txns:[
  {id:'',status:'completed',date:'2026-08-30T00:00:00.000Z',processedDate:'2026-09-10T00:00:00.000Z',chargedAmount:-25,chargedCurrency:'ILS',description:'עסקה זהה'},
  {id:'',status:'completed',date:'2026-08-30T00:00:00.000Z',processedDate:'2026-09-10T00:00:00.000Z',chargedAmount:-25,chargedCurrency:'ILS',description:'עסקה זהה'},
  {id:'pending-1',status:'pending',date:'2026-08-30T00:00:00.000Z',processedDate:'2026-08-30T00:00:00.000Z',chargedAmount:-80,chargedCurrency:'ILS',description:'ממתינה'},
]}]}]});
const pendingRows=syncedInstallmentsData({creditSync:pendingAndIdless});
assert.equal(pendingRows.filter(r=>r.amount===25).length,2,'two legitimate id-less issuer transactions are not collapsed merely because their visible fields match');
assert.equal(pendingRows.some(r=>r.description==='ממתינה'),false,'pending issuer rows never enter the cash-flow forecast with a purchase date masquerading as a billing date');
const originalFallback=normalizeCreditSync({version:3,profiles:[{profileId:'fallback',provider:'max',accounts:[{accountNumber:'2222',balance:null,cardFrame:null,txns:[{id:'original-only',processedDate:'2026-09-10',chargedAmount:null,originalAmount:-12,chargedCurrency:'ILS'}]}]}],cardMappings:{[creditCardMappingKey('fallback','2222')]:{included:true}}});
assert.equal(originalFallback.profiles[0].accounts[0].balance,null,'missing issuer balance remains unavailable instead of becoming a displayed zero');
assert.equal(syncedInstallmentsData({creditSync:originalFallback})[0].amount,12,'a missing charged amount falls back to the explicit original amount instead of being coerced to zero');

const normalizationModel={state:{},lastNormalizeRemovedCredits:0};
const stateNormalization=createStateNormalization({model:normalizationModel});
const migratedState=stateNormalization.normalizeState({version:4,creditSync:{version:2,profiles:[],cardMappings:{}},credits:[{id:'old-manual',active:true,firstChargeDate:'2026-09-10',totalAmount:100,installments:1,card:'ישן',account:'עסקי'}]});
assert.equal(migratedState.creditSync.version,3);
assert.equal(migratedState.credits.length,0,'v2 -> v3 migration removes the historical manual dataset exactly once as requested');
migratedState.credits.push({id:'new-manual',active:true,firstChargeDate:'2026-09-10',totalAmount:100,installments:1,card:'חדש',account:'עסקי'});
const normalizedAgain=stateNormalization.normalizeState(migratedState);
assert.equal(normalizedAgain.credits[0].id,'new-manual','manual additions created after v3 migration survive future normalization/saves');

const bridgeApi=createDomainsBankBridge();
for(const method of ['creditStatus','saveCreditProfile','deleteCreditProfile','resetCreditProfiles','syncCreditCards']){
  assert.equal(typeof bridgeApi[method],'function',`browser bridge exposes ${method} as a callable local API method`);
}

globalThis.localStorage={getItem:()=>'',setItem:()=>{},removeItem:()=>{}};
const controllerModel={state:{creditSync:normalizeCreditSync({})}};
const creditController=createDomainsCreditController({
  model:controllerModel,
  saveState:async()=>{},toast:()=>{},render:()=>{},
  bridge:{creditStatus:async()=>({bridgeVersion:18,profiles:[]})},
  modal:()=>{},armModalDraftGuard:()=>{},closeModal:()=>{},confirmDialog:async()=>true,
});
for(const method of ['creditSyncUiState','refreshCreditBridgeStatus','openCreditConnectionModal','deleteCreditConnection','resetCreditSync','refreshCreditSync','setCreditCardMapping','setCreditAutoRefresh','maybeAutoRefreshCreditSync']){
  assert.equal(typeof creditController[method],'function',`credit controller exposes ${method}`);
}
assert.equal('setCreditSyncMode' in creditController,false,'credit controller no longer exposes a manual/synchronized source switch');
await creditController.refreshCreditBridgeStatus();
creditController.setCreditAutoRefresh(false);

let resetBridgeCalls=0,resetSaveCalls=0;
const resetModel={state:{credits:[{id:'manual-kept'}],creditSync:normalizeCreditSync({version:3,profiles:[{profileId:'old',provider:'max',accounts:[{accountNumber:'1234',txns:[{id:'old-tx',processedDate:'2026-09-01T00:00:00.000Z',chargedAmount:-10,chargedCurrency:'ILS'}]}]}]})}};
const resetController=createDomainsCreditController({
  model:resetModel,
  saveState:async()=>{resetSaveCalls++},toast:()=>{},render:()=>{},
  bridge:{creditStatus:async()=>({bridgeVersion:18,profiles:[{profileId:'old'}]}),resetCreditProfiles:async()=>{resetBridgeCalls++;return {ok:true,profiles:[]}}},
  modal:()=>{},armModalDraftGuard:()=>{},closeModal:()=>{},confirmDialog:async()=>true,
});
await resetController.resetCreditSync();
assert.equal(resetBridgeCalls,1,'full credit reset deletes the local encrypted issuer profiles through the bridge');
assert.equal(resetSaveCalls,1,'full credit reset persists the cleared synchronized feed through the ordinary Kupa save path');
assert.equal(resetModel.state.creditSync.mode,'synced','full reset keeps the canonical synchronized-source model');
assert.equal(resetModel.state.creditSync.profiles.length,0,'full reset removes synchronized cloud profiles/card data');
assert.equal(resetModel.state.credits[0].id,'manual-kept','full reset preserves post-migration manual additions');

console.log('PASS credit sync models: v3 synced-primary model, one-time manual cleanup, additive manual rows, hidden cards, owner/account classification, safe diagnostics and partial merge are deterministic');
