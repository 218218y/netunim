import assert from 'node:assert/strict';
import {bankAutoRefreshDue,BANK_AUTO_INTERVAL_MS} from '../netunim-kupa/site/assets/js/domains/bank/bridge.js';
import {createDomainsBankController} from '../netunim-kupa/site/assets/js/domains/bank/controller.js';
import {normalizeBankFeed,BANK_FEED_TRANSACTION_LIMIT} from '../netunim-kupa/site/assets/js/domains/bank/feed.js';
import {
  buildCreditMonths,
  classifyCamoufoxProviderResponse,
  camoufoxLaunchOptions,
  isCamoufoxRetryableNativeFailure,
  normalizeIsracardFamilyTransaction,
  parseIsracardDate,
} from '../netunim-kupa/bank-bridge/isracard-camoufox.mjs';
import {
  HAPOALIM_POST_LOGIN_TIMEOUT_MS,
  HAPOALIM_NAVIGATION_STABLE_MS,
  HAPOALIM_DATA_RETRY_LIMIT,
  HAPOALIM_TRANSACTION_LOOKBACK_DAYS,
  HAPOALIM_TRANSACTION_LIMIT,
  buildHapoalimAdditionalDetailsUrl,
  isHapoalimChequeTransaction,
  normalizeHapoalimAdditionalDetails,
  INTERACTIVE_AUTH_TIMEOUT_MS,
  isTransientNavigationError,
  SILENT_AUTH_TIMEOUT_MS,
  normalizeAccountNumber,
  parseAccountSelector,
  retryTransientNavigation,
  publicAccountDescriptors,
  normalizeHapoalimTransaction,
  normalizeRecentTransactions,
  selectAccountDescriptor,
  selectBalanceAccount,
  scraperFailureMessage,
  waitForTerminalLoginResult,
  ymdDate,
} from '../netunim-kupa/bank-bridge/lib.mjs';

const amexInstallment=normalizeIsracardFamilyTransaction({dealSumType:'0',voucherNumberRatz:'123456',voucherNumberRatzOutbound:'777777',dealSumOutbound:'0',fullPurchaseDate:'12/06/2026',fullPaymentDate:'02/07/2026',dealSum:'100.50',paymentSum:'100.50',currencyId:'ש"ח',fullSupplierNameHeb:'  חנות בדיקה  ',moreInfo:'תשלום 2 מתוך 3'},null);
assert.equal(parseIsracardDate('31/08/2026'),'2026-08-31T00:00:00.000Z','Camoufox adapter parses issuer DD/MM/YYYY dates deterministically');
assert.equal(amexInstallment.originalAmount,-100.5,'Camoufox adapter explicitly coerces Amex string amount fields instead of relying on JS/Python truthiness quirks');
assert.equal(amexInstallment.date,'2026-07-12T00:00:00.000Z','Camoufox adapter preserves upstream installment date-fixing semantics');
assert.equal(amexInstallment.transactionDate,'2026-06-12T00:00:00.000Z','Camoufox keeps the exact issuer purchase date separately from the installment/billing timeline');
assert.equal(amexInstallment.originalCurrency,'ILS','Camoufox adapter normalizes NIS/shekel issuer currency to ILS');
const endOfMonthInstallment=normalizeIsracardFamilyTransaction({dealSumType:'0',voucherNumberRatz:'654321',voucherNumberRatzOutbound:'000000001',dealSumOutbound:'0',fullPurchaseDate:'31/01/2026',fullPaymentDate:'15/02/2026',dealSum:'50',paymentSum:'50',currencyId:'ש"ח',fullSupplierNameHeb:'בדיקת סוף חודש',moreInfo:'תשלום 2 מתוך 2'},null);
assert.equal(endOfMonthInstallment.date,'2026-02-28T00:00:00.000Z','installment month shifting clamps to the target month end, matching moment.add semantics instead of overflowing into March');
const loginHtml=classifyCamoufoxProviderResponse({stage:'ValidateIdData',status:200,text:'<!DOCTYPE html><html><body>challenge</body></html>'});
assert.equal(loginHtml.code,'CREDIT_LOGIN_HTML_RESPONSE','Camoufox login HTML keeps the canonical safe credit error code used by Kupa');
assert.equal(loginHtml.message.includes('<html'),false,'Camoufox safe errors never retain raw provider HTML');
assert.equal(classifyCamoufoxProviderResponse({stage:'CardsTransactionsList 2026-08',status:200,text:'<html>maintenance</html>'}).code,'CREDIT_DATA_HTML_RESPONSE','post-login HTML is distinguished from login failure');
assert.equal(classifyCamoufoxProviderResponse({stage:'ValidateIdData',status:403,text:'Access denied'}).code,'CREDIT_AUTOMATION_BLOCKED','403/WAF responses use the canonical automation-blocked code');
assert.equal(classifyCamoufoxProviderResponse({stage:'LoginPage',status:429,text:'Too Many Requests'}).code,'CREDIT_PROVIDER_RATE_LIMITED','429 is classified as provider rate limiting instead of being misdiagnosed as a fingerprint/WAF block');
const camoufoxOptions=camoufoxLaunchOptions({interactive:false,enableCache:true});
assert.equal(camoufoxOptions.os,'windows','Camoufox constrains its own BrowserForge generator to Windows instead of rewriting a generated fingerprint');
assert.deepEqual(camoufoxOptions.screen,{minWidth:1280,maxWidth:1920,minHeight:720,maxHeight:1200},'Camoufox receives bounded screen constraints through its supported launch API');
assert.equal(camoufoxOptions.fingerprint,undefined,'Bank Bridge does not inject or sanitize a custom fingerprint; Camoufox owns fingerprint generation and mapping');
assert.equal(camoufoxOptions.enable_cache,true,'qualified issuer sessions may reuse the browser cache setting without changing fingerprint ownership');
assert.deepEqual(buildCreditMonths(new Date('2026-05-03T00:00:00Z'),2,new Date('2026-08-31T00:00:00Z')).map(x=>x.toISOString().slice(0,7)),['2026-05','2026-06','2026-07','2026-08','2026-09','2026-10'],'Camoufox adapter requests every billing month from the lookback through the configured future horizon');
assert.equal(isCamoufoxRetryableNativeFailure({code:'CREDIT_LOGIN_HTML_RESPONSE'}),true,'Isracard native HTML/WAF failures are eligible for one Camoufox fallback');
assert.equal(isCamoufoxRetryableNativeFailure({code:'CREDIT_INVALID_PASSWORD'}),false,'invalid credentials never trigger a second browser engine attempt');

const now=Date.parse('2026-08-30T06:00:00+03:00');
assert.equal(bankAutoRefreshDue(null,now),true,'missing successful bank sync is due');
assert.equal(bankAutoRefreshDue(new Date(now-BANK_AUTO_INTERVAL_MS+1).toISOString(),now),false,'sync younger than 24h is not due');
assert.equal(bankAutoRefreshDue(new Date(now-BANK_AUTO_INTERVAL_MS).toISOString(),now),true,'sync at 24h is due');
assert.equal(bankAutoRefreshDue('not-a-date',now),true,'invalid historical sync timestamp fails open to a fresh bank check');
assert.equal(normalizeAccountNumber('12-345-678901'),'12345678901');
assert.deepEqual(parseAccountSelector('345-678901'),{bankNumber:'12',branchNumber:'345',accountNumber:'678901'},'branch-account selector is normalized with Hapoalim bank 12');
assert.deepEqual(parseAccountSelector('12-345-678901'),{bankNumber:'12',branchNumber:'345',accountNumber:'678901'},'full bank-branch-account selector stays exact');

const accounts=[
  {accountNumber:'12-345-678901',balance:1200.4},
  {accountNumber:'12-345-111222',balance:-50},
];
assert.equal(selectBalanceAccount([accounts[0]]).accountNumber,accounts[0].accountNumber,'single balance account is selected');
assert.equal(selectBalanceAccount(accounts,'111222').accountNumber,accounts[1].accountNumber,'unique balance-account suffix is accepted');
assert.throws(()=>selectBalanceAccount(accounts),e=>e?.code==='MULTIPLE_ACCOUNTS','multiple balance accounts are never guessed or summed');
assert.throws(()=>selectBalanceAccount(accounts,'999999'),e=>e?.code==='ACCOUNT_NOT_FOUND','unknown configured balance account fails closed');

const accountDescriptors=[
  {bankNumber:12,branchNumber:345,accountNumber:678901,accountClosingReasonCode:0},
  {bankNumber:12,branchNumber:345,accountNumber:234567,accountClosingReasonCode:0},
  {bankNumber:12,branchNumber:789,accountNumber:678901,accountClosingReasonCode:0},
];
assert.equal(selectAccountDescriptor([accountDescriptors[0]]).accountId,'12-345-678901','single open account descriptor is selected before any bank-data fetch');
assert.equal(selectAccountDescriptor(accountDescriptors,{branchNumber:'345',accountNumber:'234567'}).accountId,'12-345-234567','separate branch/account selector builds the exact Hapoalim accountId');
assert.equal(selectAccountDescriptor(accountDescriptors,'345-678901').accountId,'12-345-678901','legacy branch-account text selects the exact descriptor');
assert.throws(()=>selectAccountDescriptor(accountDescriptors,'678901'),e=>e?.code==='AMBIGUOUS_ACCOUNT'&&e.availableAccounts?.length===3,'account number alone fails closed when the same number exists in another branch');
assert.throws(()=>selectAccountDescriptor(accountDescriptors),e=>e?.code==='MULTIPLE_ACCOUNTS'&&e.availableAccounts?.length===3,'multiple account descriptors return safe choices before bank APIs are queried');
assert.throws(()=>selectAccountDescriptor(accountDescriptors,{branchNumber:'345',accountNumber:'999999'}),e=>e?.code==='ACCOUNT_NOT_FOUND'&&e.availableAccounts?.some(x=>x.accountId==='12-345-678901'),'unknown exact account returns the bank-provided account choices');
assert.deepEqual(publicAccountDescriptors([accountDescriptors[0]])[0],{bankNumber:'12',branchNumber:'345',accountNumber:'678901',accountId:'12-345-678901'},'public account choices contain identifiers only, without balance or transaction data');

assert.equal(HAPOALIM_POST_LOGIN_TIMEOUT_MS,60*1000,'post-login bank SPA/API readiness may settle for up to sixty seconds');
assert.equal(HAPOALIM_NAVIGATION_STABLE_MS,1500,'bank data reads require a bounded stable navigation window instead of a fixed blind delay');
assert.equal(HAPOALIM_DATA_RETRY_LIMIT,3,'transient navigation recovery is bounded to three attempts');
assert.equal(isTransientNavigationError(new Error('Execution context was destroyed, most likely because of a navigation.')),true,'Puppeteer destroyed execution contexts are classified as transient navigation races');
assert.equal(isTransientNavigationError(new Error('HTTP 500')),false,'ordinary bank/API failures are not misclassified as navigation races');
let navAttempts=0,navRecoveries=0;
const navRecovered=await retryTransientNavigation(async()=>{navAttempts++;if(navAttempts<3)throw new Error('Execution context was destroyed, most likely because of a navigation.');return 'ok'},{attempts:3,onRetry:async()=>{navRecoveries++}});
assert.equal(navRecovered,'ok','transient page navigation is retried until a fresh execution context succeeds');
assert.equal(navAttempts,3,'navigation retry preserves a strict attempt bound');
assert.equal(navRecoveries,2,'navigation recovery callback runs only between transient attempts');
await assert.rejects(()=>retryTransientNavigation(async()=>{throw new Error('bank rejected request')},{attempts:3}),/bank rejected request/,'non-navigation failures are never retried as if they were transient');
assert.equal(HAPOALIM_TRANSACTION_LOOKBACK_DAYS,30,'recent transaction fetch is intentionally bounded to thirty days');
assert.equal(HAPOALIM_TRANSACTION_LIMIT,1000,'bridge requests the full thirty-day window with a 1000-row bank page size');
assert.equal(BANK_FEED_TRANSACTION_LIMIT,1000,'shared Kupa bank feed preserves the full thirty-day bank page instead of trimming it to twenty rows');
assert.equal(ymdDate(new Date(2026,7,30,12,0,0)),'20260830','Hapoalim request dates use local YYYYMMDD');

const detailPayload=[{
  transactionNumber:987654,
  chequeCount:2,
  rows:[
    {bankNumber:52,branchNumber:183,accountNumber:'105012322',chequeNumber:'4463454',chequeAmount:830,scanImageUrl:'https://login.bankhapoalim.co.il/temporary/scan?id=secret'},
    {bankNumber:17,branchNumber:732,accountNumber:'105323448',referenceNumber:'80000071',chequeAmount:1000},
  ],
  sessionToken:'must-not-survive',
}];
const chequeDetails=normalizeHapoalimAdditionalDetails(detailPayload);
assert.equal(chequeDetails.referenceNumber,'987654','Hapoalim additional transaction data exposes the bank transaction reference without guessing');
assert.deepEqual(chequeDetails.checkNumbers,['4463454','80000071'],'explicit per-cheque identifiers are preserved exactly as returned by the bank');
assert.equal(chequeDetails.checkCount,2,'explicit bank-provided cheque count is preserved');
assert.deepEqual(chequeDetails.checkItems.map(x=>[x.bankNumber,x.branchNumber,x.accountNumber,x.checkNumber,x.amount]),[['52','183','105012322','4463454',830],['17','732','105323448','80000071',1000]],'structured bank/branch/account/check-number/amount rows become a deterministic cheque table, including the bank UI row reference shown as אסמכתא (מס׳ צ׳ק)');
assert.equal(chequeDetails.hasDocumentReference,true,'scan/document presence can be indicated without persisting its URL');
assert.equal(JSON.stringify(chequeDetails).includes('secret'),false,'document/session values are never persisted into the shared bank feed');
assert.equal(buildHapoalimAdditionalDetailsUrl('https://login.bankhapoalim.co.il','/details?id=7','12-345-678901'),'https://login.bankhapoalim.co.il/details?id=7&accountId=12-345-678901&lang=he','pfm detail requests stay on Hapoalim origin and add exact account/language parameters');
assert.throws(()=>buildHapoalimAdditionalDetailsUrl('https://login.bankhapoalim.co.il','https://example.com/details','12-345-678901'),e=>e?.code==='UNSAFE_DETAIL_URL','foreign pfm detail URLs fail closed');
assert.equal(isHapoalimChequeTransaction({activityDescription:'הפק.שיק בסלולר'}),true,'bank-provided mobile cheque deposit description is recognized for targeted detail enrichment');
assert.equal(isHapoalimChequeTransaction({activityDescription:'הפק שיק-ע.ישיר'}),true,'direct-channel cheque deposit remains eligible for targeted enrichment');
assert.equal(isHapoalimChequeTransaction({activityDescription:'החזרת שיק'}),false,'returned cheques are not misclassified as cheque deposits');
assert.equal(isHapoalimChequeTransaction({activityDescription:'שיק'}),false,'ordinary cheque debits are not misclassified as cheque deposits');
assert.equal(isHapoalimChequeTransaction({activityDescription:'זיכוי מדיסקונט',beneficiaryDetailsData:{partyName:'זרצקי פרידה'}}),false,'beneficiary names containing the Hebrew letters צק cannot trigger cheque-deposit enrichment');
assert.equal(isHapoalimChequeTransaction({activityDescription:'העברה נכנסת'}),false,'ordinary transfers do not trigger extra cheque-detail requests');

const genericPfm=normalizeHapoalimAdditionalDetails([{transactionNumber:7826069983,transactionStatusCode:0,transactionSum:0,check:false,multiCheck:false,checkNumber:0}]);
assert.equal(genericPfm.referenceNumber,'7826069983','generic PFM payload may still provide a useful aggregate bank transaction reference');
assert.deepEqual(genericPfm.checkNumbers,[],'zero/check flags are never converted into fake cheque identifiers');
assert.equal(genericPfm.checkCount,null,'generic false/zero PFM flags never invent a one-cheque count');
assert.deepEqual(genericPfm.checkItems,[],'generic PFM status objects do not become a cheque-detail table');

const hebrewChequeId=normalizeHapoalimAdditionalDetails([{label:'מספר שיק',value:'778899'},{label:'מספר שיקים',value:'4'}]);
assert.deepEqual(hebrewChequeId.checkNumbers,['778899'],'singular Hebrew cheque-number labels remain identifiers, not counts');
assert.equal(hebrewChequeId.checkCount,4,'plural Hebrew number-of-cheques labels are classified as counts');
const labelledCheque=normalizeHapoalimAdditionalDetails([{bank:'10',branch:'856',account:'4244721',label:'מספר צ׳ק',value:'5000243',amount:'755.00',image:'https://bank.example/secret'}]);
assert.equal(labelledCheque.hasDocumentReference,true,'label/value scan references are detected without persisting the sensitive target');
assert.equal(JSON.stringify(labelledCheque).includes('bank.example'),false,'label/value document targets never enter the normalized feed');
const chequeArray=normalizeHapoalimAdditionalDetails({chequeNumbers:['1001','0','1002','1003']});
assert.deepEqual(chequeArray.checkNumbers,['1001','1002','1003'],'arrays explicitly named as cheque numbers preserve non-zero identifiers and discard sentinel zero');
assert.equal(chequeArray.checkCount,3,'explicit cheque-number arrays provide a deterministic count when no separate count is returned');

const rawInbound={referenceNumber:101,eventDate:'20260830',valueDate:'20260830',eventAmount:250,eventActivityTypeCode:1,activityDescription:'העברה נכנסת',serialNumber:9,currentBalance:4321.5,beneficiaryDetailsData:{partyName:'לקוח'}};
const rawOutbound={referenceNumber:102,eventDate:'20260829',valueDate:'20260829',eventAmount:80,eventActivityTypeCode:2,activityDescription:'הוראת קבע',serialNumber:0,currentBalance:4071.5,beneficiaryDetailsData:{messageDetail:'בדיקה'}};
const rawCheque={referenceNumber:555,eventDate:'20260828',valueDate:'20260828',eventAmount:1900,eventActivityTypeCode:1,activityDescription:'הפק.שיק בסלולר',serialNumber:77,currentBalance:5971.5,netunimAdditionalDetails:chequeDetails};
const inbound=normalizeHapoalimTransaction(rawInbound),outbound=normalizeHapoalimTransaction(rawOutbound),cheque=normalizeHapoalimTransaction(rawCheque);
assert.equal(inbound.amount,250,'incoming Hapoalim transaction is positive');
assert.equal(outbound.amount,-80,'outgoing Hapoalim transaction is negative');
assert.equal(outbound.status,'pending','serial number zero maps to pending like the pinned scraper');
assert.match(inbound.memo,/לקוח/,'beneficiary details are normalized into a compact memo');
assert.equal(inbound.balanceAfter,4321.5,'raw Hapoalim currentBalance is preserved as the authoritative balance after the transaction');
assert.equal(normalizeHapoalimTransaction({...rawInbound,currentBalance:null}).balanceAfter,null,'missing bank row balance stays unknown instead of being coerced to zero');
assert.equal(cheque.cheque,true,'cheque deposits remain explicitly marked after normalization');
assert.equal(cheque.bankReference,'555','main transaction reference is preserved as a stable bank identifier');
assert.equal(cheque.bankSerial,'77','bank serial is preserved separately instead of being mislabeled as a cheque number');
assert.deepEqual(cheque.checkDetails.checkNumbers,['4463454','80000071'],'additional cheque identifiers survive transaction normalization');
assert.equal(cheque.checkDetails.checkItems.length,2,'structured cheque rows survive transaction normalization');
assert.equal(cheque.checkDetails.hasDocumentReference,true,'only the fact that a scan/document reference exists survives normalization');
const repeated=normalizeRecentTransactions([rawOutbound,rawInbound,rawInbound],20);
assert.equal(repeated.length,2,'duplicate recent bank transactions are removed deterministically');
assert.equal(repeated[0].id,'101','recent transactions are sorted newest first');

const feed=normalizeBankFeed({
  provider:'hapoalim',accountNumber:'12-345-678901',balance:4321.5,syncedAt:'2026-08-30T06:15:00.000Z',
  transactions:[inbound,outbound,cheque],transactionWarning:'',
});
assert.equal(feed.balance,4321.5,'shared bank feed preserves the authoritative bank balance');
assert.equal(feed.transactions.length,3,'shared bank feed carries the complete fetched rolling-window transaction set');
assert.equal(feed.transactions.find(x=>x.bankReference==='101').balanceAfter,4321.5,'shared bank feed preserves the bank-provided per-transaction balance');
assert.equal(feed.version,4,'shared feed schema is upgraded to v4 for structured cheque rows');
assert.deepEqual(feed.transactions.find(x=>x.cheque).checkDetails.checkItems.map(x=>x.checkNumber),['4463454','80000071'],'shared feed v4 preserves structured verified cheque rows across cloud/local normalization');
assert.equal(feed.accountNumber,'12-345-678901','shared bank feed carries the selected account identity');
assert.equal(feed.syncedAt,'2026-08-30T06:15:00.000Z','shared bank feed carries the successful bank-sync timestamp');
assert.equal(normalizeBankFeed({balance:4,syncedAt:'bad'}),null,'invalid feed timestamps are rejected instead of becoming shared success markers');

const dualStamp='2026-08-30T06:20:00.000Z';
const controllerModel={state:{bank:{currentBalance:900,updatedAt:null,asOfDate:null,adjustments:[],feed:null,homeFeed:null}}};
let controllerSaves=0;
let dualBridgeResult={fetchedAt:dualStamp,accounts:{business:{balance:5100,branchNumber:'345',accountNumber:'111222',accountId:'12-345-111222',transactions:[]},home:{balance:2600,branchNumber:'345',accountNumber:'333444',accountId:'12-345-333444',transactions:[]}}};
const dualController=createDomainsBankController({
  model:controllerModel,session:{connectionMode:'local',backendReady:true},checksSession:{},sharedChecksHaveLocalWork:()=>false,
  saveState:async()=>{controllerSaves++;return true},syncSharedChecksFromCloud:async()=>true,sharedChecksObservedSequence:()=>17,toast:()=>{},render:()=>{},
  bridge:{getBridgeToken:()=> 'paired',fetchBalance:async()=>dualBridgeResult,autoEnabled:()=>false,markAutoAttempt:()=>{},autoAttemptDelayMs:()=>0},
});
assert.equal(await dualController.refreshBankBalance({interactive:false,auto:false}),true,'dual-account controller accepts one bridge refresh containing both roles');
assert.equal(controllerModel.state.bank.currentBalance,5100,'only the business balance becomes the Kupa currentBalance');
assert.equal(controllerModel.state.bank.sourceAccount,'12-345-111222','business account identity remains the bank snapshot source');
assert.equal(controllerModel.state.bank.feed.balance,5100,'business feed remains the canonical bank feed');
assert.equal(controllerModel.state.bank.homeFeed.balance,2600,'home balance is stored only in the separate view feed');
assert.equal(controllerModel.state.bank.homeFeed.accountNumber,'12-345-333444','home feed preserves its own account identity');
dualBridgeResult={fetchedAt:'2026-08-30T07:20:00.000Z',accounts:{business:{balance:5150,branchNumber:'345',accountNumber:'111222',accountId:'12-345-111222',transactions:[]},home:null},accountFailures:{home:{code:'ACCOUNT_NOT_FOUND',stage:'account',message:'החשבון הביתי לא נמצא',availableAccounts:[{bankNumber:'12',branchNumber:'345',accountNumber:'555666'}],accountRole:'home'}}};
assert.equal(await dualController.refreshBankBalance({interactive:false,auto:false}),true,'a home-account failure does not block the business balance refresh');
assert.equal(controllerModel.state.bank.currentBalance,5150,'business balance still advances when only the home account fails');
assert.equal(controllerModel.state.bank.homeFeed.balance,2600,'last successful home feed is preserved when a later home refresh fails');
assert.equal(dualController.bankBridgeUiState().accountSelectionRole,'home','home failure is attributed to the home selector for corrective UI');
assert.equal(dualController.bankBridgeUiState().availableAccounts[0].accountNumber,'555666','home account choices survive partial refresh diagnostics');
assert.equal(dualController.bankBridgeUiState().lastWarningCode,'ACCOUNT_NOT_FOUND','partial home failure keeps its safe diagnostic code separate from a full refresh error');
assert.equal(dualController.bankBridgeUiState().lastWarningStage,'account','partial home failure keeps its failing bank stage for corrective UI');

const earlyHomeFeed=normalizeBankFeed({provider:'hapoalim',accountNumber:'12-345-777888',balance:1800,syncedAt:'2026-08-29T06:20:00.000Z',transactions:[]});
const earlyModel={state:{bank:{currentBalance:4900,updatedAt:null,asOfDate:null,adjustments:[],feed:null,homeFeed:earlyHomeFeed}}};
const earlyController=createDomainsBankController({
  model:earlyModel,session:{connectionMode:'local',backendReady:true},checksSession:{},sharedChecksHaveLocalWork:()=>false,saveState:async()=>true,syncSharedChecksFromCloud:async()=>true,sharedChecksObservedSequence:()=>18,toast:()=>{},render:()=>{},
  bridge:{getBridgeToken:()=> 'paired',fetchBalance:async()=>({fetchedAt:'2026-08-30T08:20:00.000Z',accounts:{business:{balance:5250,branchNumber:'345',accountNumber:'111222',accountId:'12-345-111222',transactions:[]},home:null},accountFailures:{home:{code:'ACCOUNT_NOT_FOUND',stage:'account',message:'החשבון הביתי לא נמצא',availableAccounts:[],accountRole:'home'}}}),autoEnabled:()=>false,markAutoAttempt:()=>{},autoAttemptDelayMs:()=>0},
});
assert.equal(await earlyController.refreshBankBalance({interactive:false,auto:false}),true,'home failure may occur before the initial bridge status request has populated local account fields');
assert.equal(earlyModel.state.bank.homeFeed.accountNumber,'12-345-777888','a pre-status home failure preserves the prior home feed instead of treating missing local status as an account removal');

await dualController.commitBankSnapshot(5200,{source:'manual'});
assert.equal(controllerModel.state.bank.currentBalance,5200,'manual business snapshot can still replace Kupa currentBalance');
assert.equal(controllerModel.state.bank.homeFeed.balance,2600,'manual business snapshot never destroys the last synchronized home feed');
assert.equal(controllerSaves,3,'successful dual refresh, partial-home refresh and manual snapshot all follow the normal persistence path');

assert.deepEqual(scraperFailureMessage({errorType:'INVALID_PASSWORD'}),['פרטי ההתחברות לבנק הפועלים אינם נכונים','INVALID_PASSWORD']);
assert.equal(INTERACTIVE_AUTH_TIMEOUT_MS,10*60*1000,'interactive Hapoalim authentication window is ten minutes');
let urlIndex=0;
const authUrls=['https://login.bankhapoalim.co.il/mfa/verify','https://login.bankhapoalim.co.il/mfa/verify','https://login.bankhapoalim.co.il/ng-portals/rb/he/homepage'];
const fakePage={
  isClosed:()=>false,
  evaluate:async()=>authUrls[Math.min(urlIndex++,authUrls.length-1)],
  url:()=>authUrls[Math.min(urlIndex,authUrls.length-1)],
};
const terminal=await waitForTerminalLoginResult(fakePage,{SUCCESS:['https://login.bankhapoalim.co.il/ng-portals/rb/he/homepage'],INVALID:['https://login.bankhapoalim.co.il/invalid']},{timeoutMs:100,pollMs:10});
assert.equal(terminal.resultKey,'SUCCESS','interactive auth wait preserves the terminal login category after MFA');
assert.match(terminal.value,/homepage$/,'interactive auth wait ignores MFA intermediate pages and returns as soon as a terminal login URL is reached');
await assert.rejects(()=>waitForTerminalLoginResult({isClosed:()=>true,evaluate:async()=>''},{SUCCESS:['ok']},{timeoutMs:50,pollMs:10}),e=>e?.code==='INTERACTIVE_BROWSER_CLOSED','closing the visible bank browser is reported deterministically');
assert.deepEqual(scraperFailureMessage({errorType:'GENERIC',errorMessage:'NETUNIM_INTERACTIVE_AUTH_TIMEOUT'}),['זמן האימות בבנק הסתיים. פתח שוב אימות בבנק והשלם את הקוד בתוך 10 דקות','INTERACTIVE_AUTH_TIMEOUT']);
assert.equal(SILENT_AUTH_TIMEOUT_MS,90*1000,'silent Hapoalim login gets a bounded ninety-second session/login window');
let authenticatedChecks=0;
const unknownSuccessUrl='https://login.bankhapoalim.co.il/new-bank-shell/dashboard';
const sessionAwarePage={isClosed:()=>false,evaluate:async()=>unknownSuccessUrl,url:()=>unknownSuccessUrl};
const sessionTerminal=await waitForTerminalLoginResult(sessionAwarePage,{SUCCESS:[async()=>++authenticatedChecks>=3],INVALID:['https://login.bankhapoalim.co.il/invalid']},{timeoutMs:120,pollMs:10});
assert.equal(sessionTerminal.resultKey,'SUCCESS','an authenticated bank-session predicate can prove login success even when Hapoalim changes the post-login URL');
assert.equal(sessionTerminal.value,unknownSuccessUrl,'session-aware login does not rewrite or depend on the current Hapoalim route');
await assert.rejects(()=>waitForTerminalLoginResult(sessionAwarePage,{SUCCESS:[async()=>false]},{timeoutMs:25,pollMs:10,timeoutCode:'SILENT_AUTH_TIMEOUT',timeoutMarker:'NETUNIM_SILENT_AUTH_TIMEOUT'}),e=>e?.code==='SILENT_AUTH_TIMEOUT'&&e?.message==='NETUNIM_SILENT_AUTH_TIMEOUT','silent login timeout has its own deterministic code instead of masquerading as interactive MFA');
assert.deepEqual(scraperFailureMessage({errorType:'GENERIC',errorMessage:'NETUNIM_SILENT_AUTH_TIMEOUT'}),['לא נמצא סשן בנק פעיל ברענון השקט. לחץ „פתח אימות בבנק” פעם אחת כדי לחדש את ההזדהות.','AUTH_REQUIRED']);

console.log('PASS bank bridge models: shared 24h schedule, staged account selection, cheque detail enrichment, transaction feed and session-aware MFA behavior are deterministic');
