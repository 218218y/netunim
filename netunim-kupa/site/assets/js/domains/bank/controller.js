import {createRuntimeTaskOwner} from '../../shared/runtime-task-owner.js';
import {createPollingTask} from '../../shared/runtime-polling.js';
import {BANK_AUTO_INTERVAL_MS,bankAutoRefreshDue} from '../../shared/finance-refresh-policy.js';
import {normalizeBankFeed} from './feed.js';
import {projectBankArchiveFeed} from './archive-model.js';

export function createDomainsBankController({
  model,
  session,
  toast,
  render,
  bridge,
  autoScope,
  operationScope,
  connections,
  timers=globalThis,
  acknowledgeBankTransactionMissing=async()=>null,
  archive,
  snapshots,
  bankRefresh,
}){
// Financial feedback is independent of passive device status. A new pairing
// or local connection command retires feedback from the former operation.
const financialFeedback = {busy:false, resultReady:false};
let feedbackGeneration = -1, feedbackCommandRevision = -1;
function resetFeedback() {
  for (const key of Object.keys(financialFeedback))
    if (key !== 'busy' && key !== 'resultReady') delete financialFeedback[key];
}
function connectionState() {
  const value = connections.queries.snapshot();
  if (value.generation !== feedbackGeneration || value.commandRevision !== feedbackCommandRevision) {
    feedbackGeneration = value.generation;
    feedbackCommandRevision = value.commandRevision;
    resetFeedback();
  }
  return value;
}
async function connectionCommand(method, ...args) {
  if (financialFeedback.busy) return false;
  const completed = await connections.commands[method](...args);
  // Pairing, credentials and account selection can remove an earlier admission
  // blocker. The polling owner will check every gate again before doing work.
  if (completed && automaticActive && !disposed && method !== 'deleteCredentials')
    startAutoSync();
  return completed;
}
if(typeof autoScope!=='function')throw new Error('bank_auto_scope_required');
if(typeof operationScope?.capture!=='function'||typeof operationScope?.captureRead!=='function')throw new Error('bank_operation_scope_required');
for(const [group,methods] of Object.entries({commands:['saveToken','configure','selectAccount','deleteCredentials','exportDiagnostics','recordScan'],queries:['snapshot','capture','isCurrent','readStatus','refreshStatus','supported']}))
  for(const method of methods)if(typeof connections?.[group]?.[method]!=='function')throw new TypeError('kupa_bank_connection_'+group+'_'+method+'_required');

for (const method of ['commitManual','retryLocal'])
  if (typeof snapshots?.commands?.[method] !== 'function')
    throw new TypeError('kupa_bank_snapshot_command_' + method + '_required');
if (typeof snapshots?.queries?.localState !== 'function')
  throw new TypeError('kupa_bank_snapshot_query_required');
if(typeof bankRefresh?.commands?.refresh!=='function')throw new TypeError('kupa_bank_refresh_required');
for(const method of ['isPending','drain','dispose'])if(typeof bankRefresh?.runtime?.[method]!=='function')throw new TypeError('kupa_bank_refresh_runtime_'+method+'_required');
const commitBankSnapshot = snapshots.commands.commitManual;
const localSnapshot = {state:snapshots.queries.localState,retry:snapshots.commands.retryLocal};
let disposed=false;
const workOwner=createRuntimeTaskOwner();
function track(work){return disposed?Promise.resolve(false):workOwner.run(work)}
let automaticActive=true,automaticOwner=null;
const automaticAllowed=()=>{
  const scope=autoScope();if(disposed||!automaticActive||localSnapshot.state()||typeof scope!=='string'||!scope.length)return false;
  if(automaticOwner===null)automaticOwner=scope;
  return scope===automaticOwner&&session.backendReady&&!connectionState().upgradeRequired&&connectionState().tokenConfigured&&bridge.autoEnabled();
};
const autoTask=createPollingTask({timers,canRun:automaticAllowed,delay:autoDelay,run:({isCurrent})=>track(()=>refreshBankBalance({interactive:false,auto:true,isCurrent})),onError:error=>console.error('bank auto refresh',error)});

for (const [group,methods] of Object.entries({
  queries:['matching'], commands:['invalidate'], runtime:['ensure','pause','resume'],
}))
  for (const method of methods)
    if (typeof archive?.[group]?.[method] !== 'function')
      throw new TypeError('kupa_bank_archive_' + group + '_' + method + '_required');
const ensureBankDisplayArchive = archive.runtime.ensure;
const displayArchiveFeed = (role,feed) => projectBankArchiveFeed(archive,role,feed);

function sharedBankLastSyncAt(state=model.state){const feed=normalizeBankFeed(state?.bank?.feed);return feed?.syncedAt||state?.bank?.bankSyncAt||(state?.bank?.source==='hapoalim'?state?.bank?.updatedAt:null)||null}


async function retryLocalBankSnapshot(){
  try{const saved=await localSnapshot.retry();if(saved&&automaticActive)autoTask.start();return saved}
  catch(error){toast(error?.code==='FINANCE_OPERATION_SCOPE_CHANGED'?error.message:'לא ניתן לאשר את הצילום הקיים. יש לבדוק את מצב האחסון; לא בוצעה סריקה נוספת מהבנק.');return false}
}

function bankBridgeUiState(){
  const connection=connectionState();
  const feed=displayArchiveFeed('business',model.state.bank?.feed),homeFeed=displayArchiveFeed('home',model.state.bank?.homeFeed);
  const sharedLastSyncAt=sharedBankLastSyncAt();
  const homeLastSyncAt=homeFeed?.syncedAt||null;
  const local=localSnapshot.state();
  return {...connection,...financialFeedback,busy:financialFeedback.busy||connection.busy,...(local&&local.phase!=='saving'?{lastError:local.message}:{}),localSnapshot:local,autoEnabled:bridge.autoEnabled(),sharedLastSyncAt,homeLastSyncAt,feed,homeFeed};
}

function setBankAutoRefresh(enabled){bridge.setAutoEnabled(!!enabled);toast(enabled?'עדכון אוטומטי כל 4 שעות הופעל':'עדכון אוטומטי כובה');if(enabled)startAutoSync();else stopAutoSync()}

async function refreshBankBalance({
  interactive = false,
  auto = false,
  isCurrent = () => true
} = {}) {
  const pending = localSnapshot.state();
  if (pending) {
    if (!auto) toast(pending.message);
    return false;
  }
  const scope = auto ? autoScope() : null,
    allowed = () => isCurrent() && automaticAllowed() && autoScope() === scope;
  if (auto && !allowed()) return false;
  if (bankBridgeUiState().busy) return false;
  if (!connectionState().tokenConfigured) {
    if (!auto) toast('החיבור לבנק עדיין לא הוגדר');
    return false;
  }
  if (connectionState().upgradeRequired) {
    if (!auto)
      toast(
        'יש להריץ מחדש install_bank_bridge.bat במחשב זה לפני עדכון מול הבנק'
      );
    return false;
  }
  archive.runtime.pause();
  financialFeedback.busy = true;
  financialFeedback.resultReady = false;
  financialFeedback.lastError = '';
  financialFeedback.lastErrorAt = null;
  financialFeedback.lastErrorCode = '';
  financialFeedback.lastErrorStage = '';
  financialFeedback.lastErrorHttpStatus = 0;
  financialFeedback.lastWarning = '';
  financialFeedback.lastWarningCode = '';
  financialFeedback.lastWarningStage = '';
  financialFeedback.lastWarningHttpStatus = 0;
  financialFeedback.accountSelectionRole = '';
  financialFeedback.message = interactive
    ? 'חלון האימות בבנק פתוח. לאחר האימות ה-Bridge יעדכן באותו סשן את החשבון העסקי ואת החשבון הביתי.'
    : auto
      ? 'מעדכן אוטומטית את שני חשבונות בנק הפועלים…'
      : 'מעדכן יתרות ותנועות בשני חשבונות בנק הפועלים…';
  try {
    return await bankRefresh.commands.refresh({
      interactive,
      auto,
      allowed,
      onStarted: () => render(),
      onDenied: () => {
        financialFeedback.message =
          'סינכרון הבנק כבר מתבצע ממחשב או חלון אחר; לא נפתחה כניסה נוספת לבנק.';
        if (!auto) toast(financialFeedback.message);
      },
      onCloudSaved: historyDays => {
        toast(
          historyDays >= 365
            ? 'ארכיון הבנק אומת ואותחל בכתיבה אטומית'
            : auto
              ? 'נתוני הבנק עודכנו'
              : 'נתוני הבנק עודכנו ונשמרו בארכיון נפרד'
        );
      },
      onPublished: ({
        business,
        home,
        homeFailure,
        fetchedAt,
        warnings,
        bridgeStatus,
        assertConnection
      }) => {
        Object.assign(financialFeedback, {
          availableAccounts: Array.isArray(homeFailure?.availableAccounts)
            ? homeFailure.availableAccounts
            : [],
          accountSelectionRole: homeFailure ? 'home' : '',
          lastError: '',
          lastErrorAt: null,
          lastErrorCode: '',
          lastErrorStage: '',
          lastErrorHttpStatus: 0,
          lastWarning: warnings.join(' | '),
          lastWarningCode: homeFailure?.code || '',
          lastWarningStage: homeFailure?.stage || '',
          lastWarningHttpStatus: Number(homeFailure?.httpStatus) || 0,
          message: homeFailure
            ? 'החשבון העסקי עודכן בהצלחה; החשבון הביתי לא עודכן ונשמר הנתון הביתי האחרון.'
            : warnings.length
              ? 'היתרות עודכנו בהצלחה; קיימת אזהרה לגבי חלק מהתנועות.'
              : home
                ? 'שני החשבונות והפעילות האחרונה התקבלו בהצלחה מבנק הפועלים.'
                : 'החשבון העסקי והתנועות האחרונות התקבלו בהצלחה מבנק הפועלים.'
        });
        connections.commands.recordScan(
          {
            bridgeVersion: bridgeStatus.bridgeVersion,
            lastScrapeAt: fetchedAt,
            availableAccounts: Array.isArray(homeFailure?.availableAccounts)
              ? homeFailure.availableAccounts
              : [],
            accountSelectionRole: homeFailure ? 'home' : '',
            businessBranchNumber: business.branchNumber,
            businessAccountNumber: business.accountNumber,
            homeBranchNumber:
              home?.branchNumber ?? connectionState().homeBranchNumber,
            homeAccountNumber:
              home?.accountNumber ?? connectionState().homeAccountNumber
          },
          assertConnection
        );
        if (homeFailure && !auto)
          toast(
            'החשבון העסקי עודכן. החשבון הביתי לא עודכן; הנתון הביתי הקודם נשמר ופרטי התקלה מוצגים במסך הבנק.'
          );
        else if (warnings.length && !auto)
          toast(
            'היתרות עודכנו. חלק מהתנועות לא נטענו במלואן; פרטי האזהרה מוצגים במסך הבנק.'
          );
        financialFeedback.resultReady = true;
        render();
      },
      onFailed: (e, assertConnection) => {
        if (
          assertConnection &&
          !connections.queries.isCurrent(assertConnection)
        )
          connectionState();
        if (!localSnapshot.state()) {
          financialFeedback.lastError = e.message || String(e);
          financialFeedback.lastErrorAt = new Date().toISOString();
          financialFeedback.lastErrorCode = e.code || '';
          financialFeedback.lastErrorStage = e.stage || '';
          financialFeedback.lastErrorHttpStatus = Number(e.httpStatus) || 0;
          financialFeedback.availableAccounts = Array.isArray(
            e.availableAccounts
          )
            ? e.availableAccounts
            : [];
          financialFeedback.accountSelectionRole = e.accountRole || '';
          financialFeedback.message = financialFeedback.lastError;
        }
        if (!auto) toast(bankBridgeUiState().lastError);
        financialFeedback.resultReady = true;
        render();
      }
    });
  } finally {
    financialFeedback.busy = false;
    archive.runtime.resume();
    financialFeedback.resultReady = false;
    render();
  }
}

async function acknowledgeMissingBankTransaction(transactionId){
  if(session.connectionMode!=='supabase')return false;
  const id=Number(transactionId);if(!Number.isSafeInteger(id)||id<=0){toast('לא ניתן לזהות את תנועת הבנק לסימון');return false}
  try{
    const assertCurrent=operationScope.capture();
    await acknowledgeBankTransactionMissing(id,{assertCurrent});assertCurrent();
    archive.commands.invalidate(id);
    await ensureBankDisplayArchive();assertCurrent();
    toast('התנועה סומנה כנבדקה. התיעוד נשמר בארכיון, והיא הוסרה מההיסטוריה החכמה ומהאזהרות.');render();return true;
  }catch(error){toast(error?.message||'סימון התנועה כנבדקה נכשל');return false}
}

function autoDelay(){
  const now=Date.now(),lastSyncAt=sharedBankLastSyncAt(),lastSyncMs=lastSyncAt?Date.parse(lastSyncAt):NaN;
  if(!bankAutoRefreshDue(lastSyncAt,now))return Math.max(1000,lastSyncMs+BANK_AUTO_INTERVAL_MS-now+250);
  const retryIn=bridge.autoAttemptDelayMs(now);
  return retryIn>0?Math.max(1000,retryIn+250):300;
}
function maybeAutoRefreshBankBalance(){return automaticActive?autoTask.start():false}
function startAutoSync(){if(disposed)return false;automaticActive=true;automaticOwner=null;return autoTask.start()}
function stopAutoSync(){automaticActive=false;return autoTask.stop()}

const runtime={
  isPending:()=>workOwner.isPending()||bankRefresh.runtime.isPending(),
  async drain(){
    await Promise.all([workOwner.drain(),bankRefresh.runtime.drain()]);
  },
  dispose(){
    if(disposed)return false;
    disposed=true;workOwner.close();stopAutoSync();bankRefresh.runtime.dispose();
    return true;
  },
};
return {
  refreshReadout:{lastSyncAt:sharedBankLastSyncAt},
  bankBridgeUiState,bankLocalSnapshotState:localSnapshot.state,
  retryLocalBankSnapshot:(...args)=>track(()=>retryLocalBankSnapshot(...args)),
  ensureBankDisplayArchive:(...args)=>track(()=>ensureBankDisplayArchive(...args)),
  refreshBankBridgeStatus:(...args)=>track(async()=>{
    const status=await connections.queries.refreshStatus(...args);
    if(automaticActive&&!disposed&&status.available===true&&status.configured&&!status.upgradeRequired)startAutoSync();
    return status;
  }),
  saveBankBridgeToken:(...args)=>track(()=>connectionCommand('saveToken',...args)),
  configureBankBridge:(...args)=>track(()=>connectionCommand('configure',...args)),
  selectBankBridgeAccount:(...args)=>track(()=>connectionCommand('selectAccount',...args)),
  deleteBankBridgeCredentials:(...args)=>track(()=>connectionCommand('deleteCredentials',...args)),
  exportBankChequeDiagnostics:(...args)=>track(()=>connectionCommand('exportDiagnostics',...args)),
  refreshBankBalance:(...args)=>track(()=>refreshBankBalance(...args)),
  acknowledgeMissingBankTransaction:(...args)=>track(()=>acknowledgeMissingBankTransaction(...args)),
  commitBankSnapshot:(...args)=>track(()=>commitBankSnapshot(...args)),
  setBankAutoRefresh,maybeAutoRefreshBankBalance,startAutoSync,stopAutoSync,runtime,
};
}
