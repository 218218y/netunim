import {todayISO} from '../../core/dates.js';
import {creditAccountKnownFutureCommitmentData,creditAccountUpcomingChargeData,creditBillingRowsData,creditPendingAuthorizationTotalData} from '../../shared/credit-billing-cycles.js';

import {creditHistoryCutoffMonth,creditCardSortOrder} from '../../shared/credit-history.js';

export const CREDIT_SYNC_VERSION=4;
export const CREDIT_CONNECTOR_CONTRACT_VERSION=2;
export const CREDIT_PROVIDER_LABELS={visaCal:'כאל',max:'MAX',isracard:'ישראכרט',amex:'American Express'};

function text(value,max=240){return String(value??'').trim().replace(/\s+/g,' ').slice(0,max)}
function finite(value){if(value===null||value===undefined||value==='')return null;const n=Number(value);return Number.isFinite(n)?n:null}
function nonNegativeMoney(value){const n=finite(value);return n!==null&&n>=0?Math.round(n*100)/100:null}
function iso(value){if(!value)return null;const d=new Date(value);return Number.isFinite(d.getTime())?d.toISOString():null}
function transactionTime(value){const match=/^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(value??'').trim());if(!match)return '';const hour=Number(match[1]),minute=Number(match[2]);return hour>=0&&hour<=23&&minute>=0&&minute<=59?`${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`:''}
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
    transactionTime:transactionTime(txn.transactionTime),
    originalAmount:original,
    originalCurrency:text(txn.originalCurrency||'',12),
    chargedAmount:charged,
    ...(['reported','missing','not_billed'].includes(txn.chargeAmountStatus)?{chargeAmountStatus:txn.chargeAmountStatus}:{}),
    chargedCurrency:text(txn.chargedCurrency||txn.originalCurrency||'ILS',12)||'ILS',
    foreignTransaction:txn.foreignTransaction===true,
    description:text(txn.description||'עסקת אשראי',220)||'עסקת אשראי',
    memo:text(txn.memo||'',260),
    category:text(txn.category||'',160)||undefined,
    installments:normalizeInstallments(txn.installments),
    status:['pending','completed'].includes(String(txn.status))?String(txn.status):'completed',
  };
}

function transactionMonth(tx){const value=tx?.processedDate;return /^\d{4}-\d{2}/.test(String(value||''))?String(value).slice(0,7):''}
function dedupeCreditTransactions(values=[]){const rows=[],seen=new Set();for(const value of Array.isArray(values)?values:[]){const tx=normalizeCreditTransaction(value);if(!tx.id){rows.push(tx);continue}const key=JSON.stringify([tx.id,tx.status,tx.type,tx.date,tx.processedDate,tx.transactionDate,tx.transactionTime,tx.originalAmount,tx.originalCurrency,tx.chargedAmount,tx.chargedCurrency,tx.foreignTransaction,tx.description,tx.memo,tx.installments?.number??null,tx.installments?.total??null]);if(seen.has(key))continue;seen.add(key);rows.push(tx)}return rows}
function normalizeCreditMonthSlice(slice={}){
  const month=/^\d{4}-(?:0[1-9]|1[0-2])$/.test(String(slice.month||''))?String(slice.month):'',fetchStatus=['success','provider_error','schema_error','network_error'].includes(String(slice.fetchStatus))?String(slice.fetchStatus):slice.status==='fresh'?'success':'provider_error',status=['fresh','stale','missing'].includes(String(slice.status))?String(slice.status):fetchStatus==='success'?'fresh':'missing';
  return {month,tier:slice.tier==='forecast'?'forecast':'core',status,fetchStatus,fetchedAt:iso(slice.fetchedAt),transactions:dedupeCreditTransactions(slice.transactions),providerSchemaVersion:text(slice.providerSchemaVersion||'',80),lastErrorCode:fetchStatus==='success'?'':text(slice.lastErrorCode||'CREDIT_PROVIDER_DATA_ERROR',80),lastErrorAt:fetchStatus==='success'?null:iso(slice.lastErrorAt)};
}
function legacyMonthSlices(txns,fetchedAt){const groups=new Map(),unassigned=[];for(const tx of txns){const key=transactionMonth(tx);if(!key){unassigned.push(tx);continue}if(!groups.has(key))groups.set(key,[]);groups.get(key).push(tx)}return {months:[...groups.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([month,transactions])=>({month,tier:'core',status:'stale',fetchStatus:'success',fetchedAt,transactions,providerSchemaVersion:'legacy-credit-feed',lastErrorCode:'',lastErrorAt:null})),unassigned}}
function withAccountTransactions(account,txns){account.txns=txns;Object.defineProperty(account,'toJSON',{value(){const serialized={};for(const [key,value] of Object.entries(this))if(key!=='txns')serialized[key]=value;return serialized},configurable:true,enumerable:false});return account}

export function normalizeCreditAccount(account={},fallbackFetchedAt=null){
  const legacyTxns=dedupeCreditTransactions(account.txns).filter(tx=>tx.date||tx.processedDate||tx.id),legacyPending=legacyTxns.filter(tx=>tx.status==='pending'),hasMonthly=Array.isArray(account.months)&&account.months.length>0,legacy=hasMonthly?{months:[],unassigned:[]}:legacyMonthSlices(legacyTxns.filter(tx=>tx.status!=='pending'),iso(fallbackFetchedAt)),months=(hasMonthly?account.months:legacy.months).map(normalizeCreditMonthSlice).filter(slice=>slice.month),pendingTransactions=dedupeCreditTransactions(Array.isArray(account.pendingTransactions)?account.pendingTransactions:legacyPending),unassignedTransactions=dedupeCreditTransactions(Array.isArray(account.unassignedTransactions)?account.unassignedTransactions:legacy.unassigned);
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
    manualFrame:nonNegativeMoney(raw.manualFrame),sortOrder:creditCardSortOrder(raw.sortOrder),
  };
}
function normalizeSettlementWarningAcks(value={}){
  const source=value&&typeof value==='object'&&!Array.isArray(value)?value:{},rows=[];
  for(const [rawKey,rawAt] of Object.entries(source)){const key=text(rawKey,240),at=iso(rawAt);if(key&&at)rows.push([key,at])}
  rows.sort((a,b)=>b[1].localeCompare(a[1]));
  return Object.fromEntries(rows.slice(0,120));
}

function creditProfileIdentityText(value){return text(value,100).toLocaleLowerCase('he-IL')}
function creditProfileAccountNumbers(profile){return new Set((Array.isArray(profile?.accounts)?profile.accounts:[]).map(account=>text(account?.accountNumber||'',80)).filter(Boolean))}
function creditProfilesShareDiscoveredIdentity(a,b){
  if(!a?.provider||a.provider!==b?.provider)return false;
  const aAccounts=creditProfileAccountNumbers(a),bAccounts=creditProfileAccountNumbers(b);
  if(!aAccounts.size||!bAccounts.size)return false;
  let overlaps=false;for(const accountNumber of aAccounts)if(bAccounts.has(accountNumber)){overlaps=true;break}
  if(!overlaps)return false;
  const aOwner=creditProfileIdentityText(a.ownerLabel),bOwner=creditProfileIdentityText(b.ownerLabel);
  // Card suffixes are not globally unique. Reconcile automatically only when both
  // profiles also carry the same explicit owner label. Missing/different owners stay separate.
  return !!aOwner&&!!bOwner&&aOwner===bOwner;
}
function creditProfileIdPriority(profile){return String(profile?.profileId||'').startsWith('import:')?1:0}
function creditMappingPreference(raw={},defaultAccount='עסקי'){
  let score=0;
  if(raw.included===true)score+=32;
  if(raw.hidden===true)score+=8;
  if(text(raw.cardName||'',100))score+=4;
  if(raw.manualFrame!==null&&raw.manualFrame!==undefined)score+=2;
  if(creditCardSortOrder(raw.sortOrder)!==null)score+=2;
  if(raw.account&&(raw.account==='ביתי'?'ביתי':'עסקי')!==defaultAccount)score+=1;
  return score;
}
function preferredCreditMapping(mappings,profileIds,accountNumber,defaultAccount){
  let best=null,bestScore=-1;
  for(const profileId of profileIds){
    const raw=mappings[creditCardMappingKey(profileId,accountNumber)];if(!raw)continue;
    const score=creditMappingPreference(raw,defaultAccount);
    if(score>bestScore){best=raw;bestScore=score}
  }
  return best?{...best}:null;
}
function newerISO(a,b){const aa=iso(a),bb=iso(b);if(!aa)return bb;if(!bb)return aa;return aa>=bb?aa:bb}
function mergeCreditAccountSnapshot(previous,incoming){
  if(!previous)return normalizeCreditAccount(incoming);
  const old=normalizeCreditAccount(previous),next=normalizeCreditAccount(incoming),monthMap=new Map(old.months.map(slice=>[slice.month,slice]));
  for(const slice of next.months){const prior=monthMap.get(slice.month);if(slice.fetchStatus==='success')monthMap.set(slice.month,{...slice,status:'fresh'});else if(prior?.fetchedAt)monthMap.set(slice.month,{...prior,status:'stale',fetchStatus:slice.fetchStatus,lastErrorCode:slice.lastErrorCode,lastErrorAt:slice.lastErrorAt});else monthMap.set(slice.month,{...slice,status:'missing'})}
  const pendingOk=next.pendingStatus==='success',pendingTransactions=pendingOk?next.pendingTransactions:old.pendingTransactions,pendingStatus=pendingOk?'success':next.pendingStatus,pendingFetchedAt=pendingOk?next.pendingFetchedAt:old.pendingFetchedAt,frameOk=next.frameFetchStatus==='success',hadFrame=old.frameFetchedAt||old.balance!==null||old.cardFrame!==null||old.availableCredit!==null;
  return normalizeCreditAccount({...old,...next,balance:frameOk?next.balance:old.balance,balanceDate:frameOk?next.balanceDate:old.balanceDate,cardType:frameOk?(next.cardType||old.cardType):old.cardType,cardFrame:frameOk?next.cardFrame:old.cardFrame,availableCredit:frameOk?next.availableCredit:old.availableCredit,frameStatus:frameOk?'fresh':hadFrame?'stale':'missing',frameFetchStatus:next.frameFetchStatus,frameFetchedAt:frameOk?next.frameFetchedAt:old.frameFetchedAt,frameErrorCode:frameOk?'':next.frameErrorCode,frameErrorAt:frameOk?null:next.frameErrorAt,months:[...monthMap.values()],pendingTransactions,pendingStatus,pendingFetchedAt,pendingErrorCode:pendingOk?'':next.pendingErrorCode,pendingErrorAt:pendingOk?null:next.pendingErrorAt,unassignedTransactions:next.unassignedTransactions.length?next.unassignedTransactions:old.unassignedTransactions});
}
function collapseCreditProfileAliases(profiles,mappings){
  const rows=Array.isArray(profiles)?profiles:[],parent=rows.map((_,index)=>index);
  const find=index=>{while(parent[index]!==index){parent[index]=parent[parent[index]];index=parent[index]}return index};
  const join=(a,b)=>{a=find(a);b=find(b);if(a!==b)parent[b]=a};
  for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++)if(creditProfilesShareDiscoveredIdentity(rows[i],rows[j]))join(i,j);
  const groups=new Map();for(let i=0;i<rows.length;i++){const root=find(i);if(!groups.has(root))groups.set(root,[]);groups.get(root).push(rows[i])}
  const aliases=new Map(),collapsed=[];
  for(const group of groups.values()){
    if(group.length===1){collapsed.push(group[0]);continue}
    let canonical=group[0];for(const candidate of group.slice(1))if(creditProfileIdPriority(candidate)>creditProfileIdPriority(canonical))canonical=candidate;
    const profileIds=[canonical.profileId,...group.filter(profile=>profile!==canonical).map(profile=>profile.profileId)];
    const ordered=[...group].sort((a,b)=>String(a.syncedAt||'').localeCompare(String(b.syncedAt||''))),accounts=new Map();
    let syncedAt=null,attemptedAt=null,coreComplete=null;
    for(const profile of ordered){
      syncedAt=newerISO(syncedAt,profile.syncedAt);attemptedAt=newerISO(attemptedAt,profile.attemptedAt);
      if(profile.coreComplete===false)coreComplete=false;else if(coreComplete===null&&profile.coreComplete===true)coreComplete=true;
      for(const account of profile.accounts)accounts.set(account.accountNumber,mergeCreditAccountSnapshot(accounts.get(account.accountNumber),account));
    }
    const accountNumbers=new Set(accounts.keys());
    for(const key of Object.keys(mappings))for(const profileId of profileIds){const prefix=`${profileId}:`;if(key.startsWith(prefix))accountNumbers.add(key.slice(prefix.length))}
    const chosenMappings=new Map();for(const accountNumber of accountNumbers){const chosen=preferredCreditMapping(mappings,profileIds,accountNumber,canonical.defaultAccount);if(chosen)chosenMappings.set(accountNumber,chosen)}
    for(const profileId of profileIds){if(profileId!==canonical.profileId)aliases.set(profileId,canonical.profileId);const prefix=`${profileId}:`;for(const key of Object.keys(mappings))if(key.startsWith(prefix))delete mappings[key]}
    for(const [accountNumber,mapping] of chosenMappings)mappings[creditCardMappingKey(canonical.profileId,accountNumber)]=mapping;
    collapsed.push(normalizeCreditProfile({...canonical,syncedAt,attemptedAt,coreComplete,accounts:[...accounts.values()]}));
  }
  return {profiles:collapsed,mappings,aliases};
}

export function normalizeCreditSync(value={}){
  const source=value&&typeof value==='object'&&!Array.isArray(value)?value:{},sourceVersion=Math.trunc(Number(source.version)||1),legacyInclude=sourceVersion<2;
  const rawProfiles=(Array.isArray(source.profiles)?source.profiles:[]).map(normalizeCreditProfile).filter(x=>x.profileId),mappings={};
  for(const [key,raw] of Object.entries(source.cardMappings&&typeof source.cardMappings==='object'&&!Array.isArray(source.cardMappings)?source.cardMappings:{})){
    if(!key||!raw||typeof raw!=='object'||Array.isArray(raw))continue;
    mappings[text(key,180)]=normalizedMapping(raw,legacyInclude);
  }
  // v1 treated every discovered card as active. Preserve that behavior once. v2/v3 cards remain explicit opt-in.
  if(legacyInclude){
    for(const profile of rawProfiles)for(const account of profile.accounts){
      const key=creditCardMappingKey(profile.profileId,account.accountNumber);
      if(!mappings[key])mappings[key]={included:true,hidden:false,account:profile.defaultAccount,cardName:'',manualFrame:null};
    }
  }
  // A copied import can exist under an old random profileId and a stable import:connectionKey.
  // Collapse only identities proven by provider + discovered card overlap + compatible owner,
  // and prefer the portable import identity while carrying forward history and user mappings.
  const reconciled=collapseCreditProfileAliases(rawProfiles,mappings),profiles=reconciled.profiles;
  return {
    version:CREDIT_SYNC_VERSION,contractVersion:Math.max(1,Math.trunc(Number(source.contractVersion)||1)),correlationId:text(source.correlationId||'',80),
    // Kept as a compatibility marker only. From v3 the issuer feed is always active and manual rows are additive.
    mode:'synced',
    syncedAt:iso(source.syncedAt),
    profiles,
    errors:(Array.isArray(source.errors)?source.errors:[]).slice(0,40).map(e=>({profileId:reconciled.aliases.get(text(e?.profileId||'',80))||text(e?.profileId||'',80),provider:text(e?.provider||'',30),browserEngine:['chromium','camoufox'].includes(String(e?.browserEngine||''))?String(e.browserEngine):'',label:text(e?.label||'',100),code:text(e?.code||'CREDIT_SCRAPE_FAILED',80),stage:text(e?.stage||'',80),component:creditErrorComponent(e),severity:creditErrorSeverity(e),httpStatus:Math.max(0,Math.trunc(Number(e?.httpStatus)||0)),message:safeCreditErrorMessage(e?.message),at:iso(e?.at)||new Date().toISOString(),originalFailureAt:iso(e?.originalFailureAt||e?.at),retryAfterAt:iso(e?.retryAfterAt),deferred:e?.deferred===true,month:/^\d{4}-\d{2}$/.test(String(e?.month||''))?String(e.month):'',tier:e?.tier==='forecast'?'forecast':e?.tier==='core'?'core':'',accountSuffix:text(e?.accountSuffix||'',4),correlationId:text(e?.correlationId||source.correlationId||'',80),diagnosticFingerprint:text(e?.diagnosticFingerprint||'',32)})),
    cardMappings:reconciled.mappings,
    settlementWarningAcks:normalizeSettlementWarningAcks(source.settlementWarningAcks),
  };
}

export function mergeCreditSyncResult(current,payload={}){
  const base=normalizeCreditSync(current),mappings={...base.cardMappings},byId=new Map(base.profiles.map(profile=>[profile.profileId,profile])),rawSuccesses=(Array.isArray(payload.profiles)?payload.profiles:[]).map(normalizeCreditProfile).filter(profile=>profile.profileId),successes=[];
  function preserveCoreLastKnownGood(previous,incoming){
    const attempts=new Map(incoming.accounts.map(account=>[account.accountNumber,account]));
    const accounts=previous.accounts.map(account=>{const attempt=attempts.get(account.accountNumber);if(!attempt)return account;const old=normalizeCreditAccount(account),monthMap=new Map(old.months.map(slice=>[slice.month,slice]));for(const slice of attempt.months){if(slice.fetchStatus==='success')continue;const prior=monthMap.get(slice.month);monthMap.set(slice.month,prior?.fetchedAt?{...prior,status:'stale',fetchStatus:slice.fetchStatus,lastErrorCode:slice.lastErrorCode,lastErrorAt:slice.lastErrorAt}:{...slice,status:'missing'})}const frameFailed=attempt.frameFetchStatus&&attempt.frameFetchStatus!=='success';return normalizeCreditAccount({...old,frameStatus:frameFailed?(old.frameFetchedAt||old.balance!==null||old.cardFrame!==null||old.availableCredit!==null?'stale':'missing'):old.frameStatus,frameFetchStatus:frameFailed?attempt.frameFetchStatus:old.frameFetchStatus,frameErrorCode:frameFailed?attempt.frameErrorCode:old.frameErrorCode,frameErrorAt:frameFailed?attempt.frameErrorAt:old.frameErrorAt,months:[...monthMap.values()]})});
    return normalizeCreditProfile({...previous,attemptedAt:incoming.attemptedAt,coreComplete:false,accounts});
  }
  for(const rawIncoming of rawSuccesses){
    const equivalent=base.profiles.filter(profile=>profile.profileId===rawIncoming.profileId||creditProfilesShareDiscoveredIdentity(profile,rawIncoming));
    let targetId=rawIncoming.profileId;
    for(const candidate of equivalent)if(creditProfileIdPriority(candidate)>creditProfileIdPriority({profileId:targetId}))targetId=candidate.profileId;
    const identityIds=[targetId,...new Set([rawIncoming.profileId,...equivalent.map(profile=>profile.profileId)].filter(profileId=>profileId!==targetId))];
    const incoming=normalizeCreditProfile({...rawIncoming,profileId:targetId,accounts:rawIncoming.accounts.filter(account=>preferredCreditMapping(mappings,identityIds,account.accountNumber,rawIncoming.defaultAccount)?.included!==false)});
    successes.push(incoming);
    const previousProfiles=[];for(const profileId of identityIds){const profile=byId.get(profileId);if(profile)previousProfiles.push(profile)}
    let previous=null;
    for(const profile of previousProfiles){if(!previous){previous=normalizeCreditProfile({...profile,profileId:targetId});continue}const accounts=new Map(previous.accounts.map(account=>[account.accountNumber,account]));for(const account of profile.accounts)accounts.set(account.accountNumber,mergeCreditAccountSnapshot(accounts.get(account.accountNumber),account));previous=normalizeCreditProfile({...previous,profileId:targetId,syncedAt:newerISO(previous.syncedAt,profile.syncedAt),attemptedAt:newerISO(previous.attemptedAt,profile.attemptedAt),accounts:[...accounts.values()]})}
    const mappingAccountNumbers=new Set([...rawIncoming.accounts,...previousProfiles.flatMap(profile=>profile.accounts)].map(account=>account.accountNumber).filter(Boolean));
    for(const key of Object.keys(mappings))for(const profileId of identityIds){const prefix=`${profileId}:`;if(key.startsWith(prefix))mappingAccountNumbers.add(key.slice(prefix.length))}
    const chosenMappings=new Map();for(const accountNumber of mappingAccountNumbers){const chosen=preferredCreditMapping(mappings,identityIds,accountNumber,rawIncoming.defaultAccount);if(chosen)chosenMappings.set(accountNumber,chosen)}
    for(const profileId of identityIds){if(profileId!==targetId)byId.delete(profileId);const prefix=`${profileId}:`;for(const key of Object.keys(mappings))if(key.startsWith(prefix))delete mappings[key]}
    for(const [accountNumber,mapping] of chosenMappings)mappings[creditCardMappingKey(targetId,accountNumber)]=mapping;
    if(previous&&incoming.coreComplete===false){byId.set(targetId,preserveCoreLastKnownGood(previous,incoming));continue}
    const accounts=new Map((previous?.accounts||[]).map(account=>[account.accountNumber,account]));for(const account of incoming.accounts)accounts.set(account.accountNumber,mergeCreditAccountSnapshot(accounts.get(account.accountNumber),account));byId.set(targetId,normalizeCreditProfile({...previous,...incoming,syncedAt:incoming.syncedAt||previous?.syncedAt||null,accounts:[...accounts.values()]}));
  }
  for(const profile of successes)for(const account of profile.accounts){const key=creditCardMappingKey(profile.profileId,account.accountNumber);if(!mappings[key])mappings[key]={included:false,hidden:false,account:profile.defaultAccount,cardName:'',manualFrame:null}}
  const errors=(Array.isArray(payload.errors)?payload.errors:[]).map(e=>({profileId:text(e?.profileId||'',80),provider:text(e?.provider||'',30),browserEngine:['chromium','camoufox'].includes(String(e?.browserEngine||''))?String(e.browserEngine):'',label:text(e?.label||'',100),code:text(e?.code||'CREDIT_SCRAPE_FAILED',80),stage:text(e?.stage||'',80),component:creditErrorComponent(e),severity:creditErrorSeverity(e),httpStatus:Math.max(0,Math.trunc(Number(e?.httpStatus)||0)),message:safeCreditErrorMessage(e?.message),at:iso(e?.at)||new Date().toISOString(),originalFailureAt:iso(e?.originalFailureAt||e?.at),retryAfterAt:iso(e?.retryAfterAt),deferred:e?.deferred===true,month:/^\d{4}-\d{2}$/.test(String(e?.month||''))?String(e.month):'',tier:e?.tier==='forecast'?'forecast':e?.tier==='core'?'core':'',accountSuffix:text(e?.accountSuffix||'',4),correlationId:text(e?.correlationId||payload.correlationId||'',80),diagnosticFingerprint:text(e?.diagnosticFingerprint||'',32)}));
  const cutoff=creditHistoryCutoffMonth(iso(payload.syncedAt));
  if(cutoff)for(const [id,profile] of byId)byId.set(id,normalizeCreditProfile({...profile,accounts:profile.accounts.map(account=>normalizeCreditAccount({...account,months:account.months.filter(slice=>slice.month>=cutoff),txns:[]}))}));
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

// Foreign-currency rows stay visible in issuer data but never silently enter ILS Kupa totals.
function normalizedCurrency(value){return text(value||'',12).toUpperCase().replace(/\s+/g,'')}
function shekelCurrency(value){const currency=normalizedCurrency(value);return !currency||['ILS','NIS','₪','ש״ח','שח'].includes(currency)}
export function creditTransactionIsForeignCurrency(tx={}){
  const original=normalizedCurrency(tx.originalCurrency),charged=normalizedCurrency(tx.chargedCurrency);
  return tx.foreignTransaction===true|| (!!original&&!shekelCurrency(original))|| (!!charged&&!shekelCurrency(charged));
}
export function creditKnownFutureCommitment(account={},asOf=todayISO()){
  return creditAccountKnownFutureCommitmentData(account,asOf);
}
export function creditPendingAuthorizationAmount(account={},asOf=todayISO()){
  return creditPendingAuthorizationTotalData(account,asOf);
}
export function creditUpcomingCharge(account={},provider='',asOf=todayISO()){
  return creditAccountUpcomingChargeData(account,provider,asOf);
}
export function creditFrameStatus(account={},mapping={},asOf=todayISO()){
  const issuerFrame=finite(account?.cardFrame),directAvailable=finite(account?.availableCredit),manualFrame=nonNegativeMoney(mapping?.manualFrame),commitments=creditKnownFutureCommitment(account,asOf),pendingAuthorizations=creditPendingAuthorizationAmount(account,asOf);
  // MAX/Isracard/Amex issuer availability already includes live authorizations; never subtract pending twice.
  if(directAvailable!==null)return {frame:issuerFrame,available:Math.round(directAvailable*100)/100,commitments,pendingAuthorizations,source:'issuer_available',frameSource:issuerFrame!==null?'issuer':null};
  const frame=issuerFrame!==null?issuerFrame:manualFrame;
  if(frame===null)return {frame:null,available:null,commitments,pendingAuthorizations,source:'unavailable',frameSource:null};
  return {frame,available:Math.round((frame-commitments-pendingAuthorizations)*100)/100,commitments,pendingAuthorizations,source:issuerFrame!==null?'issuer_frame_calculated':'manual_frame_calculated',frameSource:issuerFrame!==null?'issuer':'manual'};
}

function buildPendingRows(state,asOf=todayISO(),{includeHidden=false}={}){
  return creditBillingRowsData(state,{asOf,includeHidden}).filter(row=>row.status==='pending').map(row=>({...row,id:row.creditId,provisionalChargeDate:row.date,currency:row.displayCurrency})).sort((a,b)=>String(b.transactionDate).localeCompare(String(a.transactionDate))||String(a.card).localeCompare(String(b.card),'he')||String(a.description).localeCompare(String(b.description),'he'));
}

export function syncedPendingTransactionsData(state,asOf=todayISO()){return buildPendingRows(state,asOf)}
export function syncedPendingForecastData(state,asOf=todayISO()){
  return buildPendingRows(state,asOf,{includeHidden:true}).filter(row=>row.includedInIlsTotal&&row.date>=String(asOf).slice(0,10)&&Number.isFinite(Number(row.amount))&&Math.abs(Number(row.amount))>0.004);
}

// Completed rows whose issuer charge is genuinely non-ILS must still be visible in the
// credit transaction browser. They are presentation/reporting data only: without an
// issuer-supplied ILS billing amount they contribute zero to every ILS cash-flow total.
export function syncedForeignCurrencyTransactionsData(state){
  return creditBillingRowsData(state,{includeHidden:false}).filter(row=>row.source==='credit_foreign').map(row=>({...row,id:row.creditId,amount:row.displayAmount,currency:row.displayCurrency})).sort((a,b)=>String(b.transactionDate||b.date).localeCompare(String(a.transactionDate||a.date))||String(a.card).localeCompare(String(b.card),'he'));
}

export function syncedInstallmentsData(state){
  return creditBillingRowsData(state,{includeHidden:true}).filter(row=>row.source==='credit_sync'&&row.status!=='pending'&&row.date&&row.includedInIlsTotal&&Math.abs(row.amount)>0.004).sort((a,b)=>a.date.localeCompare(b.date)||String(a.card).localeCompare(String(b.card)));
}

// Converts normalized issuer rows into purchase/series rows for the detailed credit table.
// Progress is based only on explicit installment numbers and issuer charge dates; missing future rows are flagged instead of invented.
export function syncedCreditSeries(state,asOf=todayISO()){
  const groups=new Map(),rows=creditBillingRowsData(state,{asOf,includeHidden:false}).filter(row=>row.source==='credit_sync'&&row.status!=='pending'&&row.date&&row.includedInIlsTotal&&Math.abs(row.amount)>0.004);
  for(const row of rows){
    const key=row.series?.id||row.creditId,part=row.part||1,totalParts=row.totalParts||1;
    if(!groups.has(key))groups.set(key,{id:key,source:'credit_sync',profileId:row.profileId,provider:row.provider,accountNumber:row.accountNumber,ownerLabel:row.ownerLabel,account:row.account,card:row.card,description:row.description,totalParts,items:[],originalCandidates:[],foreignCurrency:false,originalCurrencies:new Set()});
    const group=groups.get(key);group.totalParts=Math.max(group.totalParts,totalParts);group.foreignCurrency=group.foreignCurrency||row.foreignCurrency;if(row.originalCurrency)group.originalCurrencies.add(text(row.originalCurrency,12));group.items.push({date:row.date,amount:row.amount,part,totalParts,transactionDate:row.transactionDate,transactionTime:row.transactionTime});
    if(Number.isFinite(Number(row.totalAmount))&&Number(row.totalAmount)!==0)group.originalCandidates.push(Number(row.totalAmount));
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
    const totalAmount=originalTotal??knownTotal,lastChargeDate=items.reduce((latest,item)=>item.date>latest?item.date:latest,''),transactionDate=items.map(item=>item.transactionDate).filter(Boolean).sort()[0]||'',transactionTime=items.map(item=>item.transactionTime).find(Boolean)||'';
    const partial=remainingCount>futureItems.length;
    const originalCurrency=group.originalCurrencies.size===1?[...group.originalCurrencies][0]:'';
    result.push({...group,originalCurrencies:undefined,items,totalAmount,transactionDate,transactionTime,originalCurrency,completedCount,remainingCount,next,remainingAmount,lastChargeDate,partial,complete:remainingCount===0});
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
