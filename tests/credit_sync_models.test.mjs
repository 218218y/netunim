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
  creditKnownFutureCommitment,
  creditUpcomingCharge,
  creditFrameStatus,
  creditSyncSummary,
  mergeCreditSyncResult,
  normalizeCreditSync,
  syncedInstallmentsData,
  syncedCreditSeries,
} from '../netunim-kupa/site/assets/js/domains/credit/sync-feed.js';
import {creditSyncHeadlineState} from '../netunim-kupa/site/assets/js/domains/credit/view.js';
import {allInstallmentsData,businessInstallmentsData,homeInstallmentsData,nextCreditCycleData,nextBusinessCreditCycleData,nextHomeCreditCycleData,creditMonthlyDetailData,CREDIT_DETAIL_HISTORY_MONTHS} from '../netunim-kupa/site/assets/js/domains/credit/model.js';
import {createDomainsBankBridge} from '../netunim-kupa/site/assets/js/domains/bank/bridge.js';
import {bankLongTermPositionData,bankNextCycleCommitmentsData,bankHomeNextCycleCommitmentsData,bankProjectedThisMonthData,bankHomeProjectedThisMonthData} from '../netunim-kupa/site/assets/js/domains/bank/model.js';
import {createDomainsCreditController} from '../netunim-kupa/site/assets/js/domains/credit/controller.js';
import {createStateNormalization} from '../netunim-kupa/site/assets/js/state/normalization.js';
import {kupaAccountCashflowData} from '../netunim-orders/site/assets/js/domains/bank/readout.js';
import {todayISO,localISO,dObj,addMonthsISO} from '../netunim-kupa/site/assets/js/core/dates.js';

assert.equal(CREDIT_SYNC_VERSION,4,'credit feed v4 adds monthly Last Known Good coverage without changing the synced-primary/additive-manual calculation model');
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
assert.equal(CREDIT_HISTORY_DAYS,130,'credit synchronization keeps enough issuer history to cover three complete prior calendar months');
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
    {identifier:'deal-1',type:'installments',date:'2026-08-20T00:00:00.000Z',transactionDate:'2026-08-18T00:00:00.000Z',processedDate:'2026-09-10T00:00:00.000Z',originalAmount:-300,originalCurrency:'ILS',chargedAmount:-100,chargedCurrency:'ILS',description:'ספק',installments:{number:1,total:3},status:'completed'},
    {identifier:'refund-1',date:'2026-08-22T00:00:00.000Z',processedDate:'2026-09-10T00:00:00.000Z',originalAmount:50,originalCurrency:'ILS',chargedAmount:50,chargedCurrency:'ILS',description:'זיכוי',status:'completed'},
  ],
});
assert.equal(normalizedAccount.accountNumber,'4321');
assert.equal(normalizedAccount.cardFrame,15000);
assert.equal(normalizedAccount.availableCredit,null,'an issuer credit limit is not mislabeled as available credit without provider proof');
assert.equal(normalizedAccount.txns[0].installments.total,3);
assert.equal(normalizedAccount.txns[0].chargedAmount,-100);
assert.equal(normalizedAccount.txns[0].transactionDate,'2026-08-18T00:00:00.000Z','optional issuer purchase date survives the safe bridge normalization independently of billing date');
const maxFrame=normalizeCreditScrapeAccount({accountNumber:'9999',balance:-1250.75,cardFrame:15000},'max');
assert.equal(maxFrame.availableCredit,13749.25,'MAX OpenToBuy is recovered exactly from the scraper-defined balance and credit limit');
const missingNumbers=normalizeCreditScrapeAccount({accountNumber:'0000',balance:null,cardFrame:null,availableCredit:null});
assert.equal(missingNumbers.balance,null);assert.equal(missingNumbers.cardFrame,null);assert.equal(missingNumbers.availableCredit,null);


const availabilityAccount=normalizeCreditSync({version:3,profiles:[{profileId:'availability',provider:'isracard',accounts:[{accountNumber:'5555',txns:[
  {id:'past',processedDate:'2026-08-10',chargedAmount:-90,chargedCurrency:'ILS',status:'completed'},
  {id:'next-a',processedDate:'2026-09-10',chargedAmount:-250,chargedCurrency:'ILS',status:'completed'},
  {id:'next-refund',processedDate:'2026-09-10',chargedAmount:50,chargedCurrency:'ILS',status:'completed'},
  {id:'later',processedDate:'2026-10-10',chargedAmount:-450,chargedCurrency:'ILS',status:'completed'},
  {id:'pending-no-billing-date',date:'2026-09-02',chargedAmount:-100,chargedCurrency:'ILS',status:'pending'},
  {id:'foreign',processedDate:'2026-09-12',chargedAmount:-80,chargedCurrency:'USD',status:'completed'},
]}]}],cardMappings:{'availability:5555':{included:true,manualFrame:5000}}}).profiles[0].accounts[0];
assert.equal(creditKnownFutureCommitment(availabilityAccount,'2026-09-02'),650,'computed availability subtracts only known future ILS billing rows; pending rows with no billing date and foreign currency do not get guessed into the frame');
assert.deepEqual(creditUpcomingCharge(availabilityAccount,'isracard','2026-09-02'),{amount:200,date:'2026-09-10',source:'transactions'},'Isracard upcoming debit is recovered deterministically from the earliest synchronized future billing date');
const manualFrameStatus=creditFrameStatus(availabilityAccount,{manualFrame:5000},'2026-09-02');
assert.deepEqual(manualFrameStatus,{frame:5000,available:4350,commitments:650,source:'manual_frame_calculated',frameSource:'manual'},'manual frame is a fallback only when issuer frame/available credit is absent');
const issuerFrameStatus=creditFrameStatus({...availabilityAccount,cardFrame:6000},{manualFrame:5000},'2026-09-02');
assert.equal(issuerFrameStatus.available,5350);assert.equal(issuerFrameStatus.source,'issuer_frame_calculated');assert.equal(issuerFrameStatus.frame,6000,'issuer frame always overrides a stored manual fallback');
const directAvailableStatus=creditFrameStatus({...availabilityAccount,cardFrame:6000,availableCredit:4321},{manualFrame:9000},'2026-09-02');
assert.equal(directAvailableStatus.available,4321);assert.equal(directAvailableStatus.source,'issuer_available','issuer-provided available credit is authoritative and is never reduced a second time');
assert.deepEqual(creditUpcomingCharge({balance:-321,balanceDate:'2026-09-10',txns:[]},'visaCal','2026-09-02'),{amount:321,date:'2026-09-10',source:'issuer_balance'},'Cal balance is allowed only as a documented next-debit fallback');
assert.equal(creditUpcomingCharge({balance:-1250,txns:[]},'max','2026-09-02'),null,'MAX balance represents utilized credit and is never mislabeled as an upcoming debit');
const manualMappingSync=normalizeCreditSync({version:3,profiles:[{profileId:'manual-frame',provider:'amex',accounts:[{accountNumber:'7777',txns:[]}]}],cardMappings:{'manual-frame:7777':{included:true,manualFrame:12345.67}}});
assert.equal(manualMappingSync.cardMappings['manual-frame:7777'].manualFrame,12345.67,'manual frame survives normalization in the existing v3 schema without triggering the destructive v2-to-v3 cutover');
assert.equal(normalizeCreditSync({version:3,cardMappings:{bad:{manualFrame:-1}}}).cardMappings.bad.manualFrame,null,'invalid negative manual frame fails closed');
const availabilitySummary=creditSyncSummary({creditSync:normalizeCreditSync({version:3,profiles:[{profileId:'sum',provider:'isracard',accounts:[{accountNumber:'1',txns:[{processedDate:'2026-09-10',chargedAmount:-100,chargedCurrency:'ILS'}]},{accountNumber:'2',availableCredit:2500,txns:[]},{accountNumber:'3',txns:[]}]}],cardMappings:{'sum:1':{included:true,manualFrame:1000},'sum:2':{included:true},'sum:3':{included:true}}})});
assert.equal(availabilitySummary.availableCreditKnownCount,2);assert.equal(availabilitySummary.availableCreditUnknownCount,1,'total available credit stays explicit when one included card still lacks a frame');

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
const monthlyBase=normalizeCreditSync({version:4,contractVersion:2,syncedAt:'2026-09-01T00:00:00Z',profiles:[{profileId:'monthly',provider:'visaCal',syncedAt:'2026-09-01T00:00:00Z',accounts:[{accountNumber:'1111',months:[{month:'2026-11',tier:'forecast',status:'fresh',fetchStatus:'success',fetchedAt:'2026-09-01T00:00:00Z',providerSchemaVersion:'cal-v2',transactions:[{id:'lkg',processedDate:'2026-11-10',chargedAmount:-90,status:'completed'}]}]}]}]});
const monthlyMerged=mergeCreditSyncResult(monthlyBase,{contractVersion:2,syncedAt:'2026-09-02T00:00:00Z',profiles:[{profileId:'monthly',provider:'visaCal',coreComplete:true,accounts:[{accountNumber:'1111',months:[{month:'2026-11',tier:'forecast',fetchStatus:'provider_error',lastErrorCode:'CREDIT_PROVIDER_DATA_ERROR',lastErrorAt:'2026-09-02T00:00:00Z',transactions:[]},{month:'2026-12',tier:'forecast',fetchStatus:'schema_error',lastErrorCode:'CREDIT_PROVIDER_SCHEMA_ERROR',lastErrorAt:'2026-09-02T00:00:00Z',transactions:[]}]}]}],errors:[]});
const monthlyAccount=monthlyMerged.profiles[0].accounts[0],staleNovember=monthlyAccount.months.find(month=>month.month==='2026-11'),missingDecember=monthlyAccount.months.find(month=>month.month==='2026-12');
assert.equal(staleNovember.status,'stale','a failed monthly refresh keeps the prior successful slice and marks it stale');
assert.equal(staleNovember.transactions[0].id,'lkg','monthly Last Known Good transactions are not deleted by partial issuer failure');
assert.equal(missingDecember.status,'missing','a never-successful failed month is explicitly missing instead of being presented as fresh or synthesized');
assert.equal(monthlyAccount.txns.some(tx=>tx.id==='lkg'),true,'legacy consumers read the canonical monthly LKG data without a second persisted transaction copy');
assert.equal(JSON.stringify(monthlyAccount).includes('"txns"'),false,'cloud serialization stores transactions once inside their monthly slices');
const monthlyCoreFailed=mergeCreditSyncResult(monthlyBase,{contractVersion:2,profiles:[{profileId:'monthly',provider:'visaCal',attemptedAt:'2026-09-02T00:00:00Z',coreComplete:false,accounts:[{accountNumber:'1111',balance:-999,months:[{month:'2026-10',tier:'core',fetchStatus:'schema_error',lastErrorCode:'CREDIT_PROVIDER_SCHEMA_ERROR',lastErrorAt:'2026-09-02T00:00:00Z',transactions:[]},{month:'2026-11',tier:'forecast',fetchStatus:'success',fetchedAt:'2026-09-02T00:00:00Z',transactions:[{id:'uncommitted',processedDate:'2026-11-10',chargedAmount:-999,status:'completed'}]}]}]}],errors:[]});
const coreFailedAccount=monthlyCoreFailed.profiles[0].accounts[0];
assert.equal(monthlyCoreFailed.syncedAt,monthlyBase.syncedAt,'an incomplete Core attempt cannot advance the shared successful timestamp');
assert.equal(coreFailedAccount.balance,null,'an incomplete Core attempt cannot replace existing business metadata');
assert.equal(coreFailedAccount.txns[0].id,'lkg','an incomplete Core attempt preserves the complete prior profile snapshot instead of committing sibling slices');
assert.equal(coreFailedAccount.months.find(month=>month.month==='2026-10').status,'missing','the failed Core month is still exposed as missing for diagnosis');
const frameBase=normalizeCreditSync({version:4,syncedAt:'2026-09-01T00:00:00Z',profiles:[{
  profileId:'frame-lkg',provider:'visaCal',syncedAt:'2026-09-01T00:00:00Z',accounts:[{
    accountNumber:'4444',balance:-220,balanceDate:'2026-09-10T00:00:00Z',cardFrame:9000,frameStatus:'fresh',frameFetchStatus:'success',frameFetchedAt:'2026-09-01T00:00:00Z',
    months:[{month:'2026-09',tier:'core',fetchStatus:'success',fetchedAt:'2026-09-01T00:00:00Z',transactions:[]}],
  }],
}]}),frameMerged=mergeCreditSyncResult(frameBase,{syncedAt:'2026-09-02T00:00:00Z',profiles:[{
  profileId:'frame-lkg',provider:'visaCal',coreComplete:true,accounts:[{
    accountNumber:'4444',balance:null,cardFrame:null,frameStatus:'missing',frameFetchStatus:'unavailable',frameErrorCode:'CREDIT_FRAMES_UNAVAILABLE',frameErrorAt:'2026-09-02T00:00:00Z',
    months:[{month:'2026-09',tier:'core',fetchStatus:'success',fetchedAt:'2026-09-02T00:00:00Z',transactions:[]}],
  }],
}],errors:[{profileId:'frame-lkg',provider:'visaCal',component:'frames',severity:'warning',code:'CREDIT_FRAMES_UNAVAILABLE',stage:'Frames',at:'2026-09-02T00:00:00Z'}]});
const frameLkg=frameMerged.profiles[0].accounts[0];
assert.equal(frameLkg.cardFrame,9000,'Frames warning preserves the previous issuer frame as Last Known Good');assert.equal(frameLkg.balance,-220);assert.equal(frameLkg.frameStatus,'stale','preserved frame data is explicitly stale rather than fresh');assert.equal(frameMerged.syncedAt,'2026-09-02T00:00:00.000Z','successful Core transactions still advance the profile clock when Frames is unavailable');assert.equal(frameMerged.errors[0].severity,'warning');
assert.equal(creditSyncHeadlineState({status:{lastErrors:[]},busy:false,error:''},{sync:frameMerged}).title,'הושלם עם אזהרות','successful Core plus a Frames warning is never rendered as a failed profile');
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

assert.equal(homeInstallmentsData(businessOnlyBankState).reduce((sum,row)=>sum+row.amount,0),250,'home cash-flow selector isolates home-classified credit');
assert.equal(nextHomeCreditCycleData(businessOnlyBankState,'2026-09-01').rows.every(r=>r.account==='ביתי'),true,'the home next-cycle calculation contains only home cards');
const splitAccountState={...structuredClone(businessOnlyBankState),expenses:[
  {id:'biz-exp',description:'שכירות עסק',account:'עסקי',date:'2999-09-12',amount:40,recurring:true,active:true},
  {id:'home-exp',description:'משכנתא',account:'ביתי',date:'2999-09-13',amount:60,recurring:true,active:true},
],bank:{...structuredClone(businessOnlyBankState.bank),homeFeed:{version:4,provider:'hapoalim',accountNumber:'home',balance:2000,syncedAt:'2999-09-01T08:00:00.000Z',transactions:[]}}};
const businessCycle=bankNextCycleCommitmentsData(splitAccountState),homeCycle=bankHomeNextCycleCommitmentsData(splitAccountState),splitLong=bankLongTermPositionData(splitAccountState);
assert.equal(businessCycle.nextCreditTotal,100);assert.equal(businessCycle.targetExpenseTotal,40,'business cycle includes only business expenses');
assert.equal(homeCycle.nextCreditTotal,250);assert.equal(homeCycle.targetExpenseTotal,60,'home cycle includes only home expenses');
assert.equal(bankProjectedThisMonthData(splitAccountState),860,'business projected checking subtracts only its own credit clearing and expenses');
assert.equal(bankHomeProjectedThisMonthData(splitAccountState),1690,'home projected checking subtracts only home credit clearing and home expenses');
const ordersBusinessCashflow=kupaAccountCashflowData(splitAccountState,'עסקי'),ordersHomeCashflow=kupaAccountCashflowData(splitAccountState,'ביתי');
assert.equal(ordersBusinessCashflow.total,businessCycle.total,'Orders uses the exact same business next-cycle commitment total as Kupa');
assert.equal(ordersBusinessCashflow.projected,bankProjectedThisMonthData(splitAccountState),'Orders business projected checking is numerically identical to Kupa');
assert.equal(ordersHomeCashflow.total,homeCycle.total,'Orders uses the exact same home next-cycle commitment total as Kupa');
assert.equal(ordersHomeCashflow.projected,bankHomeProjectedThisMonthData(splitAccountState),'Orders home projected checking is numerically identical to Kupa');
assert.equal(splitLong.expenses,40,'dashboard business position excludes the home mortgage from business expenses');
assert.equal(splitLong.net,860,'dashboard business net cannot be reduced by a home expense or home card');
const noBusinessBalance={...structuredClone(splitAccountState),bank:{...structuredClone(splitAccountState.bank),currentBalance:null,updatedAt:null,asOfDate:null,source:null,feed:null}};
assert.equal(bankNextCycleCommitmentsData(noBusinessBalance).targetExpenseTotal,40,'expense commitments remain visible even when the business bank balance is not synchronized');
assert.equal(bankNextCycleCommitmentsData(noBusinessBalance).nextCreditTotal,100,'credit commitments remain visible even when the business bank balance is not synchronized');
assert.equal(bankProjectedThisMonthData(noBusinessBalance),null,'only the projected bank result becomes unavailable when the balance itself is unavailable');

const currentDay=todayISO(),shiftDay=(iso,days)=>{const d=dObj(iso);d.setDate(d.getDate()+days);return localISO(d)},snapshotStart=shiftDay(currentDay,-2),elapsedDay=shiftDay(currentDay,-1),futureDay=addMonthsISO(currentDay,1);
const staleSnapshotState={version:4,checks:[],cash:[],cards:[],bank:{currentBalance:1000,asOfDate:snapshotStart,adjustments:[]},creditSync:{version:3,profiles:[],errors:[],cardMappings:{}},credits:[
 {id:'elapsed-credit',description:'עבר מאז הצילום',account:'עסקי',card:'ישן',firstChargeDate:elapsedDay,totalAmount:100,installments:1,active:true},
 {id:'future-credit',description:'מחזור הבא',account:'עסקי',card:'עתידי',firstChargeDate:futureDay,totalAmount:200,installments:1,active:true},
],expenses:[
 {id:'elapsed-expense',description:'הוצאה מאז הצילום',account:'עסקי',date:elapsedDay,amount:30,recurring:false,active:true},
 {id:'future-expense',description:'הוצאה למחזור הבא',account:'עסקי',date:futureDay,amount:40,recurring:false,active:true},
]};
const staleKupaCycle=bankNextCycleCommitmentsData(staleSnapshotState),staleOrders=kupaAccountCashflowData(staleSnapshotState,'עסקי');
assert.equal(staleKupaCycle.elapsedCredit,100);assert.equal(staleKupaCycle.elapsedExpenses,30,'Kupa includes obligations elapsed since a stale bank snapshot');
assert.equal(staleOrders.elapsedCredit,staleKupaCycle.elapsedCredit);assert.equal(staleOrders.elapsedExpenses,staleKupaCycle.elapsedExpenses,'Orders preserves the stale-snapshot correction instead of using a simplified current-month formula');
assert.equal(staleOrders.total,staleKupaCycle.total);assert.equal(staleOrders.projected,bankProjectedThisMonthData(staleSnapshotState));

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
  {id:'future',processedDate:'2026-10-01',chargedAmount:-30,chargedCurrency:'ILS',description:'עתידית'},
  {id:'recent',processedDate:'2026-08-15',chargedAmount:-40,chargedCurrency:'ILS',description:'אוגוסט'},
  {id:'edge',processedDate:'2026-06-15',chargedAmount:-20,chargedCurrency:'ILS',description:'יוני'},
  {id:'old',processedDate:'2026-05-01',chargedAmount:-50,chargedCurrency:'ILS',description:'ישן מדי'},
]}]}],cardMappings:{[historyKey]:{included:true,hidden:false,account:'עסקי'}}})};
const monthlyHistory=creditMonthlyDetailData(historyState,'2026-09-01');
assert.equal(CREDIT_DETAIL_HISTORY_MONTHS,3);
assert.deepEqual(monthlyHistory.months.map(x=>x.key),['2026-06','2026-08','2026-10'],'monthly detail keeps three prior calendar months plus every actually known future billing month');
assert.deepEqual(monthlyHistory.months.map(x=>x.total),[20,40,30]);
assert.equal(monthlyHistory.months.some(x=>x.items.some(item=>item.description==='ישן מדי')),false,'older history remains outside the compact monthly transaction browser');

const multiMonthKey=creditCardMappingKey('multi-month','5555');
const multiMonthState={credits:[],creditSync:normalizeCreditSync({version:3,profiles:[{profileId:'multi-month',provider:'max',accounts:[{accountNumber:'5555',txns:[
  {id:'plan_1',type:'installments',date:'2026-08-20',processedDate:'2026-09-10',chargedAmount:-100,chargedCurrency:'ILS',originalAmount:-300,originalCurrency:'ILS',description:'פריסה',installments:{number:1,total:3}},
  {id:'plan_2',type:'installments',date:'2026-09-20',processedDate:'2026-10-10',chargedAmount:-100,chargedCurrency:'ILS',originalAmount:-300,originalCurrency:'ILS',description:'פריסה',installments:{number:2,total:3}},
  {id:'plan_3',type:'installments',date:'2026-10-20',processedDate:'2026-11-10',chargedAmount:-100,chargedCurrency:'ILS',originalAmount:-300,originalCurrency:'ILS',description:'פריסה',installments:{number:3,total:3}},
]}]}],cardMappings:{[multiMonthKey]:{included:true,hidden:false,account:'עסקי'}}})};
const multiMonthDetails=creditMonthlyDetailData(multiMonthState,'2026-09-01');
assert.deepEqual(multiMonthDetails.months.map(x=>x.key),['2026-09','2026-10','2026-11'],'a synchronized installment series is visible in every future billing month actually supplied by the issuer, not only its next payment');
assert.deepEqual(multiMonthDetails.months.map(x=>x.items[0].part),[1,2,3]);

const detailSortKey=creditCardMappingKey('detail-sort','7777');
const detailSortState={credits:[],creditSync:normalizeCreditSync({version:3,profiles:[{profileId:'detail-sort',provider:'max',ownerLabel:'יעקב',accounts:[{accountNumber:'7777',txns:[
  {id:'older-purchase',date:'2026-08-03',transactionDate:'2026-08-03',processedDate:'2026-09-10',chargedAmount:-30,chargedCurrency:'ILS',description:'עסקה ישנה'},
  {id:'newer-purchase',date:'2026-08-28',transactionDate:'2026-08-28',processedDate:'2026-09-05',chargedAmount:-40,chargedCurrency:'ILS',description:'עסקה חדשה'},
]}]}],cardMappings:{[detailSortKey]:{included:true,hidden:false,account:'עסקי'}}})};
const detailSortMonth=creditMonthlyDetailData(detailSortState,'2026-09-01').months.find(month=>month.key==='2026-09');
assert.deepEqual(detailSortMonth.items.map(item=>item.description),['עסקה חדשה','עסקה ישנה'],'Kupa transaction/payment detail is sorted by purchase date newest-first, independent of card or billing-date order');

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
assert.equal(migratedState.creditSync.version,4);
assert.equal(migratedState.credits.length,0,'v2 -> v3 migration removes the historical manual dataset exactly once as requested');
migratedState.credits.push({id:'new-manual',active:true,firstChargeDate:'2026-09-10',totalAmount:100,installments:1,card:'חדש',account:'עסקי'});
const normalizedAgain=stateNormalization.normalizeState(migratedState);
assert.equal(normalizedAgain.credits[0].id,'new-manual','manual additions created after v3 migration survive future normalization/saves');
const v3ManualPreserved=stateNormalization.normalizeState({version:4,creditSync:{version:3,profiles:[],cardMappings:{}},credits:[{id:'v3-manual',active:true,firstChargeDate:'2026-09-10',totalAmount:42,installments:1,card:'חדש',account:'עסקי'}]});
assert.equal(v3ManualPreserved.credits[0].id,'v3-manual','the v4 monthly-LKG upgrade never repeats the destructive v2-to-v3 migration');

const bridgeApi=createDomainsBankBridge();
for(const method of ['creditStatus','saveCreditProfile','deleteCreditProfile','resetCreditProfiles','creditDiagnostics','syncCreditCards']){
  assert.equal(typeof bridgeApi[method],'function',`browser bridge exposes ${method} as a callable local API method`);
}

const controllerStorage=new Map();
globalThis.localStorage={getItem:key=>controllerStorage.has(key)?controllerStorage.get(key):'',setItem:(key,value)=>controllerStorage.set(key,String(value)),removeItem:key=>controllerStorage.delete(key)};
const controllerModel={state:{creditSync:normalizeCreditSync({})}};
const creditController=createDomainsCreditController({
  model:controllerModel,
  saveState:async()=>{},toast:()=>{},render:()=>{},
  bridge:{creditStatus:async()=>({bridgeVersion:30,contractVersion:2,profiles:[]})},
  modal:()=>{},armModalDraftGuard:()=>{},closeModal:()=>{},confirmDialog:async()=>true,
});
for(const method of ['creditSyncUiState','refreshCreditBridgeStatus','copySafeCreditDiagnostics','openCreditConnectionModal','deleteCreditConnection','resetCreditSync','refreshCreditSync','setCreditCardMapping','setCreditAutoRefresh','maybeAutoRefreshCreditSync']){
  assert.equal(typeof creditController[method],'function',`credit controller exposes ${method}`);
}
assert.equal('setCreditSyncMode' in creditController,false,'credit controller no longer exposes a manual/synchronized source switch');
await creditController.refreshCreditBridgeStatus();
creditController.setCreditAutoRefresh(false);

const deferredToasts=[],deferredModel={state:{creditSync:normalizeCreditSync({version:4,syncedAt:'2026-09-01T00:00:00Z',profiles:[{profileId:'deferred-profile',provider:'amex',attemptedAt:'2026-09-01T00:00:00Z',accounts:[]}]})}},deferredController=createDomainsCreditController({
  model:deferredModel,saveState:async()=>{},saveFinancePatch:async()=>({saved:false}),toast:message=>deferredToasts.push(message),render:()=>{},
  bridge:{creditStatus:async()=>({bridgeVersion:30,contractVersion:2,profiles:[{profileId:'deferred-profile'}],lastErrors:[{profileId:'deferred-profile',provider:'amex',severity:'deferred',deferred:true,code:'CREDIT_AUTOMATION_BLOCKED',at:'2026-09-01T00:00:00Z',originalFailureAt:'2026-09-01T00:00:00Z',retryAfterAt:'2026-09-04T00:00:00Z'}],lastAttemptedCount:0,lastDeferredCount:1}),syncCreditCards:async()=>({attemptedCount:0,deferredCount:1,profiles:[],errors:[]})},
  modal:()=>{},armModalDraftGuard:()=>{},closeModal:()=>{},confirmDialog:async()=>true,
});
const beforeDeferredAttempt=deferredModel.state.creditSync.profiles[0].attemptedAt;await deferredController.refreshCreditSync({interactive:true,auto:false});
assert.equal(deferredModel.state.creditSync.profiles[0].attemptedAt,beforeDeferredAttempt,'interactive diagnostic refresh cannot stamp attemptedAt when the profile is deferred before any issuer request');assert(deferredToasts.some(message=>message.includes('לא נשלחה בקשה חדשה')));

let resetBridgeCalls=0,resetSaveCalls=0;
const resetModel={state:{credits:[{id:'manual-kept'}],creditSync:normalizeCreditSync({version:3,profiles:[{profileId:'old',provider:'max',accounts:[{accountNumber:'1234',txns:[{id:'old-tx',processedDate:'2026-09-01T00:00:00.000Z',chargedAmount:-10,chargedCurrency:'ILS'}]}]}]})}};
const resetController=createDomainsCreditController({
  model:resetModel,
  saveState:async()=>{resetSaveCalls++},toast:()=>{},render:()=>{},
  bridge:{creditStatus:async()=>({bridgeVersion:30,contractVersion:2,profiles:[{profileId:'old'}]}),resetCreditProfiles:async()=>{resetBridgeCalls++;return {ok:true,profiles:[]}}},
  modal:()=>{},armModalDraftGuard:()=>{},closeModal:()=>{},confirmDialog:async()=>true,
});
await resetController.resetCreditSync();
assert.equal(resetBridgeCalls,1,'full credit reset deletes the local encrypted issuer profiles through the bridge');
assert.equal(resetSaveCalls,1,'full credit reset persists the cleared synchronized feed through the ordinary Kupa save path');
assert.equal(resetModel.state.creditSync.mode,'synced','full reset keeps the canonical synchronized-source model');
assert.equal(resetModel.state.creditSync.profiles.length,0,'full reset removes synchronized cloud profiles/card data');
assert.equal(resetModel.state.credits[0].id,'manual-kept','full reset preserves post-migration manual additions');
resetController.setCreditAutoRefresh(false);

console.log('PASS credit sync models: v3 synced-primary model, one-time manual cleanup, additive manual rows, hidden cards, owner/account classification, safe diagnostics and partial merge are deterministic');
