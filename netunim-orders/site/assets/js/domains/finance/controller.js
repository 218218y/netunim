import {clone,uid} from '../../core/values.js';
import {checkTodayISO} from '../../core/dates.js';
import {kupaWholeMoney} from '../../core/money.js';
import {normalizeSharedBankEvents} from '../checks/model.js';
import {normalizeBankFeed} from './bank-feed.js';
import {mergeCreditSyncResult,normalizeCreditSync} from './credit-feed.js';
import {FINANCE_AUTO_INTERVAL_MS,financeRefreshDue} from './bridge.js';

const BANK_BRIDGE_VERSION=19;
const CREDIT_BRIDGE_VERSION=20;

function accountIdOf(snapshot){return snapshot?.accountId||[snapshot?.branchNumber,snapshot?.accountNumber].filter(Boolean).join('-')||snapshot?.accountNumber||''}
function bankFeedFromSnapshot(snapshot,fetchedAt){if(!snapshot||!Number.isFinite(Number(snapshot.balance)))return null;return normalizeBankFeed({provider:'hapoalim',accountNumber:accountIdOf(snapshot),balance:Number(snapshot.balance),syncedAt:fetchedAt,transactions:snapshot.transactions||[],transactionWarning:snapshot.transactionWarning||''})}
function bankLastSyncAt(kupa){const feed=normalizeBankFeed(kupa?.bank?.feed);return feed?.syncedAt||kupa?.bank?.bankSyncAt||(kupa?.bank?.source==='hapoalim'?kupa?.bank?.updatedAt:null)||null}
function creditLastSyncAt(kupa){return normalizeCreditSync(kupa?.creditSync).syncedAt}
function revisionConflict(result){return !result?.r?.ok&&String(result?.j?.message||result?.txt||'').includes('revision_conflict')}

export function createDomainsFinanceController({tab,checksSession,bridge,loadSession,refreshKupaReadout,readKupaReadOnlyCloud,rpcSaveKupaDocument,acceptKupaCloudRow,syncSharedChecksFromCloud,saveSharedChecksToCloud,checksHaveLocalWork,toast}){
  const local={bankBusy:false,creditBusy:false,bankTimer:null,creditTimer:null,bankError:'',creditError:''};

  function snapshot(){const kupa=checksSession.kupaCloudReadState&&typeof checksSession.kupaCloudReadState==='object'?clone(checksSession.kupaCloudReadState):null;return {kupa,bank:kupa?.bank?clone(kupa.bank):null,creditSync:normalizeCreditSync(kupa?.creditSync),cards:Array.isArray(kupa?.cards)?clone(kupa.cards):[],credits:Array.isArray(kupa?.credits)?clone(kupa.credits):[],bankLastSyncAt:bankLastSyncAt(kupa),creditLastSyncAt:creditLastSyncAt(kupa),bankAutoEnabled:bridge.bankAutoEnabled(),creditAutoEnabled:bridge.creditAutoEnabled(),bridgeTokenConfigured:!!bridge.getBridgeToken(),bankBusy:local.bankBusy,creditBusy:local.creditBusy,bankError:local.bankError,creditError:local.creditError}}

  async function refreshFinanceData({force=true,renderIfChanged=true}={}){if(!loadSession()||!navigator.onLine)return snapshot();await refreshKupaReadout({force,renderIfChanged});return snapshot()}

  function observedChecksSequence(kupa){const floor=Number(kupa?.bank?.snapshotSeq),start=Number.isSafeInteger(floor)&&floor>=0?floor:0;return normalizeSharedBankEvents(checksSession.checksBankEvents).reduce((max,event)=>Math.max(max,event.seq),start)}

  async function mutateKupaCloud(mutator){
    for(let attempt=0;attempt<3;attempt++){
      const row=await readKupaReadOnlyCloud();
      if(!row?.state)throw new Error('מסמך הקופה בענן לא נמצא');
      const candidate=mutator(clone(row.state));
      if(!candidate){acceptKupaCloudRow(row,{renderIfChanged:true});return {saved:false,skipped:true,row}}
      const result=await rpcSaveKupaDocument(candidate,Number(row.revision||0));
      if(result.r.ok){const savedRow={revision:Number(result.row?.revision||Number(row.revision||0)+1),updated_at:result.row?.updated_at||row.updated_at,state:result.row?.state||candidate};acceptKupaCloudRow(savedRow,{renderIfChanged:true});return {saved:true,skipped:false,row:savedRow}}
      if(revisionConflict(result))continue;
      throw new Error(result.j?.message||result.txt||'שמירת נתוני הקופה המשותפים נכשלה');
    }
    throw new Error('מסמך הקופה השתנה שוב בזמן עדכון פיננסי; לא נדרס שום נתון')
  }

  async function prepareBankSnapshot(){
    if(checksHaveLocalWork()){const saved=await saveSharedChecksToCloud('הצ׳קים סונכרנו לפני צילום יתרת הבנק');if(!saved||checksHaveLocalWork())throw new Error('יש להמתין לסנכרון הצ׳קים לפני צילום יתרת עו״ש חדש')}
    const synced=await syncSharedChecksFromCloud({quiet:true,required:true});
    if(!synced||checksHaveLocalWork())throw new Error('צילום היתרה נעצר: לא ניתן לאמת שהצ׳קים מסונכרנים כרגע')
  }

  async function refreshBank({interactive=false,auto=false}={}){
    if(local.bankBusy||local.creditBusy)return false;
    if(!tab.primaryTab||!loadSession()||!navigator.onLine)return false;
    if(!bridge.getBridgeToken()){if(!auto)toast('יש לצמד את ניהול ההזמנות ל-Bank Bridge במחשב זה');return false}
    local.bankBusy=true;local.bankError='';if(auto)bridge.markBankAttempt();
    try{
      const cloudFresh=await refreshKupaReadout({force:true,renderIfChanged:true});
      if(auto&&!cloudFresh)throw new Error('לא ניתן לאמת את זמן סנכרון הבנק המשותף בענן');
      if(auto&&!financeRefreshDue(bankLastSyncAt(checksSession.kupaCloudReadState)))return true;
      const status=await bridge.status();
      if(Number(status.bridgeVersion||0)<BANK_BRIDGE_VERSION)throw new Error('יש לשדרג את Bank Bridge לפני סנכרון הבנק');
      if(!status.configured)throw new Error('Bank Bridge פעיל אך פרטי בנק הפועלים עדיין לא הוגדרו');
      await prepareBankSnapshot();
      const result=await bridge.fetchBalance({interactive}),business=result.accounts?.business||result,home=result.accounts?.home??null,homeFailure=result.accountFailures?.home||null;
      if(!Number.isFinite(Number(business?.balance)))throw new Error('Bank Bridge לא החזיר יתרה עסקית תקינה');
      if(home&&!Number.isFinite(Number(home.balance)))throw new Error('Bank Bridge לא החזיר יתרה ביתית תקינה');
      const fetchedAt=result.fetchedAt||new Date().toISOString(),businessFeed=bankFeedFromSnapshot(business,fetchedAt),homeFeed=home?bankFeedFromSnapshot(home,fetchedAt):null,businessAccount=accountIdOf(business);
      const saved=await mutateKupaCloud(kupa=>{
        if(auto&&!financeRefreshDue(bankLastSyncAt(kupa)))return null;
        const previousBank=kupa.bank&&typeof kupa.bank==='object'?kupa.bank:{},nextHomeFeed=home?homeFeed:(homeFailure?previousBank.homeFeed??null:null);
        kupa.bank={...previousBank,currentBalance:kupaWholeMoney(business.balance),updatedAt:new Date().toISOString(),asOfDate:checkTodayISO(),snapshotToken:uid('BANK'),snapshotSeq:observedChecksSequence(kupa),adjustments:[],source:'hapoalim',sourceAccount:businessAccount||null,bankSyncAt:fetchedAt,feed:businessFeed,homeFeed:nextHomeFeed};
        return kupa;
      });
      if(!auto&&!saved.skipped)toast(homeFailure?'החשבון העסקי עודכן; החשבון הביתי נשאר בנתון האחרון':'נתוני הבנק העסקי והביתי עודכנו וזמינים בשתי המערכות');
      return true;
    }catch(error){local.bankError=error?.message||String(error);if(!auto)toast(local.bankError);return false}
    finally{local.bankBusy=false;scheduleBankAuto()}
  }

  async function refreshCredit({interactive=false,auto=false}={}){
    if(local.creditBusy||local.bankBusy)return false;
    if(!tab.primaryTab||!loadSession()||!navigator.onLine)return false;
    if(!bridge.getBridgeToken()){if(!auto)toast('יש לצמד את ניהול ההזמנות ל-Bank Bridge במחשב זה');return false}
    local.creditBusy=true;local.creditError='';if(auto)bridge.markCreditAttempt();
    try{
      const cloudFresh=await refreshKupaReadout({force:true,renderIfChanged:true});
      if(auto&&!cloudFresh)throw new Error('לא ניתן לאמת את זמן סנכרון האשראי המשותף בענן');
      if(auto&&!financeRefreshDue(creditLastSyncAt(checksSession.kupaCloudReadState)))return true;
      const status=await bridge.creditStatus();
      if(Number(status.bridgeVersion||0)<CREDIT_BRIDGE_VERSION)throw new Error('יש לשדרג את Bank Bridge לפני סנכרון האשראי');
      if(!(status.profiles||[]).length)throw new Error('לא הוגדר עדיין חיבור לחברת אשראי במחשב זה');
      const result=await bridge.syncCreditCards({interactive});
      const saved=await mutateKupaCloud(kupa=>{if(auto&&!financeRefreshDue(creditLastSyncAt(kupa)))return null;kupa.creditSync=mergeCreditSyncResult(kupa.creditSync,result);return kupa});
      if(!auto&&!saved.skipped)toast(result.errors?.length?`האשראי עודכן עם ${result.errors.length} אזהרות והנתונים זמינים בשתי המערכות`:'נתוני האשראי עודכנו וזמינים בשתי המערכות');
      return true;
    }catch(error){
      local.creditError=error?.message||String(error);
      if(Array.isArray(error?.creditErrors)&&error.creditErrors.length){try{await mutateKupaCloud(kupa=>{kupa.creditSync=mergeCreditSyncResult(kupa.creditSync,{profiles:[],errors:error.creditErrors});return kupa})}catch(persistError){console.error('credit diagnostics save',persistError)}}
      if(!auto)toast(local.creditError);return false;
    }finally{local.creditBusy=false;scheduleCreditAuto()}
  }

  function clearTimer(name){if(local[name]){clearTimeout(local[name]);local[name]=null}}
  function autoWait(lastSyncAt){const time=lastSyncAt?Date.parse(lastSyncAt):NaN;return Number.isFinite(time)?Math.max(1000,time+FINANCE_AUTO_INTERVAL_MS-Date.now()+250):1000}
  function scheduleBankAuto(){clearTimer('bankTimer');if(!loadSession()||!bridge.bankAutoEnabled()||!bridge.getBridgeToken())return;const retryWait=typeof bridge.bankAttemptDelayMs==='function'?bridge.bankAttemptDelayMs():0,wait=Math.max(autoWait(bankLastSyncAt(checksSession.kupaCloudReadState)),retryWait+250);local.bankTimer=setTimeout(()=>{local.bankTimer=null;maybeAutoRefreshBank().catch(error=>console.error('orders bank auto refresh',error))},wait)}
  function scheduleCreditAuto(){clearTimer('creditTimer');if(!loadSession()||!bridge.creditAutoEnabled()||!bridge.getBridgeToken())return;const retryWait=typeof bridge.creditAttemptDelayMs==='function'?bridge.creditAttemptDelayMs():0,wait=Math.max(autoWait(creditLastSyncAt(checksSession.kupaCloudReadState)),retryWait+250);local.creditTimer=setTimeout(()=>{local.creditTimer=null;maybeAutoRefreshCredit().catch(error=>console.error('orders credit auto refresh',error))},wait)}
  async function maybeAutoRefreshBank(){scheduleBankAuto();if(!tab.primaryTab||!loadSession()||!navigator.onLine||local.bankBusy||local.creditBusy||!bridge.bankAutoEnabled()||!bridge.getBridgeToken()||!bridge.bankAttemptReady())return false;return refreshBank({interactive:false,auto:true})}
  async function maybeAutoRefreshCredit(){scheduleCreditAuto();if(!tab.primaryTab||!loadSession()||!navigator.onLine||local.bankBusy||local.creditBusy||!bridge.creditAutoEnabled()||!bridge.getBridgeToken()||!bridge.creditAttemptReady())return false;return refreshCredit({interactive:false,auto:true})}
  function startAutoSync(){scheduleBankAuto();scheduleCreditAuto()}
  function setBankAutoEnabled(value){bridge.setBankAutoEnabled(value);scheduleBankAuto()}
  function setCreditAutoEnabled(value){bridge.setCreditAutoEnabled(value);scheduleCreditAuto()}
  function setBridgeToken(value){const token=bridge.setBridgeToken(value);startAutoSync();return token}

  return {snapshot,refreshFinanceData,refreshBank,refreshCredit,maybeAutoRefreshBank,maybeAutoRefreshCredit,startAutoSync,setBankAutoEnabled,setCreditAutoEnabled,setBridgeToken};
}
