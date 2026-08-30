import assert from 'node:assert/strict';
import {bankAutoRefreshDue,BANK_AUTO_INTERVAL_MS} from '../netunim-kupa/site/assets/js/domains/bank/bridge.js';
import {normalizeBankFeed,BANK_FEED_TRANSACTION_LIMIT} from '../netunim-kupa/site/assets/js/domains/bank/feed.js';
import {
  HAPOALIM_POST_LOGIN_TIMEOUT_MS,
  HAPOALIM_TRANSACTION_LOOKBACK_DAYS,
  HAPOALIM_TRANSACTION_LIMIT,
  INTERACTIVE_AUTH_TIMEOUT_MS,
  SILENT_AUTH_TIMEOUT_MS,
  normalizeAccountNumber,
  parseAccountSelector,
  publicAccountDescriptors,
  normalizeHapoalimTransaction,
  normalizeRecentTransactions,
  selectAccountDescriptor,
  selectBalanceAccount,
  scraperFailureMessage,
  waitForTerminalLoginResult,
  ymdDate,
} from '../netunim-kupa/bank-bridge/lib.mjs';

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
assert.equal(HAPOALIM_TRANSACTION_LOOKBACK_DAYS,30,'recent transaction fetch is intentionally bounded to thirty days');
assert.equal(HAPOALIM_TRANSACTION_LIMIT,20,'bridge exposes at most twenty recent transactions');
assert.equal(BANK_FEED_TRANSACTION_LIMIT,20,'shared Kupa bank feed uses the same twenty-row cap');
assert.equal(ymdDate(new Date(2026,7,30,12,0,0)),'20260830','Hapoalim request dates use local YYYYMMDD');

const rawInbound={referenceNumber:101,eventDate:'20260830',valueDate:'20260830',eventAmount:250,eventActivityTypeCode:1,activityDescription:'העברה נכנסת',serialNumber:9,beneficiaryDetailsData:{partyName:'לקוח'}};
const rawOutbound={referenceNumber:102,eventDate:'20260829',valueDate:'20260829',eventAmount:80,eventActivityTypeCode:2,activityDescription:'הוראת קבע',serialNumber:0,beneficiaryDetailsData:{messageDetail:'בדיקה'}};
const inbound=normalizeHapoalimTransaction(rawInbound),outbound=normalizeHapoalimTransaction(rawOutbound);
assert.equal(inbound.amount,250,'incoming Hapoalim transaction is positive');
assert.equal(outbound.amount,-80,'outgoing Hapoalim transaction is negative');
assert.equal(outbound.status,'pending','serial number zero maps to pending like the pinned scraper');
assert.match(inbound.memo,/לקוח/,'beneficiary details are normalized into a compact memo');
const repeated=normalizeRecentTransactions([rawOutbound,rawInbound,rawInbound],20);
assert.equal(repeated.length,2,'duplicate recent bank transactions are removed deterministically');
assert.equal(repeated[0].id,'101','recent transactions are sorted newest first');

const feed=normalizeBankFeed({
  provider:'hapoalim',accountNumber:'12-345-678901',balance:4321.5,syncedAt:'2026-08-30T06:15:00.000Z',
  transactions:[inbound,outbound],transactionWarning:'',
});
assert.equal(feed.balance,4321.5,'shared bank feed preserves the authoritative bank balance');
assert.equal(feed.transactions.length,2,'shared bank feed carries recent transactions');
assert.equal(feed.accountNumber,'12-345-678901','shared bank feed carries the selected account identity');
assert.equal(feed.syncedAt,'2026-08-30T06:15:00.000Z','shared bank feed carries the successful bank-sync timestamp');
assert.equal(normalizeBankFeed({balance:4,syncedAt:'bad'}),null,'invalid feed timestamps are rejected instead of becoming shared success markers');

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

console.log('PASS bank bridge models: shared 24h schedule, staged account selection, transaction normalization/feed and session-aware MFA behavior are deterministic');
