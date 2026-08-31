import {todayISO} from '../../core/dates.js';

export const CREDIT_SYNC_VERSION=3;
export const CREDIT_PROVIDER_LABELS={visaCal:'כאל',max:'MAX',isracard:'ישראכרט',amex:'American Express'};

function text(value,max=240){return String(value??'').trim().replace(/\s+/g,' ').slice(0,max)}
function finite(value){if(value===null||value===undefined||value==='')return null;const n=Number(value);return Number.isFinite(n)?n:null}
function iso(value){if(!value)return null;const d=new Date(value);return Number.isFinite(d.getTime())?d.toISOString():null}
function safeCreditErrorMessage(value){const raw=String(value??'').trim(),secretField=new RegExp(`\\b${['pass','word'].join('')}\\b\\s*[:=]`,'i');if(/fetch(?:Post|Get)WithinPage|<!DOCTYPE|<html|\b(?:Sisma|MisparZihuy|cardSuffix|KodMishtamesh|extraHeaders)\b/i.test(raw)||secretField.test(raw))return 'חברת האשראי החזירה תשובה טכנית שלא ניתן להציג בבטחה. נסה שוב לאחר עדכון ה‑Bank Bridge או השתמש ברענון עם חלון אבחון.';return text(raw||'סנכרון האשראי נכשל',260)}
function normalizeInstallments(value){const number=Math.trunc(Number(value?.number)),total=Math.trunc(Number(value?.total));return number>0&&total>0?{number,total}:null}
export function creditCardMappingKey(profileId,accountNumber){return `${text(profileId,80)}:${text(accountNumber,80)}`}

export function normalizeCreditTransaction(txn={}){
  const charged=finite(txn.chargedAmount),original=finite(txn.originalAmount);
  return {
    id:text(txn.id||txn.identifier||'',120),
    type:text(txn.type||'normal',30)||'normal',
    date:iso(txn.date),
    processedDate:iso(txn.processedDate),
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

export function normalizeCreditAccount(account={}){
  const txns=(Array.isArray(account.txns)?account.txns:[]).map(normalizeCreditTransaction).filter(tx=>tx.date||tx.processedDate||tx.id);
  const seen=new Set();
  return {
    accountNumber:text(account.accountNumber||'',80),
    balance:finite(account.balance),
    balanceDate:iso(account.balanceDate),
    cardType:text(account.cardType||'',80),
    cardFrame:finite(account.cardFrame),
    availableCredit:finite(account.availableCredit),
    txns:txns.filter(tx=>{if(!tx.id)return true;const key=`${tx.id}|${tx.date}|${tx.processedDate}|${tx.chargedAmount}|${tx.description}|${tx.installments?.number||0}`;if(seen.has(key))return false;seen.add(key);return true}),
  };
}

export function normalizeCreditProfile(profile={}){
  const provider=Object.prototype.hasOwnProperty.call(CREDIT_PROVIDER_LABELS,profile.provider)?profile.provider:'';
  return {
    profileId:text(profile.profileId||'',80),provider,
    label:text(profile.label||CREDIT_PROVIDER_LABELS[provider]||'חיבור אשראי',100),
    ownerLabel:text(profile.ownerLabel||'',100),
    defaultAccount:profile.defaultAccount==='ביתי'?'ביתי':'עסקי',
    syncedAt:iso(profile.syncedAt),
    accounts:(Array.isArray(profile.accounts)?profile.accounts:[]).map(normalizeCreditAccount).filter(x=>x.accountNumber||x.txns.length),
  };
}

function normalizedMapping(raw={},legacyInclude=false){
  return {
    included:typeof raw.included==='boolean'?raw.included:legacyInclude,
    hidden:raw.hidden===true,
    account:raw.account==='ביתי'?'ביתי':'עסקי',
    cardName:text(raw.cardName||'',100),
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
      if(!mappings[key])mappings[key]={included:true,hidden:false,account:profile.defaultAccount,cardName:''};
    }
  }
  return {
    version:CREDIT_SYNC_VERSION,
    // Kept as a compatibility marker only. From v3 the issuer feed is always active and manual rows are additive.
    mode:'synced',
    syncedAt:iso(source.syncedAt),
    profiles,
    errors:(Array.isArray(source.errors)?source.errors:[]).slice(0,20).map(e=>({profileId:text(e?.profileId||'',80),provider:text(e?.provider||'',30),label:text(e?.label||'',100),code:text(e?.code||'SCRAPE_FAILED',80),stage:text(e?.stage||'',80),httpStatus:Math.max(0,Math.trunc(Number(e?.httpStatus)||0)),message:safeCreditErrorMessage(e?.message),at:iso(e?.at)||new Date().toISOString()})),
    cardMappings:mappings,
  };
}

export function mergeCreditSyncResult(current,payload={}){
  const base=normalizeCreditSync(current),successes=(Array.isArray(payload.profiles)?payload.profiles:[]).map(normalizeCreditProfile).filter(x=>x.profileId);
  const byId=new Map(base.profiles.map(p=>[p.profileId,p]));
  successes.forEach(p=>byId.set(p.profileId,p));
  const mappings={...base.cardMappings};
  for(const profile of successes)for(const account of profile.accounts){
    const key=creditCardMappingKey(profile.profileId,account.accountNumber);
    if(!mappings[key])mappings[key]={included:false,hidden:false,account:profile.defaultAccount,cardName:''};
  }
  const errors=(Array.isArray(payload.errors)?payload.errors:[]).map(e=>({profileId:text(e?.profileId||'',80),provider:text(e?.provider||'',30),label:text(e?.label||'',100),code:text(e?.code||'SCRAPE_FAILED',80),stage:text(e?.stage||'',80),httpStatus:Math.max(0,Math.trunc(Number(e?.httpStatus)||0)),message:safeCreditErrorMessage(e?.message),at:iso(e?.at)||new Date().toISOString()}));
  const syncedAt=successes.length?(iso(payload.syncedAt)||new Date().toISOString()):base.syncedAt;
  return normalizeCreditSync({...base,syncedAt,profiles:[...byId.values()],errors,cardMappings:mappings});
}

export function creditSyncHasData(state){return !!normalizeCreditSync(state?.creditSync).profiles.some(p=>p.accounts.some(a=>a.txns.length||a.balance!==null||a.cardFrame!==null||a.availableCredit!==null))}
export function creditSyncHasIncludedCards(state){const sync=normalizeCreditSync(state?.creditSync);return sync.profiles.some(p=>p.accounts.some(a=>sync.cardMappings[creditCardMappingKey(p.profileId,a.accountNumber)]?.included===true))}
export function creditCardIncluded(sync,profileId,accountNumber){return normalizeCreditSync(sync).cardMappings[creditCardMappingKey(profileId,accountNumber)]?.included===true}
export function creditCardHidden(sync,profileId,accountNumber){return normalizeCreditSync(sync).cardMappings[creditCardMappingKey(profileId,accountNumber)]?.hidden===true}

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
function syncedSeriesKey(profile,account,tx,index){
  const part=tx.installments?.number||1,total=tx.installments?.total||1,originDate=shiftMonthDate(tx.date||tx.processedDate||'',-(part-1));
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
      const part=tx.installments?.number||1,totalParts=tx.installments?.total||1,key=syncedSeriesKey(profile,account,tx,index);
      if(!groups.has(key))groups.set(key,{id:key,source:'credit_sync',profileId:profile.profileId,provider:profile.provider,accountNumber:account.accountNumber,ownerLabel:presentation.ownerLabel,account:presentation.accountClass,card:presentation.cardName,description:tx.description,totalParts,items:[],originalCandidates:[]});
      const group=groups.get(key);group.totalParts=Math.max(group.totalParts,totalParts);group.items.push({date:chargeDate,amount,part,totalParts});
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
    const totalAmount=originalTotal??knownTotal,lastChargeDate=items.reduce((latest,item)=>item.date>latest?item.date:latest,'');
    const partial=remainingCount>futureItems.length;
    result.push({...group,items,totalAmount,completedCount,remainingCount,next,remainingAmount,lastChargeDate,partial,complete:remainingCount===0});
  }
  return result.sort((a,b)=>{
    const an=a.next?.date||'9999-12-31',bn=b.next?.date||'9999-12-31';return an.localeCompare(bn)||String(a.card).localeCompare(String(b.card),'he')||String(a.description).localeCompare(String(b.description),'he');
  });
}

export function creditSyncSummary(state){
  const sync=normalizeCreditSync(state?.creditSync),accounts=sync.profiles.flatMap(p=>p.accounts.map(a=>({profile:p,account:a}))),txns=accounts.reduce((n,x)=>n+x.account.txns.length,0);
  const includedAccountCount=accounts.filter(x=>sync.cardMappings[creditCardMappingKey(x.profile.profileId,x.account.accountNumber)]?.included===true).length;
  const hiddenAccountCount=accounts.filter(x=>sync.cardMappings[creditCardMappingKey(x.profile.profileId,x.account.accountNumber)]?.hidden===true).length;
  return {sync,profileCount:sync.profiles.length,accountCount:accounts.length,includedAccountCount,hiddenAccountCount,transactionCount:txns,hasData:accounts.some(x=>x.account.txns.length||x.account.balance!==null||x.account.cardFrame!==null||x.account.availableCredit!==null),today:todayISO()};
}
