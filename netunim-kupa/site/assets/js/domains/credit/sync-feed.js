import {todayISO} from '../../core/dates.js';

export const CREDIT_SYNC_VERSION=4;
export const CREDIT_CONNECTOR_CONTRACT_VERSION=2;
export const CREDIT_PROVIDER_LABELS={visaCal:'כאל',max:'MAX',isracard:'ישראכרט',amex:'American Express'};

function text(value,max=240){return String(value??'').trim().replace(/\s+/g,' ').slice(0,max)}
function finite(value){if(value===null||value===undefined||value==='')return null;const n=Number(value);return Number.isFinite(n)?n:null}
function nonNegativeMoney(value){const n=finite(value);return n!==null&&n>=0?Math.round(n*100)/100:null}
function iso(value){if(!value)return null;const d=new Date(value);return Number.isFinite(d.getTime())?d.toISOString():null}
function safeCreditErrorMessage(value){const raw=String(value??'').trim(),secretField=new RegExp(`\\b${['pass','word'].join('')}\\b\\s*[:=]`,'i');if(/fetch(?:Post|Get)WithinPage|<!DOCTYPE|<html|\b(?:Sisma|MisparZihuy|cardSuffix|KodMishtamesh|extraHeaders)\b/i.test(raw)||secretField.test(raw))return 'חברת האשראי החזירה תשובה טכנית שלא ניתן להציג בבטחה. נסה שוב לאחר עדכון ה‑Bank Bridge או השתמש ברענון עם חלון אבחון.';return text(raw||'סנכרון האשראי נכשל',260)}
function creditErrorComponent(error={}){const given=String(error.component||'');if(['core_transactions','forecast_transactions','pending','frames','profile'].includes(given))return given;if(error.tier==='core')return 'core_transactions';if(error.tier==='forecast'||error.code==='CREDIT_PARTIAL_FORECAST')return 'forecast_transactions';if(error.stage==='Frames')return 'frames';if(error.stage==='Pending')return 'pending';return 'profile'}
function creditErrorSeverity(error={}){const given=String(error.severity||'');if(['error','warning','deferred','info'].includes(given))return given;if(error.deferred===true||['CREDIT_AUTOMATION_BLOCKED','CREDIT_PROVIDER_RATE_LIMITED'].includes(String(error.code||'')))return 'deferred';return ['forecast_transactions','pending','frames'].includes(creditErrorComponent(error))?'warning':'error'}
function normalizeInstallments(value){const number=Math.trunc(Number(value?.number)),total=Math.trunc(Number(value?.total));return number>0&&total>0?{number,total}:null}
export function creditCardMappingKey(profileId,accountNumber){return `${text(profileId,80)}:${text(accountNumber,80)}`}

export function normalizeCreditTransaction(txn={}){
  const charged=finite(txn.chargedAmount),original=finite(txn.originalAmount);
  return {
    id:text(txn.id||txn.identifier||'',120),
    type:text(txn.type||'normal',30)||'normal',
    date:iso(txn.date),
    processedDate:iso(txn.processedDate),
    transactionDate:iso(txn.transactionDate),
    originalAmount:original,
    originalCurrency:text(txn.originalCurrency||'',12),
    chargedAmount:charged,
    chargedCurrency:text(txn.chargedCurrency||txn.originalCurrency||'ILS',12)||'ILS',
    description:text(txn.description||'עסקת אשראי',220)||'עסקת אשראי',
    memo:text(txn.memo||'',260),
    installments:normalizeInstallments(txn.installments),
    status:['pending','completed'].includes(String(txn.status))?String(txn.status):'completed',
  };
}

function transactionMonth(tx){const value=tx?.processedDate||tx?.date;return /^\d{4}-\d{2}/.test(String(value||''))?String(value).slice(0,7):''}
function normalizeCreditMonthSlice(slice={}){
  const month=/^\d{4}-(?:0[1-9]|1[0-2])$/.test(String(slice.month||''))?String(slice.month):'',fetchStatus=['success','provider_error','schema_error','network_error'].includes(String(slice.fetchStatus))?String(slice.fetchStatus):slice.status==='fresh'?'success':'provider_error',status=['fresh','stale','missing'].includes(String(slice.status))?String(slice.status):fetchStatus==='success'?'fresh':'missing';
  return {month,tier:slice.tier==='forecast'?'forecast':'core',status,fetchStatus,fetchedAt:iso(slice.fetchedAt),transactions:(Array.isArray(slice.transactions)?slice.transactions:[]).map(normalizeCreditTransaction),providerSchemaVersion:text(slice.providerSchemaVersion||'',80),lastErrorCode:fetchStatus==='success'?'':text(slice.lastErrorCode||'CREDIT_PROVIDER_DATA_ERROR',80),lastErrorAt:fetchStatus==='success'?null:iso(slice.lastErrorAt)};
}
function legacyMonthSlices(txns,fetchedAt){const groups=new Map(),unassigned=[];for(const tx of txns){const key=transactionMonth(tx);if(!key){unassigned.push(tx);continue}if(!groups.has(key))groups.set(key,[]);groups.get(key).push(tx)}return {months:[...groups.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([month,transactions])=>({month,tier:'core',status:'stale',fetchStatus:'success',fetchedAt,transactions,providerSchemaVersion:'legacy-credit-feed',lastErrorCode:'',lastErrorAt:null})),unassigned}}
function withAccountTransactions(account,txns){account.txns=txns;Object.defineProperty(account,'toJSON',{value(){const serialized={};for(const [key,value] of Object.entries(this))if(key!=='txns')serialized[key]=value;return serialized},configurable:true,enumerable:false});return account}

export function normalizeCreditAccount(account={},fallbackFetchedAt=null){
  const legacyTxns=(Array.isArray(account.txns)?account.txns:[]).map(normalizeCreditTransaction).filter(tx=>tx.date||tx.processedDate||tx.id),legacyPending=legacyTxns.filter(tx=>tx.status==='pending'&&!tx.processedDate),hasMonthly=Array.isArray(account.months)&&account.months.length>0,legacy=hasMonthly?{months:[],unassigned:[]}:legacyMonthSlices(legacyTxns.filter(tx=>!legacyPending.includes(tx)),iso(fallbackFetchedAt)),months=(hasMonthly?account.months:legacy.months).map(normalizeCreditMonthSlice).filter(slice=>slice.month),pendingTransactions=(Array.isArray(account.pendingTransactions)?account.pendingTransactions:legacyPending).map(normalizeCreditTransaction),unassignedTransactions=(Array.isArray(account.unassignedTransactions)?account.unassignedTransactions:legacy.unassigned).map(normalizeCreditTransaction);
  const txns=[...months.flatMap(slice=>slice.transactions),...pendingTransactions,...unassignedTransactions].filter(tx=>tx.date||tx.processedDate||tx.id),balance=finite(account.balance),cardFrame=finite(account.cardFrame),availableCredit=finite(account.availableCredit),framePresent=cardFrame!==null||balance!==null||availableCredit!==null,frameStatus=['fresh','stale','missing'].includes(String(account.frameStatus))?String(account.frameStatus):framePresent?'fresh':'missing';
  const seen=new Set();
  const result={
    accountNumber:text(account.accountNumber||'',80),
    balance,
    balanceDate:iso(account.balanceDate),
    cardType:text(account.cardType||'',80),
    cardFrame,
    availableCredit,
    frameStatus,
    frameFetchStatus:['success','unavailable','provider_error','schema_error','network_error'].includes(String(account.frameFetchStatus))?String(account.frameFetchStatus):(frameStatus==='fresh'?'success':'unavailable'),
    frameFetchedAt:iso(account.frameFetchedAt||(frameStatus==='fresh'?fallbackFetchedAt:null)),frameErrorCode:text(account.frameErrorCode||'',80),frameErrorAt:iso(account.frameErrorAt),
    months,pendingTransactions,pendingStatus:['success','provider_error','schema_error','network_error'].includes(String(account.pendingStatus))?String(account.pendingStatus):pendingTransactions.length?'success':'missing',pendingFetchedAt:iso(account.pendingFetchedAt),pendingErrorCode:text(account.pendingErrorCode||'',80),pendingErrorAt:iso(account.pendingErrorAt),unassignedTransactions,
  };
  return withAccountTransactions(result,txns.filter(tx=>{if(!tx.id)return true;const key=`${tx.id}|${tx.date}|${tx.processedDate}|${tx.chargedAmount}|${tx.description}|${tx.installments?.number||0}`;if(seen.has(key))return false;seen.add(key);return true}).sort((a,b)=>String(b.processedDate||b.date||'').localeCompare(String(a.processedDate||a.date||''))));
}

export function normalizeCreditProfile(profile={}){
  const provider=Object.prototype.hasOwnProperty.call(CREDIT_PROVIDER_LABELS,profile.provider)?profile.provider:'';
  return {
    profileId:text(profile.profileId||'',80),provider,
    label:text(profile.label||CREDIT_PROVIDER_LABELS[provider]||'חיבור אשראי',100),
    ownerLabel:text(profile.ownerLabel||'',100),
    defaultAccount:profile.defaultAccount==='ביתי'?'ביתי':'עסקי',
    syncedAt:iso(profile.syncedAt),attemptedAt:iso(profile.attemptedAt),coreComplete:profile.coreComplete===false?false:profile.coreComplete===true?true:null,
    accounts:(Array.isArray(profile.accounts)?profile.accounts:[]).map(account=>normalizeCreditAccount(account,profile.syncedAt)).filter(x=>x.accountNumber||x.txns.length),
  };
}

function normalizedMapping(raw={},legacyInclude=false){
  return {
    included:typeof raw.included==='boolean'?raw.included:legacyInclude,
    hidden:raw.hidden===true,
    account:raw.account==='ביתי'?'ביתי':'עסקי',
    cardName:text(raw.cardName||'',100),
    manualFrame:nonNegativeMoney(raw.manualFrame),
  };
}

export function normalizeCreditSync(value={}){
  const source=value&&typeof value==='object'&&!Array.isArray(value)?value:{},sourceVersion=Math.trunc(Number(source.version)||1),legacyInclude=sourceVersion<2;
  const profiles=(Array.isArray(source.profiles)?source.profiles:[]).map(normalizeCreditProfile).filter(x=>x.profileId);
  const mappings={};
  for(const [key,raw] of Object.entries(source.cardMappings&&typeof source.cardMappings==='object'&&!Array.isArray(source.cardMappings)?source.cardMappings:{})){
    if(!key||!raw||typeof raw!=='object'||Array.isArray(raw))continue;
    mappings[text(key,180)]=normalizedMapping(raw,legacyInclude);
  }
  // v1 treated every discovered card as active. Preserve that behavior once. v2/v3 cards remain explicit opt-in.
  if(legacyInclude){
    for(const profile of profiles)for(const account of profile.accounts){
      const key=creditCardMappingKey(profile.profileId,account.accountNumber);
      if(!mappings[key])mappings[key]={included:true,hidden:false,account:profile.defaultAccount,cardName:'',manualFrame:null};
    }
  }
  return {
    version:CREDIT_SYNC_VERSION,contractVersion:Math.max(1,Math.trunc(Number(source.contractVersion)||1)),correlationId:text(source.correlationId||'',80),
    // Kept as a compatibility marker only. From v3 the issuer feed is always active and manual rows are additive.
    mode:'synced',
    syncedAt:iso(source.syncedAt),
    profiles,
    errors:(Array.isArray(source.errors)?source.errors:[]).slice(0,40).map(e=>({profileId:text(e?.profileId||'',80),provider:text(e?.provider||'',30),label:text(e?.label||'',100),code:text(e?.code||'CREDIT_SCRAPE_FAILED',80),stage:text(e?.stage||'',80),component:creditErrorComponent(e),severity:creditErrorSeverity(e),httpStatus:Math.max(0,Math.trunc(Number(e?.httpStatus)||0)),message:safeCreditErrorMessage(e?.message),at:iso(e?.at)||new Date().toISOString(),originalFailureAt:iso(e?.originalFailureAt||e?.at),retryAfterAt:iso(e?.retryAfterAt),deferred:e?.deferred===true,month:/^\d{4}-\d{2}$/.test(String(e?.month||''))?String(e.month):'',tier:e?.tier==='forecast'?'forecast':e?.tier==='core'?'core':'',accountSuffix:text(e?.accountSuffix||'',4),correlationId:text(e?.correlationId||source.correlationId||'',80),diagnosticFingerprint:text(e?.diagnosticFingerprint||'',32)})),
    cardMappings:mappings,
  };
}

export function mergeCreditSyncResult(current,payload={}){
  const base=normalizeCreditSync(current),successes=(Array.isArray(payload.profiles)?payload.profiles:[]).map(normalizeCreditProfile).filter(x=>x.profileId);
  const byId=new Map(base.profiles.map(p=>[p.profileId,p]));
  function mergeAccount(previous,incoming){
    if(!previous)return incoming;const old=normalizeCreditAccount(previous),next=normalizeCreditAccount(incoming),monthMap=new Map(old.months.map(slice=>[slice.month,slice]));
    for(const slice of next.months){const prior=monthMap.get(slice.month);if(slice.fetchStatus==='success')monthMap.set(slice.month,{...slice,status:'fresh'});else if(prior?.fetchedAt)monthMap.set(slice.month,{...prior,status:'stale',fetchStatus:slice.fetchStatus,lastErrorCode:slice.lastErrorCode,lastErrorAt:slice.lastErrorAt});else monthMap.set(slice.month,{...slice,status:'missing'})}
    const pendingOk=next.pendingStatus==='success',pendingTransactions=pendingOk?next.pendingTransactions:old.pendingTransactions,pendingStatus=pendingOk?'success':next.pendingStatus,pendingFetchedAt=pendingOk?next.pendingFetchedAt:old.pendingFetchedAt,frameOk=next.frameFetchStatus==='success',hadFrame=old.frameFetchedAt||old.balance!==null||old.cardFrame!==null||old.availableCredit!==null;
    return normalizeCreditAccount({...old,...next,balance:frameOk?next.balance:old.balance,balanceDate:frameOk?next.balanceDate:old.balanceDate,cardType:frameOk?(next.cardType||old.cardType):old.cardType,cardFrame:frameOk?next.cardFrame:old.cardFrame,availableCredit:frameOk?next.availableCredit:old.availableCredit,frameStatus:frameOk?'fresh':hadFrame?'stale':'missing',frameFetchStatus:next.frameFetchStatus,frameFetchedAt:frameOk?next.frameFetchedAt:old.frameFetchedAt,frameErrorCode:frameOk?'':next.frameErrorCode,frameErrorAt:frameOk?null:next.frameErrorAt,months:[...monthMap.values()],pendingTransactions,pendingStatus,pendingFetchedAt,pendingErrorCode:pendingOk?'':next.pendingErrorCode,pendingErrorAt:pendingOk?null:next.pendingErrorAt,unassignedTransactions:next.unassignedTransactions.length?next.unassignedTransactions:old.unassignedTransactions});
  }
  function preserveCoreLastKnownGood(previous,incoming){
    const attempts=new Map(incoming.accounts.map(account=>[account.accountNumber,account]));
    const accounts=previous.accounts.map(account=>{const attempt=attempts.get(account.accountNumber);if(!attempt)return account;const old=normalizeCreditAccount(account),monthMap=new Map(old.months.map(slice=>[slice.month,slice]));for(const slice of attempt.months){if(slice.fetchStatus==='success')continue;const prior=monthMap.get(slice.month);monthMap.set(slice.month,prior?.fetchedAt?{...prior,status:'stale',fetchStatus:slice.fetchStatus,lastErrorCode:slice.lastErrorCode,lastErrorAt:slice.lastErrorAt}:{...slice,status:'missing'})}const frameFailed=attempt.frameFetchStatus&&attempt.frameFetchStatus!=='success';return normalizeCreditAccount({...old,frameStatus:frameFailed?(old.frameFetchedAt||old.balance!==null||old.cardFrame!==null||old.availableCredit!==null?'stale':'missing'):old.frameStatus,frameFetchStatus:frameFailed?attempt.frameFetchStatus:old.frameFetchStatus,frameErrorCode:frameFailed?attempt.frameErrorCode:old.frameErrorCode,frameErrorAt:frameFailed?attempt.frameErrorAt:old.frameErrorAt,months:[...monthMap.values()]})});
    return normalizeCreditProfile({...previous,attemptedAt:incoming.attemptedAt,coreComplete:false,accounts});
  }
  successes.forEach(incoming=>{const previous=byId.get(incoming.profileId);if(previous&&incoming.coreComplete===false){byId.set(incoming.profileId,preserveCoreLastKnownGood(previous,incoming));return}const accounts=new Map((previous?.accounts||[]).map(account=>[account.accountNumber,account]));for(const account of incoming.accounts)accounts.set(account.accountNumber,mergeAccount(accounts.get(account.accountNumber),account));byId.set(incoming.profileId,normalizeCreditProfile({...previous,...incoming,syncedAt:incoming.syncedAt||previous?.syncedAt||null,accounts:[...accounts.values()]}))});
  const mappings={...base.cardMappings};
  for(const profile of successes)for(const account of profile.accounts){
    const key=creditCardMappingKey(profile.profileId,account.accountNumber);
    if(!mappings[key])mappings[key]={included:false,hidden:false,account:profile.defaultAccount,cardName:'',manualFrame:null};
  }
  const errors=(Array.isArray(payload.errors)?payload.errors:[]).map(e=>({profileId:text(e?.profileId||'',80),provider:text(e?.provider||'',30),label:text(e?.label||'',100),code:text(e?.code||'CREDIT_SCRAPE_FAILED',80),stage:text(e?.stage||'',80),component:creditErrorComponent(e),severity:creditErrorSeverity(e),httpStatus:Math.max(0,Math.trunc(Number(e?.httpStatus)||0)),message:safeCreditErrorMessage(e?.message),at:iso(e?.at)||new Date().toISOString(),originalFailureAt:iso(e?.originalFailureAt||e?.at),retryAfterAt:iso(e?.retryAfterAt),deferred:e?.deferred===true,month:/^\d{4}-\d{2}$/.test(String(e?.month||''))?String(e.month):'',tier:e?.tier==='forecast'?'forecast':e?.tier==='core'?'core':'',accountSuffix:text(e?.accountSuffix||'',4),correlationId:text(e?.correlationId||payload.correlationId||'',80),diagnosticFingerprint:text(e?.diagnosticFingerprint||'',32)}));
  return normalizeCreditSync({...base,contractVersion:payload.contractVersion||base.contractVersion,correlationId:payload.correlationId||base.correlationId,syncedAt:payload.syncedAt?iso(payload.syncedAt):base.syncedAt,profiles:[...byId.values()],errors,cardMappings:mappings});
}

export function creditSyncHasData(state){return !!normalizeCreditSync(state?.creditSync).profiles.some(p=>p.accounts.some(a=>a.txns.length||a.balance!==null||a.cardFrame!==null||a.availableCredit!==null))}
export function creditSyncHasIncludedCards(state){const sync=normalizeCreditSync(state?.creditSync);return sync.profiles.some(p=>p.accounts.some(a=>sync.cardMappings[creditCardMappingKey(p.profileId,a.accountNumber)]?.included===true))}
export function creditCardIncluded(sync,profileId,accountNumber){return normalizeCreditSync(sync).cardMappings[creditCardMappingKey(profileId,accountNumber)]?.included===true}
export function creditCardHidden(sync,profileId,accountNumber){return normalizeCreditSync(sync).cardMappings[creditCardMappingKey(profileId,accountNumber)]?.hidden===true}
export function creditSyncScrapeSelection(value={}){
  const sync=normalizeCreditSync(value),rows=[];
  for(const profile of sync.profiles){const excludedAccounts=profile.accounts.map(account=>account.accountNumber).filter(accountNumber=>sync.cardMappings[creditCardMappingKey(profile.profileId,accountNumber)]?.included===false);if(excludedAccounts.length)rows.push({profileId:profile.profileId,excludedAccounts})}
  return rows;
}

function transactionForecastAmount(tx){
  const amount=tx.chargedAmount!==null?tx.chargedAmount:tx.originalAmount;
  if(amount===null||!Number.isFinite(amount)||amount===0)return 0;
  return -amount;
}
// Foreign-currency rows stay visible in issuer data but never silently enter ILS Kupa totals.
function isShekelTransaction(tx){
  const currency=text(tx.chargedCurrency||tx.originalCurrency||'ILS',12).toUpperCase().replace(/\s+/g,'');
  return !currency||['ILS','NIS','₪','ש״ח','שח'].includes(currency);
}
function creditChargeDate(tx){return String(tx?.processedDate||tx?.date||'').slice(0,10)}
function knownFutureChargeAmount(tx){if(tx?.status==='pending'||!isShekelTransaction(tx))return 0;return transactionForecastAmount(tx)}
export function creditKnownFutureCommitment(account={},asOf=todayISO()){
  let total=0;
  for(const tx of Array.isArray(account?.txns)?account.txns:[]){const date=creditChargeDate(tx),amount=knownFutureChargeAmount(tx);if(date&&date>=asOf&&amount)total+=amount}
  return Math.round(total*100)/100;
}
export function creditUpcomingCharge(account={},provider='',asOf=todayISO()){
  const byDate=new Map();
  for(const tx of Array.isArray(account?.txns)?account.txns:[]){const date=creditChargeDate(tx),amount=knownFutureChargeAmount(tx);if(!date||date<asOf||!amount)continue;byDate.set(date,(byDate.get(date)||0)+amount)}
  for(const date of [...byDate.keys()].sort()){const amount=Math.round((byDate.get(date)||0)*100)/100;if(amount>0.004)return {amount,date,source:'transactions'}}
  // Visa Cal defines account.balance as the next debit. MAX uses balance for utilized credit instead, so it must never be relabeled as an upcoming debit.
  if(provider==='visaCal'){const raw=finite(account?.balance);if(raw!==null)return {amount:Math.round(Math.abs(raw)*100)/100,date:String(account?.balanceDate||'').slice(0,10),source:'issuer_balance'}}
  return null;
}
export function creditFrameStatus(account={},mapping={},asOf=todayISO()){
  const issuerFrame=finite(account?.cardFrame),directAvailable=finite(account?.availableCredit),manualFrame=nonNegativeMoney(mapping?.manualFrame),commitments=creditKnownFutureCommitment(account,asOf);
  if(directAvailable!==null)return {frame:issuerFrame,available:Math.round(directAvailable*100)/100,commitments,source:'issuer_available',frameSource:issuerFrame!==null?'issuer':null};
  const frame=issuerFrame!==null?issuerFrame:manualFrame;
  if(frame===null)return {frame:null,available:null,commitments,source:'unavailable',frameSource:null};
  return {frame,available:Math.round((frame-commitments)*100)/100,commitments,source:issuerFrame!==null?'issuer_frame_calculated':'manual_frame_calculated',frameSource:issuerFrame!==null?'issuer':'manual'};
}
function accountPresentation(profile,account,mapping={}){
  const accountClass=mapping.account==='ביתי'?'ביתי':mapping.account==='עסקי'?'עסקי':profile.defaultAccount;
  const cardName=mapping.cardName||[CREDIT_PROVIDER_LABELS[profile.provider]||profile.label,account.accountNumber?`••${String(account.accountNumber).slice(-4)}`:''].filter(Boolean).join(' ');
  return {accountClass,cardName:cardName||'כרטיס אשראי',ownerLabel:profile.ownerLabel||'',hidden:mapping.hidden===true};
}
function synchronizedCardKey(profile,account){return `sync:${profile.profileId}:${account.accountNumber}`}

export function syncedInstallmentsData(state){
  const sync=normalizeCreditSync(state?.creditSync),rows=[],seen=new Set();
  for(const profile of sync.profiles){
    for(const account of profile.accounts){
      const mapping=sync.cardMappings[creditCardMappingKey(profile.profileId,account.accountNumber)]||{};
      if(mapping.included!==true)continue;
      const presentation=accountPresentation(profile,account,mapping);
      for(const [txIndex,tx] of account.txns.entries()){
        if(tx.status==='pending')continue;
        const date=String(tx.processedDate||tx.date||'').slice(0,10),amount=transactionForecastAmount(tx);
        if(!date||!amount||!isShekelTransaction(tx))continue;
        const part=tx.installments?.number||1,totalParts=tx.installments?.total||1;
        const stableId=tx.id?`${tx.id}|${date}|${amount}|${tx.description}|${part}`:`idless-${txIndex}|${date}|${amount}|${tx.description}|${part}`;
        const identity=`${profile.profileId}|${account.accountNumber}|${stableId}`;
        if(seen.has(identity))continue;seen.add(identity);
        rows.push({creditId:`SYNC:${identity}`,creditAccountKey:synchronizedCardKey(profile,account),date,amount,part,totalParts,card:presentation.cardName,account:presentation.accountClass,ownerLabel:presentation.ownerLabel,hidden:presentation.hidden,description:tx.description,source:'credit_sync',profileId:profile.profileId,accountNumber:account.accountNumber,provider:profile.provider,status:tx.status});
      }
    }
  }
  return rows.sort((a,b)=>a.date.localeCompare(b.date)||String(a.card).localeCompare(String(b.card)));
}

function shiftMonthDate(value,delta){
  const raw=String(value||'').slice(0,10);if(!raw)return '';
  const [y,m,d]=raw.split('-').map(Number);if(!y||!m||!d)return raw;
  const first=new Date(Date.UTC(y,m-1+delta,1)),last=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
  first.setUTCDate(Math.min(d,last));return first.toISOString().slice(0,10);
}
function transactionOriginDate(tx){
  const explicit=String(tx?.transactionDate||'').slice(0,10);if(explicit)return explicit;
  const part=tx?.installments?.number||1;return shiftMonthDate(tx?.date||tx?.processedDate||'',-(part-1));
}
function syncedSeriesKey(profile,account,tx,index){
  const part=tx.installments?.number||1,total=tx.installments?.total||1,originDate=transactionOriginDate(tx);
  if(total>1){
    const baseId=text(tx.id||'',120).replace(new RegExp(`_${part}$`),'');
    if(baseId)return `${profile.profileId}|${account.accountNumber}|installment|${baseId}|${total}|${originDate}`;
    return `${profile.profileId}|${account.accountNumber}|installment|${text(tx.description,160)}|${total}|${originDate}`;
  }
  return `${profile.profileId}|${account.accountNumber}|single|${tx.id||`idless-${index}`}|${String(tx.date||tx.processedDate||'').slice(0,10)}|${text(tx.description,160)}`;
}

// Converts normalized issuer rows into purchase/series rows for the detailed credit table.
// Progress is based only on explicit installment numbers and issuer charge dates; missing future rows are flagged instead of invented.
export function syncedCreditSeries(state,asOf=todayISO()){
  const sync=normalizeCreditSync(state?.creditSync),groups=new Map();
  for(const profile of sync.profiles)for(const account of profile.accounts){
    const mapping=sync.cardMappings[creditCardMappingKey(profile.profileId,account.accountNumber)]||{};
    if(mapping.included!==true||mapping.hidden===true)continue;
    const presentation=accountPresentation(profile,account,mapping);
    for(const [index,tx] of account.txns.entries()){
      if(tx.status==='pending'||!isShekelTransaction(tx))continue;
      const chargeDate=String(tx.processedDate||tx.date||'').slice(0,10),amount=transactionForecastAmount(tx);
      if(!chargeDate||!amount)continue;
      const part=tx.installments?.number||1,totalParts=tx.installments?.total||1,key=syncedSeriesKey(profile,account,tx,index),transactionDate=transactionOriginDate(tx);
      if(!groups.has(key))groups.set(key,{id:key,source:'credit_sync',profileId:profile.profileId,provider:profile.provider,accountNumber:account.accountNumber,ownerLabel:presentation.ownerLabel,account:presentation.accountClass,card:presentation.cardName,description:tx.description,totalParts,items:[],originalCandidates:[]});
      const group=groups.get(key);group.totalParts=Math.max(group.totalParts,totalParts);group.items.push({date:chargeDate,amount,part,totalParts,transactionDate});
      const original=finite(tx.originalAmount);if(original!==null&&original!==0)group.originalCandidates.push(-original);
    }
  }
  const result=[];
  for(const group of groups.values()){
    group.items.sort((a,b)=>a.part-b.part||a.date.localeCompare(b.date));
    const uniqueParts=new Map();for(const item of group.items){const old=uniqueParts.get(item.part);if(!old||item.date>old.date)uniqueParts.set(item.part,item)}
    const items=[...uniqueParts.values()].sort((a,b)=>a.part-b.part||a.date.localeCompare(b.date));
    const next=items.filter(x=>x.date>=asOf).sort((a,b)=>a.date.localeCompare(b.date)||a.part-b.part)[0]||null;
    const maxPastPart=items.filter(x=>x.date<asOf).reduce((m,x)=>Math.max(m,x.part),0);
    const maxKnownPart=items.reduce((m,x)=>Math.max(m,x.part),0);
    const completedCount=Math.min(group.totalParts,next?Math.max(maxPastPart,next.part-1):maxKnownPart);
    const remainingCount=Math.max(0,group.totalParts-completedCount),futureItems=items.filter(x=>x.date>=asOf);
    const remainingAmount=futureItems.reduce((sum,x)=>sum+x.amount,0),knownTotal=items.reduce((sum,x)=>sum+x.amount,0);
    const originalTotal=group.originalCandidates.find(v=>Number.isFinite(v)&&Math.abs(v)>=Math.abs(knownTotal)-0.01);
    const totalAmount=originalTotal??knownTotal,lastChargeDate=items.reduce((latest,item)=>item.date>latest?item.date:latest,''),transactionDate=items.map(item=>item.transactionDate).filter(Boolean).sort()[0]||'';
    const partial=remainingCount>futureItems.length;
    result.push({...group,items,totalAmount,transactionDate,completedCount,remainingCount,next,remainingAmount,lastChargeDate,partial,complete:remainingCount===0});
  }
  return result.sort((a,b)=>{
    const an=a.next?.date||'9999-12-31',bn=b.next?.date||'9999-12-31';return an.localeCompare(bn)||String(a.card).localeCompare(String(b.card),'he')||String(a.description).localeCompare(String(b.description),'he');
  });
}

export function creditSyncSummary(state){
  const sync=normalizeCreditSync(state?.creditSync),today=todayISO(),accounts=sync.profiles.flatMap(p=>p.accounts.map(a=>({profile:p,account:a}))),txns=accounts.reduce((n,x)=>n+x.account.txns.length,0);
  const included=accounts.filter(x=>sync.cardMappings[creditCardMappingKey(x.profile.profileId,x.account.accountNumber)]?.included===true),hiddenAccountCount=accounts.filter(x=>sync.cardMappings[creditCardMappingKey(x.profile.profileId,x.account.accountNumber)]?.hidden===true).length;
  const availability=included.map(x=>creditFrameStatus(x.account,sync.cardMappings[creditCardMappingKey(x.profile.profileId,x.account.accountNumber)]||{},today)),known=availability.filter(x=>x.available!==null);
  const slices=accounts.flatMap(x=>x.account.months),freshMonthCount=slices.filter(slice=>slice.status==='fresh').length,staleMonthCount=slices.filter(slice=>slice.status==='stale').length,missingMonthCount=slices.filter(slice=>slice.status==='missing').length;
  return {sync,profileCount:sync.profiles.length,accountCount:accounts.length,includedAccountCount:included.length,hiddenAccountCount,transactionCount:txns,availableCreditTotal:Math.round(known.reduce((sum,x)=>sum+x.available,0)*100)/100,availableCreditKnownCount:known.length,availableCreditUnknownCount:availability.length-known.length,freshMonthCount,staleMonthCount,missingMonthCount,hasCoverageGaps:staleMonthCount+missingMonthCount>0,hasData:accounts.some(x=>x.account.txns.length||x.account.balance!==null||x.account.cardFrame!==null||x.account.availableCredit!==null),today};
}
