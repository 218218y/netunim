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
  creditSyncScrapeSelection,
  creditKnownFutureCommitment,
  creditPendingAuthorizationAmount,
  creditUpcomingCharge,
  creditFrameStatus,
  creditSyncSummary,
  mergeCreditSyncResult,
  normalizeCreditSync,
  syncedInstallmentsData,
  syncedPendingTransactionsData,
  syncedPendingForecastData,
  syncedForeignCurrencyTransactionsData,
  creditTransactionIsForeignCurrency,
  syncedCreditSeries,
} from '../netunim-kupa/site/assets/js/domains/credit/sync-feed.js';
import {creditSyncHeadlineState} from '../netunim-kupa/site/assets/js/domains/credit/view.js';
import {parseVisaCalMonthData} from '../netunim-kupa/bank-bridge/credit-adapters.mjs';
import {allInstallmentsData,businessInstallmentsData,homeInstallmentsData,creditForecastInstallmentsData,nextCreditCycleData,nextBusinessCreditCycleData,nextHomeCreditCycleData,creditMonthlyDetailData,CREDIT_DETAIL_HISTORY_MONTHS} from '../netunim-kupa/site/assets/js/domains/credit/model.js';
import {createDomainsBankBridge} from '../netunim-kupa/site/assets/js/domains/bank/bridge.js';
import {bankLongTermPositionData,bankNextCycleCommitmentsData,bankHomeNextCycleCommitmentsData,bankProjectedThisMonthData,bankHomeProjectedThisMonthData} from '../netunim-kupa/site/assets/js/domains/bank/model.js';
import {createDomainsCreditController} from '../netunim-kupa/site/assets/js/domains/credit/controller.js';
import {createStateNormalization} from '../netunim-kupa/site/assets/js/state/normalization.js';
import {kupaAccountCashflowData} from '../netunim-orders/site/assets/js/domains/bank/readout.js';
import {creditRows as ordersCreditRows} from '../netunim-orders/site/assets/js/domains/finance/reporting.js';
import {todayISO,localISO,dObj,addMonthsISO} from '../netunim-kupa/site/assets/js/core/dates.js';

assert.equal(CREDIT_SYNC_VERSION,4,'credit feed v4 adds monthly Last Known Good coverage without changing the synced-primary/additive-manual calculation model');
const scrapeSelectionFeed=normalizeCreditSync({version:4,profiles:[{profileId:'selection',provider:'visaCal',accounts:[{accountNumber:'1111'},{accountNumber:'2222'}]}],cardMappings:{'selection:1111':{included:false,hidden:true},'selection:2222':{included:true,hidden:true}}});
assert.deepEqual(creditSyncScrapeSelection(scrapeSelectionFeed),[{profileId:'selection',excludedAccounts:['1111']}],'scrape selection excludes only known not-included cards; hidden included cards still synchronize because they affect totals');
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
    {identifier:'deal-1',type:'installments',date:'2026-08-20T00:00:00.000Z',transactionDate:'2026-08-18T00:00:00.000Z',transactionTime:'14:27',processedDate:'2026-09-10T00:00:00.000Z',originalAmount:-300,originalCurrency:'ILS',chargedAmount:-100,chargedCurrency:'ILS',description:'ספק',category:'ריהוט',installments:{number:1,total:3},status:'completed'},
    {identifier:'refund-1',date:'2026-08-22T00:00:00.000Z',processedDate:'2026-09-10T00:00:00.000Z',originalAmount:50,originalCurrency:'ILS',chargedAmount:50,chargedCurrency:'ILS',description:'זיכוי',status:'completed'},
  ],
});
assert.equal(normalizedAccount.accountNumber,'4321');
assert.equal(normalizedAccount.cardFrame,15000);
assert.equal(normalizedAccount.availableCredit,null,'an issuer credit limit is not mislabeled as available credit without provider proof');
assert.equal(normalizedAccount.txns[0].installments.total,3);
assert.equal(normalizedAccount.txns[0].chargedAmount,-100);
assert.equal(normalizedAccount.txns[0].transactionDate,'2026-08-18T00:00:00.000Z','optional issuer purchase date survives the safe bridge normalization independently of billing date');
assert.equal(normalizedAccount.txns[0].transactionTime,'14:27','an explicit issuer purchase clock survives bridge normalization as a separate local clock value');
assert.equal(normalizedAccount.txns[0].category,'ריהוט','issuer category survives the safe bridge normalization instead of being silently discarded');
const maxFrame=normalizeCreditScrapeAccount({accountNumber:'9999',balance:-1250.75,cardFrame:15000},'max');
assert.equal(maxFrame.availableCredit,13749.25,'MAX OpenToBuy is recovered exactly from the scraper-defined balance and credit limit');
const isracardFrame=normalizeCreditScrapeAccount({accountNumber:'8742',balance:-10847.5,cardFrame:23500},'isracard');
assert.equal(isracardFrame.availableCredit,12652.5,'israeli-bank-scrapers 6.10.0 Isracard balance + cardFrame becomes exact issuer available credit');
const amexFrame=normalizeCreditScrapeAccount({accountNumber:'7392',balance:-9564.99,cardFrame:15500},'amex');
assert.equal(amexFrame.availableCredit,5935.01,'Amex uses the same v6.10.0 utilized-credit semantics without subtracting synchronized commitments twice');
const missingNumbers=normalizeCreditScrapeAccount({accountNumber:'0000',balance:null,cardFrame:null,availableCredit:null});
assert.equal(missingNumbers.balance,null);assert.equal(missingNumbers.cardFrame,null);assert.equal(missingNumbers.availableCredit,null);


const availabilitySync=normalizeCreditSync({version:3,profiles:[{profileId:'availability',provider:'isracard',accounts:[{accountNumber:'5555',pendingFetchedAt:'2026-09-02T08:00:00Z',balanceDate:'2026-09-10',txns:[
  {id:'past',processedDate:'2026-08-10',chargedAmount:-90,chargedCurrency:'ILS',status:'completed'},
  {id:'next-a',processedDate:'2026-09-10',chargedAmount:-250,chargedCurrency:'ILS',category:'קניות',status:'completed'},
  {id:'next-refund',processedDate:'2026-09-10',chargedAmount:50,chargedCurrency:'ILS',status:'completed'},
  {id:'later',processedDate:'2026-10-10',chargedAmount:-450,chargedCurrency:'ILS',status:'completed'},
  {id:'pending-with-purchase-placeholder',date:'2026-09-02',processedDate:'2026-09-02',transactionDate:'2026-09-02',chargedAmount:-100,chargedCurrency:'ILS',description:'אישור טרי',status:'pending'},
  {id:'foreign',processedDate:'2026-09-12',chargedAmount:-80,chargedCurrency:'USD',status:'completed'},
]}]}],cardMappings:{'availability:5555':{included:true,manualFrame:5000,cardName:'ישראכרט בדיקה'}}});
const availabilityAccount=availabilitySync.profiles[0].accounts[0];
assert.equal(availabilityAccount.txns.find(tx=>tx.id==='next-a')?.category,'קניות','Kupa credit feed preserves issuer category through local/cloud normalization');
assert.equal(availabilityAccount.pendingTransactions[0].id,'pending-with-purchase-placeholder','legacy flat feeds classify explicit pending status as pending even when processedDate is populated');
assert.equal(creditKnownFutureCommitment(availabilityAccount,'2026-09-02'),650,'completed future commitment stays separate from pending issuer authorizations and foreign currency');
assert.equal(creditPendingAuthorizationAmount(availabilityAccount,'2026-09-02'),100,'pending ILS authorization amount is tracked separately for calculated-frame fallback');
assert.deepEqual(creditUpcomingCharge(availabilityAccount,'isracard','2026-09-02'),{amount:300,date:'2026-09-10',source:'transactions',pendingAmount:100,estimated:true,status:'estimated',incompleteCount:0,missingAmountCount:0,coverageGapCount:0,stalePendingCount:0,unconvertedCount:0,unknownAmountCount:0,amountKnown:true,complete:true},'the upcoming Isracard cycle combines finalized charges with fresh pending ILS authorizations');
const manualFrameStatus=creditFrameStatus(availabilityAccount,{manualFrame:5000},'2026-09-02');
assert.deepEqual(manualFrameStatus,{frame:5000,available:4250,commitments:650,pendingAuthorizations:100,source:'manual_frame_calculated',frameSource:'manual'},'manual frame fallback subtracts completed future commitments plus live pending ILS authorizations');
const issuerFrameStatus=creditFrameStatus({...availabilityAccount,cardFrame:6000},{manualFrame:5000},'2026-09-02');
assert.equal(issuerFrameStatus.available,5250);assert.equal(issuerFrameStatus.pendingAuthorizations,100);assert.equal(issuerFrameStatus.source,'issuer_frame_calculated');assert.equal(issuerFrameStatus.frame,6000,'issuer frame always overrides a stored manual fallback while pending authorizations still reserve calculated availability');
const directAvailableStatus=creditFrameStatus({...availabilityAccount,cardFrame:6000,availableCredit:4321},{manualFrame:9000},'2026-09-02');
assert.equal(directAvailableStatus.available,4321);assert.equal(directAvailableStatus.pendingAuthorizations,100);assert.equal(directAvailableStatus.source,'issuer_available','issuer-provided available credit is authoritative and is never reduced a second time for the pending approvals it already includes');
assert.deepEqual(creditUpcomingCharge({balance:-321,balanceDate:'2026-09-10',txns:[]},'visaCal','2026-09-02'),{amount:321,date:'2026-09-10',source:'issuer_balance',pendingAmount:0,estimated:false},'Cal balance is allowed only as a documented next-debit fallback');
assert.equal(creditUpcomingCharge({balance:-1250,txns:[]},'max','2026-09-02'),null,'MAX balance represents utilized credit and is never mislabeled as an upcoming debit');
const pendingReviewRows=syncedPendingTransactionsData({creditSync:availabilitySync},'2026-09-02');
assert.equal(pendingReviewRows.length,1);assert.equal(pendingReviewRows[0].description,'אישור טרי');assert.equal(pendingReviewRows[0].amount,100);assert.equal(pendingReviewRows[0].card,'ישראכרט בדיקה','pending approvals are immediately available to the credit-page transaction selector');
assert.equal(pendingReviewRows[0].date,'2026-09-10');assert.equal(pendingReviewRows[0].chargeDateSource,'issuer_next_charge','pending approval uses the issuer next-cycle date rather than its purchase date when projecting the credit-page month');
const pendingForecastRows=syncedPendingForecastData({creditSync:availabilitySync},'2026-09-02');
assert.equal(pendingForecastRows.length,1);assert.equal(pendingForecastRows[0].amount,100);assert.equal(pendingForecastRows[0].status,'pending','fresh ILS approvals participate provisionally in the credit-page forecast without becoming finalized Kupa obligations');
const availabilityDetail=creditMonthlyDetailData({credits:[],creditSync:availabilitySync},'2026-09-02').months.find(month=>month.key==='2026-09');
assert.equal(availabilityDetail.total,300,'credit-page September total provisionally includes 200 finalized ILS plus the 100 pending approval');
assert.equal(availabilityDetail.items.some(item=>item.source==='credit_pending'&&item.status==='pending'&&item.description==='אישור טרי'),true,'pending approval is a first-class row inside the ordinary transactions/payments month');
const currentMonthCarrySync=normalizeCreditSync({version:4,profiles:[{profileId:'month-carry',provider:'max',accounts:[{accountNumber:'6767',pendingFetchedAt:'2026-09-09T08:00:00Z',balanceDate:'2026-09-10',pendingStatus:'success',txns:[{id:'sep-already-dated',processedDate:'2026-09-05',chargedAmount:-1000,chargedCurrency:'ILS',description:'חיוב ספטמבר מוקדם',status:'completed'}],pendingTransactions:[{id:'sep-pending',date:'2026-09-09',processedDate:'2026-09-09',chargedAmount:-125,chargedCurrency:'ILS',description:'ממתינה ספטמבר',status:'pending'}]}]}],cardMappings:{'month-carry:6767':{included:true,hidden:false,account:'עסקי'}}});
const currentMonthCarryState={credits:[],creditSync:currentMonthCarrySync},currentMonthForecast=creditForecastInstallmentsData(currentMonthCarryState,'2026-09-10'),currentMonthForecastTotal=currentMonthForecast.filter(row=>String(row.date).startsWith('2026-09')).reduce((sum,row)=>sum+row.amount,0),currentMonthDetailTotal=creditMonthlyDetailData(currentMonthCarryState,'2026-09-10').months.find(month=>month.key==='2026-09').total;
assert.equal(currentMonthForecastTotal,125,'Kupa forecast contains only unposted cycles from the exact as-of day while retaining fresh pending approvals');
assert.equal(currentMonthDetailTotal,1125,'the billing-month transaction browser retains the complete September history independently of the forward forecast');
assert.equal(creditForecastInstallmentsData(currentMonthCarryState,'2026-09-10').some(row=>row.date==='2026-09-05'),false,'an elapsed cycle is not reintroduced merely because it shares the current calendar month');
const zeroBilledPendingSync=normalizeCreditSync({version:4,profiles:[{profileId:'pending-zero-billed',provider:'max',accounts:[{accountNumber:'4545',pendingFetchedAt:'2026-09-03T08:00:00Z',balanceDate:'2026-09-10',pendingStatus:'success',pendingTransactions:[{id:'auth-zero-billed',status:'pending',transactionDate:'2026-09-03',processedDate:'2026-09-03',chargedAmount:0,chargedCurrency:'ILS',originalAmount:-237.4,originalCurrency:'ILS',description:'אישור עם חיוב זמני אפס'}]}]}],cardMappings:{'pending-zero-billed:4545':{included:true,hidden:false}}});
const zeroBilledPendingDetail=creditMonthlyDetailData({credits:[],creditSync:zeroBilledPendingSync},'2026-09-03').months.find(month=>month.key==='2026-09').items[0];
assert.equal(zeroBilledPendingDetail.amount,237.4,'a fresh ILS pending authorization falls back to its known original amount when the provisional charged amount is zero');
assert.equal(zeroBilledPendingDetail.transactionAmount,237.4,'Kupa transaction amount preserves the issuer original authorization amount when provisional chargedAmount is zero, matching Orders semantics');
assert.equal(syncedInstallmentsData({creditSync:availabilitySync}).some(row=>row.status==='pending'),false,'pending approvals remain excluded from finalized Kupa cash-flow obligations until the issuer settles them');
const stalePendingSync=normalizeCreditSync({version:4,profiles:[{profileId:'stale-pending',provider:'max',accounts:[{accountNumber:'4444',balanceDate:'2026-09-10',pendingStatus:'provider_error',pendingTransactions:[{id:'stale-auth',status:'pending',transactionDate:'2026-09-03',processedDate:'2026-09-03',chargedAmount:-70,chargedCurrency:'ILS',description:'אישור ישן'}]}]}],cardMappings:{'stale-pending:4444':{included:true,hidden:false}}});
assert.equal(syncedPendingTransactionsData({creditSync:stalePendingSync},'2026-09-03').length,1,'Last Known Good pending approval stays visible when the issuer pending endpoint temporarily fails');
assert.equal(syncedPendingForecastData({creditSync:stalePendingSync},'2026-09-03').length,0,'stale pending data cannot reserve a monthly ILS forecast as if it were fresh');
assert.equal(creditMonthlyDetailData({credits:[],creditSync:stalePendingSync},'2026-09-03').months.find(month=>month.key==='2026-09').total,0,'stale pending row remains visible but contributes zero to the month total');
const settlementAckId='credit_settlement_unmatched:עסקי:2026-09-10:max:sync:settle-business:1010';
const ackSync=normalizeCreditSync({version:4,settlementWarningAcks:{[settlementAckId]:'2026-09-12T09:15:00Z',invalid:'not-a-date'}});
assert.deepEqual(Object.keys(ackSync.settlementWarningAcks),[settlementAckId],'settlement-warning acknowledgement is durable finance-sync state while malformed acknowledgements fail closed');
assert.equal(mergeCreditSyncResult(ackSync,{profiles:[],errors:[]}).settlementWarningAcks[settlementAckId],'2026-09-12T09:15:00.000Z','issuer refresh preserves user acknowledgement instead of resurfacing an already-reviewed unmatched-settlement warning');

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
const structuredFailure=normalizeCreditSync({errors:[{profileId:'p-amex',provider:'amex',browserEngine:'camoufox',code:'CREDIT_AUTOMATION_BLOCKED',stage:'LoginPage',httpStatus:403,message:'חסימה',at:'2026-08-30T10:00:00.000Z'}]}).errors[0];
assert.equal(structuredFailure.stage,'LoginPage','credit diagnostics preserve the safe failure stage');
assert.equal(structuredFailure.httpStatus,403,'credit diagnostics preserve the issuer HTTP status without retaining response HTML');
assert.equal(structuredFailure.browserEngine,'camoufox','credit diagnostics preserve the safe browser-engine provenance used by engine-scoped cooldowns');
assert.equal(merged.mode,'synced','v3 has one canonical synchronized source marker; manual mode no longer exists as a calculation switch');
assert.equal(creditSyncHasData({creditSync:merged}),true);
assert.equal(merged.cardMappings[keyA]?.included,true,'v1 discovered cards migrate as included so an upgrade never silently removes existing forecast amounts');
assert.equal(merged.cardMappings[keyB]?.included,true);
assert.equal(merged.cardMappings[keyA]?.hidden,false,'existing cards migrate as visible unless explicitly hidden');

const allFailed=mergeCreditSyncResult(merged,{profiles:[],errors:[{profileId:'p-max-a',provider:'max',code:'CREDIT_TIMEOUT',message:'כשל'}]});
assert.equal(allFailed.syncedAt,merged.syncedAt,'all-failed refresh preserves last successful sync timestamp');
assert.equal(allFailed.profiles.length,2,'all-failed refresh preserves every last successful profile slice');
const monthlyBase=normalizeCreditSync({version:4,contractVersion:2,syncedAt:'2026-09-01T00:00:00Z',profiles:[{profileId:'monthly',provider:'visaCal',syncedAt:'2026-09-01T00:00:00Z',accounts:[{accountNumber:'1111',months:[{month:'2026-11',tier:'forecast',status:'fresh',fetchStatus:'success',fetchedAt:'2026-09-01T00:00:00Z',providerSchemaVersion:'cal-v2',transactions:[{id:'lkg',processedDate:'2026-11-10',chargedAmount:-90,status:'completed'}]}]}]}],cardMappings:{'monthly:1111':{included:true,hidden:false,account:'עסקי'}}});
const monthlyMerged=mergeCreditSyncResult(monthlyBase,{contractVersion:2,syncedAt:'2026-09-02T00:00:00Z',profiles:[{profileId:'monthly',provider:'visaCal',coreComplete:true,accounts:[{accountNumber:'1111',months:[{month:'2026-11',tier:'forecast',fetchStatus:'provider_error',lastErrorCode:'CREDIT_PROVIDER_DATA_ERROR',lastErrorAt:'2026-09-02T00:00:00Z',transactions:[]},{month:'2026-12',tier:'forecast',fetchStatus:'schema_error',lastErrorCode:'CREDIT_PROVIDER_SCHEMA_ERROR',lastErrorAt:'2026-09-02T00:00:00Z',transactions:[]}]}]}],errors:[]});
const monthlyAccount=monthlyMerged.profiles[0].accounts[0],staleNovember=monthlyAccount.months.find(month=>month.month==='2026-11'),missingDecember=monthlyAccount.months.find(month=>month.month==='2026-12');
const dailyOmittedForecast=mergeCreditSyncResult(monthlyBase,{contractVersion:2,syncedAt:'2026-09-03T00:00:00Z',profiles:[{profileId:'monthly',provider:'visaCal',coreComplete:true,accounts:[{accountNumber:'1111',months:[{month:'2026-09',tier:'core',fetchStatus:'success',fetchedAt:'2026-09-03T00:00:00Z',transactions:[]},{month:'2026-10',tier:'core',fetchStatus:'success',fetchedAt:'2026-09-03T00:00:00Z',transactions:[]}]}]}],errors:[]});
const preservedForecast=dailyOmittedForecast.profiles[0].accounts[0].months.find(month=>month.month==='2026-11');
assert.equal(preservedForecast.transactions[0].id,'lkg','daily current+next payload cannot delete a farther future month that was previously fetched successfully');assert.equal(preservedForecast.status,'fresh','an untouched Last Known Good month keeps its prior freshness marker rather than being fabricated or erased');assert.equal(syncedInstallmentsData({creditSync:dailyOmittedForecast}).some(row=>row.date==='2026-11-10'&&row.amount===90),true,'the preserved farther-future LKG row remains visible to the actual Kupa installments consumer after a daily refresh');
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
assert.equal(businessCycle.nextCreditTotal,100);assert.equal(businessCycle.targetExpenseTotal,0,'a business expense after the exact next-cycle horizon is not pulled into cash-flow');
assert.equal(homeCycle.nextCreditTotal,250);assert.equal(homeCycle.targetExpenseTotal,0,'a home expense after the exact next-cycle horizon is not pulled into cash-flow');
assert.equal(bankProjectedThisMonthData(splitAccountState),900,'business projected checking stops at the exact business credit-cycle horizon');
assert.equal(bankHomeProjectedThisMonthData(splitAccountState),1750,'home projected checking stops at the exact home credit-cycle horizon');
const ordersBusinessCashflow=kupaAccountCashflowData(splitAccountState,'עסקי'),ordersHomeCashflow=kupaAccountCashflowData(splitAccountState,'ביתי');
assert.equal(ordersBusinessCashflow.total,businessCycle.total,'Orders uses the exact same business next-cycle commitment total as Kupa');
assert.equal(ordersBusinessCashflow.projected,bankProjectedThisMonthData(splitAccountState),'Orders business projected checking is numerically identical to Kupa');
assert.equal(ordersHomeCashflow.total,homeCycle.total,'Orders uses the exact same home next-cycle commitment total as Kupa');
assert.equal(ordersHomeCashflow.projected,bankHomeProjectedThisMonthData(splitAccountState),'Orders home projected checking is numerically identical to Kupa');
const checkCashflowState={...structuredClone(splitAccountState),cashflowSettings:{businessMinimum:null,homeMinimum:null,businessCheckCutoffDay:14,homeCheckCutoffDay:9},checks:[
  {id:'biz-in',account:'עסקי',status:'בקופה',dueDate:'2999-09-14',amount:100},
  {id:'biz-out',account:'עסקי',status:'בקופה',dueDate:'2999-09-15',amount:200},
  {id:'biz-deposited',account:'עסקי',status:'הופקד - במעקב',dueDate:'2999-09-12',amount:500},
  {id:'home-in',account:'ביתי',status:'בקופה',dueDate:'2999-09-09',amount:300},
  {id:'home-out',account:'ביתי',status:'בקופה',dueDate:'2999-09-10',amount:400},
]};
const businessCheckCashflow=bankNextCycleCommitmentsData(checkCashflowState,'2999-09-01'),homeCheckCashflow=bankHomeNextCycleCommitmentsData(checkCashflowState,'2999-09-01');
assert.equal(businessCheckCashflow.checkCutoffDay,14);assert.equal(businessCheckCashflow.checkCutoffDate,'2999-09-10');assert.deepEqual(businessCheckCashflow.checkRows.map(row=>row.id),[],'the exact cycle horizon caps a later configured business-check cutoff');assert.equal(businessCheckCashflow.checks,0);assert.equal(businessCheckCashflow.expectedChange,-100,'business expected bank change contains only obligations through the horizon');assert.equal(bankProjectedThisMonthData(checkCashflowState,'2999-09-01'),900,'business projected checking excludes deposits after the horizon');
assert.equal(homeCheckCashflow.checkCutoffDay,9);assert.equal(homeCheckCashflow.checkCutoffDate,'2999-09-09');assert.deepEqual(homeCheckCashflow.checkRows.map(row=>row.id),['home-in'],'a check on or before both the configured cutoff and exact horizon remains included');assert.equal(homeCheckCashflow.checks,300);assert.equal(homeCheckCashflow.expectedChange,50,'home expected bank change nets the qualifying deposit against the next credit cycle');assert.equal(bankHomeProjectedThisMonthData(checkCashflowState,'2999-09-01'),2050,'home projected checking adds qualifying home checks without leaking later expenses');
const overdueHeldCheckState={...structuredClone(checkCashflowState),checks:[{id:'biz-overdue',account:'עסקי',status:'בקופה',dueDate:'2999-08-31',amount:25}]};
assert.equal(bankNextCycleCommitmentsData(overdueHeldCheckState,'2999-09-01').checks,25,'a still-held overdue business check remains a real expected deposit before the upcoming cutoff instead of disappearing because its due date already passed');
const customCutoffState={...structuredClone(checkCashflowState),cashflowSettings:{businessMinimum:null,homeMinimum:null,businessCheckCutoffDay:13,homeCheckCutoffDay:8}};
assert.equal(bankNextCycleCommitmentsData(customCutoffState,'2999-09-01').checks,0,'changing the business cutoff immediately changes the projected check inflow');assert.equal(bankHomeNextCycleCommitmentsData(customCutoffState,'2999-09-01').checks,0,'changing the home cutoff is independent');
const userReportedCutoffState={version:4,cashflowSettings:{businessMinimum:null,homeMinimum:null,businessCheckCutoffDay:14,homeCheckCutoffDay:14},checks:[
  {id:'biz-12-sep',account:'עסקי',status:'בקופה',dueDate:'2026-09-12',amount:4000},
  {id:'home-12-sep',account:'ביתי',status:'בקופה',dueDate:'2026-09-12',amount:4000},
],credits:[],creditSync:{version:4,profiles:[],errors:[],cardMappings:{}},expenses:[],bank:{currentBalance:1000,asOfDate:'2026-09-08',adjustments:[],homeFeed:{version:4,provider:'hapoalim',balance:1000,syncedAt:'2026-09-08T02:00:00.000Z',transactions:[]}}};
const userReportedBusinessCashflow=bankNextCycleCommitmentsData(userReportedCutoffState,'2026-09-08'),userReportedHomeCashflow=bankHomeNextCycleCommitmentsData(userReportedCutoffState,'2026-09-08');
assert.equal(userReportedBusinessCashflow.checkCutoffDay,14);assert.equal(userReportedBusinessCashflow.checkCutoffDate,'2026-09-14');assert.deepEqual(userReportedBusinessCashflow.checkRows.map(row=>row.id),['biz-12-sep']);assert.equal(userReportedBusinessCashflow.checks,4000,'a held business check due on 12 September is included when the configured cutoff is day 14');assert.equal(userReportedBusinessCashflow.expectedChange,4000,'business expected bank change exposes the qualifying check deposit to the Bank expected-expenses readout');assert.equal(bankProjectedThisMonthData(userReportedCutoffState,'2026-09-08'),5000,'business projected checking adds the qualifying 4000 check');
assert.equal(userReportedHomeCashflow.checkCutoffDay,14);assert.equal(userReportedHomeCashflow.checkCutoffDate,'2026-09-14');assert.deepEqual(userReportedHomeCashflow.checkRows.map(row=>row.id),['home-12-sep']);assert.equal(userReportedHomeCashflow.checks,4000,'a held home check due on 12 September is included when the configured cutoff is day 14');assert.equal(userReportedHomeCashflow.expectedChange,4000,'home expected bank change exposes the qualifying check deposit to the Bank expected-expenses readout');assert.equal(bankHomeProjectedThisMonthData(userReportedCutoffState,'2026-09-08'),5000,'home projected checking adds the qualifying 4000 check');
assert.equal(kupaAccountCashflowData(userReportedCutoffState,'עסקי','2026-09-08').projected,5000,'Orders and Kupa share the business day-14 check cash-flow contract');assert.equal(kupaAccountCashflowData(userReportedCutoffState,'ביתי','2026-09-08').projected,5000,'Orders and Kupa share the home day-14 check cash-flow contract');
const ordersBusinessChecks=kupaAccountCashflowData(checkCashflowState,'עסקי','2999-09-01'),ordersHomeChecks=kupaAccountCashflowData(checkCashflowState,'ביתי','2999-09-01');
assert.equal(ordersBusinessChecks.projected,bankProjectedThisMonthData(checkCashflowState,'2999-09-01'),'Orders and Kupa share the exact business check cash-flow formula');assert.equal(ordersHomeChecks.projected,bankHomeProjectedThisMonthData(checkCashflowState,'2999-09-01'),'Orders and Kupa share the exact home check cash-flow formula');

assert.equal(splitLong.expenses,40,'dashboard business position excludes the home mortgage from business expenses');
assert.equal(splitLong.net,860,'dashboard business net cannot be reduced by a home expense or home card');
const noBusinessBalance={...structuredClone(splitAccountState),bank:{...structuredClone(splitAccountState.bank),currentBalance:null,updatedAt:null,asOfDate:null,source:null,feed:null}};
assert.equal(bankNextCycleCommitmentsData(noBusinessBalance,'2999-09-01').targetExpenseTotal,0,'expenses after the exact cycle horizon stay outside the projection even when the bank balance is unavailable');
assert.equal(bankNextCycleCommitmentsData(noBusinessBalance,'2999-09-01').nextCreditTotal,100,'credit commitments remain visible even when the business bank balance is not synchronized');
assert.equal(bankProjectedThisMonthData(noBusinessBalance,'2999-09-01'),null,'only the projected bank result becomes unavailable when the balance itself is unavailable');

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

const billingReference=todayISO(),billingDate=shiftDay(billingReference,7),purchaseDate=addMonthsISO(billingReference,-1),billingMonthStart=`${billingReference.slice(0,7)}-01T00:00:00.000Z`;
const billingRows=parseVisaCalMonthData({statusCode:1,result:{bankAccounts:[{debitDates:[{transactions:[{trnIntId:'cal-current-cycle-regression',trnTypeCode:'5',trnPurchaseDate:`${purchaseDate}T00:00:00.000Z`,debCrdDate:`${billingDate}T00:00:00.000Z`,trnAmt:19305.96,amtBeforeConvAndIndex:19305.96,trnCurrencySymbol:'₪',debCrdCurrencySymbol:'₪',merchantName:'חיוב שנקנה בחודש קודם'}]}],immidiateDebits:{debitDays:[]}}]}},{startDate:new Date(billingMonthStart)});
assert.equal(billingRows.length,1,'the fast-source regression row survives the current-cycle billing boundary before it reaches cash-flow');
const originalTimezone=process.env.TZ;
try{
  process.env.TZ='Asia/Jerusalem';
  const localMidnightBillingRows=parseVisaCalMonthData({statusCode:1,result:{bankAccounts:[{debitDates:[{transactions:[{trnIntId:'cal-local-midnight',trnTypeCode:'5',trnPurchaseDate:'2026-08-31T00:00:00',debCrdDate:'2026-09-10T00:00:00',trnAmt:321.45,amtBeforeConvAndIndex:321.45,trnCurrencySymbol:'₪',debCrdCurrencySymbol:'₪',merchantName:'חצות מקומי'}]}],immidiateDebits:{debitDays:[]}}]}},{startDate:new Date('2026-09-01T00:00:00.000Z')});
  assert.equal(localMidnightBillingRows[0]?.processedDate?.slice(0,10),'2026-09-10','Cal offset-less billing midnight keeps the issuer calendar day even on an Israel-time workstation');
  const localMidnightDueDayCashflow=kupaAccountCashflowData({creditSync:normalizeCreditSync({version:4,profiles:[{profileId:'cal-local',provider:'visaCal',accounts:[{accountNumber:'1010',txns:localMidnightBillingRows}]}],cardMappings:{'cal-local:1010':{included:true,hidden:false,account:'עסקי'}}}),credits:[],checks:[],cash:[],cards:[],expenses:[],cashflowSettings:{businessMinimum:0},bank:{currentBalance:10000,asOfDate:'2026-09-10',source:'hapoalim',feed:{syncedAt:'2026-09-10T08:00:00.000Z',balance:10000,transactions:[]},adjustments:[]}},'עסקי','2026-09-10');
  assert.equal(localMidnightDueDayCashflow.credit,321.45,'the exact Cal due-day row remains an active checking obligation on the 10th before the bank posts it');assert.equal(localMidnightDueDayCashflow.projected,9678.55);
}finally{if(originalTimezone===undefined)delete process.env.TZ;else process.env.TZ=originalTimezone}
const billingCashflowState={version:4,checks:[],cash:[],cards:[],credits:[],bank:{currentBalance:10000,asOfDate:billingReference,adjustments:[]},cashflowSettings:{businessMinimum:0,homeMinimum:null},expenses:[{id:'fixed-2150',description:'הוצאות קבועות',account:'עסקי',date:billingDate,amount:2150,recurring:true,active:true}],creditSync:normalizeCreditSync({version:4,profiles:[{profileId:'cal-current-cycle',provider:'visaCal',accounts:[{accountNumber:'9715',txns:billingRows}]}],cardMappings:{'cal-current-cycle:9715':{included:true,hidden:false,account:'עסקי'}}})};
const billingKupaCycle=bankNextCycleCommitmentsData(billingCashflowState),billingOrdersCycle=kupaAccountCashflowData(billingCashflowState,'עסקי',billingReference);
assert.equal(billingKupaCycle.credit,19305.96,'Kupa future checking includes the issuer monthly credit debit after a fast refresh');
assert.equal(billingKupaCycle.expenses,2150,'Kupa keeps fixed expenses alongside the monthly credit debit');
assert.equal(bankProjectedThisMonthData(billingCashflowState),-11455.96,'Kupa projected checking subtracts both credit and fixed expenses');
assert.equal(billingOrdersCycle.credit,19305.96,'Orders future checking reads the same synchronized monthly credit debit');
assert.equal(billingOrdersCycle.projected,-11455.96);assert.equal(billingOrdersCycle.alert.active,true);assert.equal(billingOrdersCycle.alert.reason,'negative','the existing cash-flow alert fires once the missing current-cycle credit is restored');

const persistedBillingCashflowState=JSON.parse(JSON.stringify(billingCashflowState));
assert.equal(persistedBillingCashflowState.creditSync.profiles[0].accounts[0].txns,undefined,'finance persistence intentionally omits the derived txns cache');
assert.equal(persistedBillingCashflowState.creditSync.profiles[0].accounts[0].months[0].transactions.length,1,'the durable finance document keeps the monthly transaction slice');
const persistedKupaCycle=bankNextCycleCommitmentsData(persistedBillingCashflowState,billingReference),persistedOrdersCycle=kupaAccountCashflowData(persistedBillingCashflowState,'עסקי',billingReference);
assert.equal(persistedKupaCycle.credit,19305.96,'Kupa cash-flow reconstructs credit directly from durable monthly slices after a cloud round-trip');
assert.equal(persistedOrdersCycle.credit,persistedKupaCycle.credit,'Orders uses the same shared monthly-slice cash-flow source as Kupa after persistence');
assert.equal(persistedOrdersCycle.projected,-11455.96);assert.equal(persistedOrdersCycle.alert.reason,'negative','Orders cannot lose synchronized credit merely because the derived txns cache was not serialized');

const settlementCreditSync=normalizeCreditSync({version:4,profiles:[
  {profileId:'settle-business',provider:'max',label:'MAX עסקי',defaultAccount:'עסקי',accounts:[{accountNumber:'1010',txns:[
    {id:'business-sep',processedDate:'2026-09-10T00:00:00.000Z',chargedAmount:-1000,chargedCurrency:'ILS',status:'completed',description:'מחזור ספטמבר'},
    {id:'business-oct',processedDate:'2026-10-10T00:00:00.000Z',chargedAmount:-1200,chargedCurrency:'ILS',status:'completed',description:'מחזור אוקטובר'},
  ]}]},
  {profileId:'settle-home',provider:'amex',label:'AMEX ביתי',defaultAccount:'ביתי',accounts:[{accountNumber:'1515',txns:[
    {id:'home-sep',processedDate:'2026-09-15T00:00:00.000Z',chargedAmount:-500,chargedCurrency:'ILS',status:'completed',description:'מחזור ספטמבר'},
    {id:'home-oct',processedDate:'2026-10-15T00:00:00.000Z',chargedAmount:-600,chargedCurrency:'ILS',status:'completed',description:'מחזור אוקטובר'},
  ]}]},
],cardMappings:{
  'settle-business:1010':{included:true,hidden:false,account:'עסקי',cardName:'MAX עסקי'},
  'settle-home:1515':{included:true,hidden:false,account:'ביתי',cardName:'AMEX ביתי'},
}});
const settlementBeforePosting={version:4,checks:[],cash:[],cards:[],credits:[],expenses:[],cashflowSettings:{businessMinimum:0,homeMinimum:0},creditSync:settlementCreditSync,bank:{
  currentBalance:10000,asOfDate:'2026-09-11',source:'hapoalim',adjustments:[],
  feed:{syncedAt:'2026-09-11T08:00:00.000Z',balance:10000,transactions:[{id:'same-amount-not-credit',date:'2026-09-11T00:00:00.000Z',processedDate:'2026-09-11T00:00:00.000Z',amount:-1000,status:'completed',description:'שכירות'}]},
  homeFeed:{syncedAt:'2026-09-16T08:00:00.000Z',balance:5000,transactions:[{id:'home-pending-card',date:'2026-09-16T00:00:00.000Z',processedDate:'2026-09-16T00:00:00.000Z',amount:-500,status:'pending',description:'American Express'}]},
}};
const businessAwaitingBank=kupaAccountCashflowData(settlementBeforePosting,'עסקי','2026-09-11');
assert.equal(businessAwaitingBank.settlingCredit,1000,'a due-on-10 credit cycle stays in cash-flow after the bank snapshot date advances but before the card debit is posted');
assert.equal(businessAwaitingBank.nextCreditTotal,1200,'the following monthly cycle remains a separate future obligation while the prior debit is awaiting bank posting');
assert.equal(businessAwaitingBank.credit,2200);assert.equal(businessAwaitingBank.projected,7800,'cash-flow subtracts both the unsettled due debit and the next cycle instead of temporarily overstating checking');
const homeAwaitingBank=kupaAccountCashflowData(settlementBeforePosting,'ביתי','2026-09-16');
assert.equal(homeAwaitingBank.settlingCredit,500,'a due-on-15 home-card cycle is isolated to the home account and remains pending until a completed home-bank debit appears');
assert.equal(homeAwaitingBank.nextCreditTotal,600);assert.equal(homeAwaitingBank.projected,3900,'a pending bank row is not treated as proof that the home balance already contains the debit');
const settlementAfterPosting=JSON.parse(JSON.stringify(settlementBeforePosting));
settlementAfterPosting.bank.currentBalance=9000;settlementAfterPosting.bank.feed.balance=9000;settlementAfterPosting.bank.feed.transactions=[{id:'max-posted',date:'2026-09-11T00:00:00.000Z',processedDate:'2026-09-11T00:00:00.000Z',amount:-1000,status:'completed',description:'MAX'}];
settlementAfterPosting.bank.homeFeed.balance=4500;settlementAfterPosting.bank.homeFeed.transactions=[{id:'amex-posted',date:'2026-09-16T00:00:00.000Z',processedDate:'2026-09-16T00:00:00.000Z',amount:-500,status:'completed',description:'American Express'}];
const businessPosted=kupaAccountCashflowData(settlementAfterPosting,'עסקי','2026-09-11'),homePosted=kupaAccountCashflowData(settlementAfterPosting,'ביתי','2026-09-16');
assert.equal(businessPosted.settlingCredit,0);assert.equal(businessPosted.credit,1200);assert.equal(businessPosted.projected,businessAwaitingBank.projected,'once the MAX debit appears, the lower bank balance replaces the temporary settlement hold with no projected-balance jump');
assert.equal(homePosted.settlingCredit,0);assert.equal(homePosted.credit,600);assert.equal(homePosted.projected,homeAwaitingBank.projected,'home cash-flow has the same no-double-count continuity when the AMEX debit reaches the bank feed');

const settlementDifferentAmount=JSON.parse(JSON.stringify(settlementBeforePosting));
settlementDifferentAmount.bank.currentBalance=8992;settlementDifferentAmount.bank.feed.balance=8992;settlementDifferentAmount.bank.feed.transactions=[{id:'max-posted-different',date:'2026-09-11T00:00:00.000Z',amount:-1008,status:'completed',description:'MAX חיוב כרטיס'}];
const differentAmountCycle=kupaAccountCashflowData(settlementDifferentAmount,'עסקי','2026-09-11');
assert.equal(differentAmountCycle.settlingCredit,0,'an explicit MAX bank debit settles the single due card even when the actual bank amount differs from the issuer-derived cycle estimate');
assert.equal(differentAmountCycle.projected,7792,'after a mismatched actual debit posts, projected checking uses the actual lower bank balance plus only future obligations instead of double-counting the old estimate');

const genericDifferentAmount=JSON.parse(JSON.stringify(settlementDifferentAmount));genericDifferentAmount.bank.feed.transactions[0].description='חיוב כרטיס אשראי';
const genericDifferentCycle=kupaAccountCashflowData(genericDifferentAmount,'עסקי','2026-09-11');
assert.equal(genericDifferentCycle.settlingCredit,1000,'a generic credit-card label with a different amount is not strong enough to guess which issuer cycle posted');

const settlementHardCap=JSON.parse(JSON.stringify(settlementBeforePosting));
settlementHardCap.bank.asOfDate='2026-09-12';settlementHardCap.bank.feed.syncedAt='2026-09-12T08:00:00.000Z';
const businessHardCap=kupaAccountCashflowData(settlementHardCap,'עסקי','2026-09-12');
assert.equal(businessHardCap.settlingCredit,0,'an unmatched due-on-10 cycle is never held past the hard two-day reconciliation window');
assert.equal(businessHardCap.expiredSettlementCredit,1000,'the released estimate remains observable as an unmatched-settlement diagnostic instead of disappearing silently');
assert.equal(businessHardCap.expiredSettlementWarnings.length,1);assert.equal(businessHardCap.expiredSettlementWarnings[0].dueDate,'2026-09-10');assert.equal(businessHardCap.expiredSettlementWarnings[0].releaseDate,'2026-09-12');
assert.equal(businessHardCap.credit,1200);assert.equal(businessHardCap.projected,8800,'from the 12th onward the old estimated debit is removed from checking cash-flow even without a bank match, preventing month-over-month accumulation');
const homeHardCap=JSON.parse(JSON.stringify(settlementBeforePosting));homeHardCap.bank.homeFeed.syncedAt='2026-09-17T08:00:00.000Z';
const homeHardCapCycle=kupaAccountCashflowData(homeHardCap,'ביתי','2026-09-17');
assert.equal(homeHardCapCycle.settlingCredit,0);assert.equal(homeHardCapCycle.expiredSettlementCredit,500);assert.equal(homeHardCapCycle.expiredSettlementWarnings[0].releaseDate,'2026-09-17','a due-on-15 home cycle follows the same 15→17 hard cap independently of the business account');
const lateMatchedAfterCap=JSON.parse(JSON.stringify(settlementHardCap));lateMatchedAfterCap.bank.currentBalance=8992;lateMatchedAfterCap.bank.feed.balance=8992;lateMatchedAfterCap.bank.feed.syncedAt='2026-09-13T08:00:00.000Z';lateMatchedAfterCap.bank.feed.transactions=[{id:'late-max-posted',date:'2026-09-13',amount:-1008,status:'completed',description:'מקס איט פיננסי'}];
const lateMatchedCycle=kupaAccountCashflowData(lateMatchedAfterCap,'עסקי','2026-09-13');
assert.equal(lateMatchedCycle.expiredSettlementWarnings.length,1,'a bank debit dated outside the settlement window cannot close an expired cycle');

for(const [provider,bankLabel] of [['visaCal','כרטיסי אשראי ל'],['max','מקס איט פיננסי'],['isracard','ישראכרט בע"מ'],['amex','אמריקן אקספרס']]){
  const profileId=`provider-label-${provider}`,mappingKey=`${profileId}:9090`,providerSync=normalizeCreditSync({version:4,profiles:[{profileId,provider,defaultAccount:'עסקי',accounts:[{accountNumber:'9090',txns:[{id:`${provider}-sep`,processedDate:'2026-09-10',chargedAmount:-1000,chargedCurrency:'ILS',status:'completed',description:'מחזור ספטמבר'},{id:`${provider}-oct`,processedDate:'2026-10-10',chargedAmount:-1200,chargedCurrency:'ILS',status:'completed',description:'מחזור אוקטובר'}]}]}],cardMappings:{[mappingKey]:{included:true,hidden:false,account:'עסקי'}}});
  const providerState={version:4,checks:[],cash:[],cards:[],credits:[],expenses:[],cashflowSettings:{businessMinimum:0},creditSync:providerSync,bank:{currentBalance:8992,asOfDate:'2026-09-11',source:'hapoalim',adjustments:[],feed:{syncedAt:'2026-09-11T08:00:00.000Z',balance:8992,transactions:[{id:`${provider}-posted`,date:'2026-09-11',amount:-1008,status:'completed',description:'חיוב מוסדי',partyName:bankLabel,bankReference:'institution-reference'}]}}};
  assert.equal(kupaAccountCashflowData(providerState,'עסקי','2026-09-11').settlingCredit,0,`${provider}: the bank institution name alone settles a posted debit with a different amount; last-4 digits are optional evidence, not a requirement`);
}

const splitMappings={'split:1111':{included:true,hidden:false,account:'עסקי',cardName:'MAX 1111'},'split:2222':{included:true,hidden:false,account:'עסקי',cardName:'MAX 2222'}};
const splitCreditSync=normalizeCreditSync({version:4,profiles:[{profileId:'split',provider:'max',defaultAccount:'עסקי',accounts:[
  {accountNumber:'1111',txns:[{id:'a-sep',processedDate:'2026-09-10',chargedAmount:-1000,chargedCurrency:'ILS',status:'completed',description:'A'},{id:'a-oct',processedDate:'2026-10-10',chargedAmount:-1100,chargedCurrency:'ILS',status:'completed',description:'A next'}]},
  {accountNumber:'2222',txns:[{id:'b-sep',processedDate:'2026-09-10',chargedAmount:-2000,chargedCurrency:'ILS',status:'completed',description:'B'},{id:'b-oct',processedDate:'2026-10-10',chargedAmount:-2100,chargedCurrency:'ILS',status:'completed',description:'B next'}]},
]}],cardMappings:splitMappings});
const splitBase={version:4,checks:[],cash:[],cards:[],credits:[],expenses:[],cashflowSettings:{businessMinimum:0},creditSync:splitCreditSync,bank:{currentBalance:10000,asOfDate:'2026-09-11',source:'hapoalim',adjustments:[],feed:{syncedAt:'2026-09-11T08:00:00.000Z',balance:10000,transactions:[]}}};
const splitPartial=JSON.parse(JSON.stringify(splitBase));splitPartial.bank.currentBalance=8992;splitPartial.bank.feed.balance=8992;splitPartial.bank.feed.transactions=[{id:'max-one-card',date:'2026-09-11',amount:-1008,status:'completed',description:'MAX'}];
const splitPartialCycle=kupaAccountCashflowData(splitPartial,'עסקי','2026-09-11');
assert.equal(splitPartialCycle.settlingCredit,3000,'a closest amount is not proof of which card settled');
const splitPosted=JSON.parse(JSON.stringify(splitBase));splitPosted.bank.currentBalance=7007;splitPosted.bank.feed.balance=7007;splitPosted.bank.feed.transactions=[{id:'max-card-a',date:'2026-09-11',amount:-1008,status:'completed',description:'MAX'},{id:'max-card-b',date:'2026-09-11',amount:-1985,status:'completed',description:'MAX'}];
const splitPostedCycle=kupaAccountCashflowData(splitPosted,'עסקי','2026-09-11');
assert.equal(splitPostedCycle.settlingCredit,3000,'the number of bank rows alone cannot prove one debit per card');
assert.equal(splitPostedCycle.projected,807,'ambiguous old estimates stay reserved within the reconciliation window');
const aggregatePosted=JSON.parse(JSON.stringify(splitBase));aggregatePosted.bank.currentBalance=7007;aggregatePosted.bank.feed.balance=7007;aggregatePosted.bank.feed.transactions=[{id:'max-aggregate',date:'2026-09-11',amount:-2993,status:'completed',description:'MAX'}];
assert.equal(kupaAccountCashflowData(aggregatePosted,'עסקי','2026-09-11').settlingCredit,3000,'an approximate aggregate is not proof of settlement');

const dayNinePending=normalizeCreditSync({version:4,profiles:[{profileId:'pending-cutoff',provider:'max',accounts:[{accountNumber:'9090',pendingStatus:'success',pendingTransactions:[{id:'sep-9-pending',status:'pending',date:'2026-09-09T20:00:00.000Z',transactionDate:'2026-09-09T20:00:00.000Z',transactionTime:'23:00',chargedAmount:-250,chargedCurrency:'ILS',description:'עסקה מ-9 שטרם שובצה'}]}]}],cardMappings:{'pending-cutoff:9090':{included:true,hidden:false,account:'עסקי'}}});
assert.equal(syncedInstallmentsData({creditSync:dayNinePending}).length,0,'a transaction made on the 9th that the issuer still marks pending is not forced into the current monthly debit before the issuer assigns its final billing date');
assert.equal(syncedPendingTransactionsData({creditSync:dayNinePending},'2026-09-10')[0].transactionTime,'23:00','pending issuer transaction time remains available for the transaction browser without changing billing-cycle classification');
assert.equal(ordersCreditRows({creditSync:dayNinePending},'2026-09-10')[0].transactionTime,'23:00','Orders preserves the same issuer-supplied transaction clock as Kupa');
const manualSnapshotAfterDue=JSON.parse(JSON.stringify(settlementBeforePosting));manualSnapshotAfterDue.bank.source='manual';
const manualCycle=kupaAccountCashflowData(manualSnapshotAfterDue,'עסקי','2026-09-11');
assert.equal(manualCycle.settlingCredit,0,'a manual bank snapshot remains authoritative and does not reuse an old synchronized feed as settlement evidence');

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
const foreignDisplay=syncedForeignCurrencyTransactionsData({creditSync:foreign});
assert.equal(foreignDisplay.length,1);assert.equal(foreignDisplay[0].amount,100);assert.equal(foreignDisplay[0].currency,'USD','true foreign-billed transactions remain visible with their issuer currency instead of being discarded');
const foreignDetail=creditMonthlyDetailData({credits:[],creditSync:foreign},'2026-09-01').months.find(month=>month.key==='2026-09');
assert.equal(foreignDetail.total,0);assert.equal(foreignDetail.items[0].source,'credit_foreign');assert.equal(foreignDetail.items[0].foreignCurrency,true,'foreign-billed detail row is shown but cannot alter an ILS month total without an issuer conversion');
const convertedFx=normalizeCreditSync({version:3,profiles:[{profileId:'fx-ils',provider:'max',accounts:[{accountNumber:'8888',txns:[{id:'usd-ils',processedDate:'2026-09-10',chargedAmount:-250,chargedCurrency:'ILS',originalAmount:-10000,originalCurrency:'JPY',description:'מטח שחויב בשקלים'}]}]}],cardMappings:{[creditCardMappingKey('fx-ils','8888')]:{included:true,hidden:false}}});
assert.equal(creditTransactionIsForeignCurrency(convertedFx.profiles[0].accounts[0].txns[0]),true,'original foreign currency is preserved as an FX fact even after the issuer supplies an ILS billing amount');
const convertedFxSeries=syncedCreditSeries({creditSync:convertedFx},'2026-09-01')[0];
assert.equal(convertedFxSeries.foreignCurrency,true,'ILS-billed foreign purchase stays in ordinary ILS totals and receives the FX marker');
assert.equal(convertedFxSeries.totalAmount,250,'a foreign original amount can never be mislabeled as an ILS series total after conversion');
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
  bridge:{creditStatus:async()=>({bridgeVersion:43,contractVersion:2,profiles:[]})},
  modal:()=>{},armModalDraftGuard:()=>{},closeModal:()=>{},confirmDialog:async()=>true,
});
for(const method of ['creditSyncUiState','refreshCreditBridgeStatus','copySafeCreditDiagnostics','openCreditConnectionModal','deleteCreditConnection','resetCreditSync','refreshCreditSync','setCreditCardMapping','setCreditAutoRefresh','setCreditAutoMode','maybeAutoRefreshCreditSync']){
  assert.equal(typeof creditController[method],'function',`credit controller exposes ${method}`);
}
assert.equal('setCreditSyncMode' in creditController,false,'credit controller no longer exposes a manual/synchronized source switch');
await creditController.refreshCreditBridgeStatus();
creditController.setCreditAutoMode('full');assert.equal(creditController.creditSyncUiState().autoMode,'full','Kupa stores the selected automatic credit horizon independently of the on/off toggle');creditController.setCreditAutoRefresh(false);

let automaticSyncOptions=null;const automaticModel={state:{creditSync:normalizeCreditSync({})}},automaticController=createDomainsCreditController({model:automaticModel,saveState:async()=>{},saveFinancePatch:async()=>({saved:true}),toast:()=>{},render:()=>{},bridge:{creditStatus:async()=>({bridgeVersion:43,contractVersion:2,profiles:[{profileId:'auto-profile'}]}),syncCreditCards:async options=>{automaticSyncOptions=structuredClone(options);return {syncedAt:new Date().toISOString(),attemptedCount:1,deferredCount:0,profiles:[{profileId:'auto-profile',provider:'max',coreComplete:true,accounts:[]}],errors:[]}}},modal:()=>{},armModalDraftGuard:()=>{},closeModal:()=>{},confirmDialog:async()=>true,refreshFinanceCloudSnapshot:async()=>({verified:true,state:{creditSync:normalizeCreditSync({})}}),claimFinanceSyncLease:async()=>({acquired:true}),releaseFinanceSyncLease:async()=>true});automaticController.setCreditAutoMode('full');assert.equal(await automaticController.refreshCreditSync({auto:true}),undefined);assert.equal(automaticSyncOptions.syncMode,'full','Kupa once-per-day automatic refresh sends the user-selected full horizon instead of hard-coding daily');automaticController.setCreditAutoRefresh(false);

const deferredToasts=[],deferredModel={state:{creditSync:normalizeCreditSync({version:4,syncedAt:'2026-09-01T00:00:00Z',profiles:[{profileId:'deferred-profile',provider:'amex',attemptedAt:'2026-09-01T00:00:00Z',accounts:[]}]})}},deferredController=createDomainsCreditController({
  model:deferredModel,saveState:async()=>{},saveFinancePatch:async()=>({saved:false}),toast:message=>deferredToasts.push(message),render:()=>{},
  bridge:{creditStatus:async()=>({bridgeVersion:43,contractVersion:2,profiles:[{profileId:'deferred-profile'}],lastErrors:[{profileId:'deferred-profile',provider:'amex',severity:'deferred',deferred:true,code:'CREDIT_AUTOMATION_BLOCKED',at:'2026-09-01T00:00:00Z',originalFailureAt:'2026-09-01T00:00:00Z',retryAfterAt:'2026-09-04T00:00:00Z'}],lastAttemptedCount:0,lastDeferredCount:1}),syncCreditCards:async()=>({attemptedCount:0,deferredCount:1,profiles:[],errors:[]})},
  modal:()=>{},armModalDraftGuard:()=>{},closeModal:()=>{},confirmDialog:async()=>true,
});
const beforeDeferredAttempt=deferredModel.state.creditSync.profiles[0].attemptedAt;await deferredController.refreshCreditSync({interactive:true,auto:false});
assert.equal(deferredModel.state.creditSync.profiles[0].attemptedAt,beforeDeferredAttempt,'interactive diagnostic refresh cannot stamp attemptedAt when the profile is deferred before any issuer request');assert(deferredToasts.some(message=>message.includes('לא נשלחה בקשה חדשה')));

let resetBridgeCalls=0,resetSaveCalls=0;
const resetModel={state:{credits:[{id:'manual-kept'}],creditSync:normalizeCreditSync({version:3,profiles:[{profileId:'old',provider:'max',accounts:[{accountNumber:'1234',txns:[{id:'old-tx',processedDate:'2026-09-01T00:00:00.000Z',chargedAmount:-10,chargedCurrency:'ILS'}]}]}]})}};
const resetController=createDomainsCreditController({
  model:resetModel,
  saveState:async()=>{resetSaveCalls++},toast:()=>{},render:()=>{},
  bridge:{creditStatus:async()=>({bridgeVersion:43,contractVersion:2,profiles:[{profileId:'old'}]}),resetCreditProfiles:async()=>{resetBridgeCalls++;return {ok:true,profiles:[]}}},
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
