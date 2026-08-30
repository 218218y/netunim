import {todayISO} from '../../core/dates.js';

export const CREDIT_SYNC_VERSION=1;
export const CREDIT_PROVIDER_LABELS={visaCal:'כאל',max:'MAX',isracard:'ישראכרט'};

function text(value,max=240){return String(value??'').trim().replace(/\s+/g,' ').slice(0,max)}
function finite(value){const n=Number(value);return Number.isFinite(n)?n:null}
function iso(value){if(!value)return null;const d=new Date(value);return Number.isFinite(d.getTime())?d.toISOString():null}
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
    cardFrame:text(account.cardFrame||'',80),
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

export function normalizeCreditSync(value={}){
  const source=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  const mappings={};
  for(const [key,raw] of Object.entries(source.cardMappings&&typeof source.cardMappings==='object'&&!Array.isArray(source.cardMappings)?source.cardMappings:{})){
    if(!key||!raw||typeof raw!=='object'||Array.isArray(raw))continue;
    mappings[text(key,180)]={account:raw.account==='ביתי'?'ביתי':'עסקי',cardName:text(raw.cardName||'',100)};
  }
  return {
    version:CREDIT_SYNC_VERSION,
    mode:source.mode==='synced'?'synced':'manual',
    syncedAt:iso(source.syncedAt),
    profiles:(Array.isArray(source.profiles)?source.profiles:[]).map(normalizeCreditProfile).filter(x=>x.profileId),
    errors:(Array.isArray(source.errors)?source.errors:[]).slice(0,20).map(e=>({profileId:text(e?.profileId||'',80),provider:text(e?.provider||'',30),label:text(e?.label||'',100),code:text(e?.code||'SCRAPE_FAILED',80),message:text(e?.message||'סנכרון האשראי נכשל',260),at:iso(e?.at)||new Date().toISOString()})),
    cardMappings:mappings,
  };
}

export function mergeCreditSyncResult(current,payload={}){
  const base=normalizeCreditSync(current),successes=(Array.isArray(payload.profiles)?payload.profiles:[]).map(normalizeCreditProfile).filter(x=>x.profileId);
  const byId=new Map(base.profiles.map(p=>[p.profileId,p]));
  successes.forEach(p=>byId.set(p.profileId,p));
  const errors=(Array.isArray(payload.errors)?payload.errors:[]).map(e=>({profileId:text(e?.profileId||'',80),provider:text(e?.provider||'',30),label:text(e?.label||'',100),code:text(e?.code||'SCRAPE_FAILED',80),message:text(e?.message||'סנכרון האשראי נכשל',260),at:iso(e?.at)||new Date().toISOString()}));
  const syncedAt=successes.length?(iso(payload.syncedAt)||new Date().toISOString()):base.syncedAt;
  return normalizeCreditSync({...base,syncedAt,profiles:[...byId.values()],errors});
}

export function creditSyncHasData(state){return !!normalizeCreditSync(state?.creditSync).profiles.some(p=>p.accounts.some(a=>a.txns.length||a.balance!==null))}

function transactionForecastAmount(tx){
  const amount=tx.chargedAmount!==null?tx.chargedAmount:tx.originalAmount;
  if(amount===null||!Number.isFinite(amount)||amount===0)return 0;
  // Credit-card scrapers use negative charged amounts for purchases/debits and positive for refunds/credits.
  return -amount;
}
function isShekelTransaction(tx){
  const currency=text(tx.chargedCurrency||tx.originalCurrency||'ILS',12).toUpperCase().replace(/\s+/g,'');
  return !currency||['ILS','NIS','₪','ש״ח','שח'].includes(currency);
}

export function syncedInstallmentsData(state){
  const sync=normalizeCreditSync(state?.creditSync),rows=[],seen=new Set();
  for(const profile of sync.profiles){
    for(const account of profile.accounts){
      const mapping=sync.cardMappings[creditCardMappingKey(profile.profileId,account.accountNumber)]||{};
      const accountClass=mapping.account==='ביתי'?'ביתי':mapping.account==='עסקי'?'עסקי':profile.defaultAccount;
      const cardName=mapping.cardName||[CREDIT_PROVIDER_LABELS[profile.provider]||profile.label,account.accountNumber?`••${String(account.accountNumber).slice(-4)}`:''].filter(Boolean).join(' ');
      for(const [txIndex,tx] of account.txns.entries()){
        // MAX/CAL pending rows do not carry a trustworthy billing date: their processedDate is the purchase date.
        // Keep them in the live issuer feed, but do not pretend they are a dated bank obligation until the issuer posts them.
        if(tx.status==='pending')continue;
        const date=String(tx.processedDate||tx.date||'').slice(0,10),amount=transactionForecastAmount(tx);
        // The Kupa forecast is denominated in ILS. Foreign-currency rows are shown in the live card data,
        // but they must not silently enter shekel cash-flow totals unless the issuer supplied an ILS charged amount.
        if(!date||!amount||!isShekelTransaction(tx))continue;
        const part=tx.installments?.number||1,totalParts=tx.installments?.total||1;
        const stableId=tx.id?`${tx.id}|${date}|${amount}|${tx.description}|${part}`:`idless-${txIndex}|${date}|${amount}|${tx.description}|${part}`;
        const identity=`${profile.profileId}|${account.accountNumber}|${stableId}`;
        if(seen.has(identity))continue;seen.add(identity);
        rows.push({creditId:`SYNC:${identity}`,date,amount,part,totalParts,card:cardName||'כרטיס אשראי',account:accountClass,description:tx.description,source:'credit_sync',profileId:profile.profileId,accountNumber:account.accountNumber,status:tx.status});
      }
    }
  }
  return rows.sort((a,b)=>a.date.localeCompare(b.date)||String(a.card).localeCompare(String(b.card)));
}

export function creditSyncSummary(state){
  const sync=normalizeCreditSync(state?.creditSync),accounts=sync.profiles.flatMap(p=>p.accounts.map(a=>({profile:p,account:a}))),txns=accounts.reduce((n,x)=>n+x.account.txns.length,0);
  return {sync,profileCount:sync.profiles.length,accountCount:accounts.length,transactionCount:txns,hasData:accounts.some(x=>x.account.txns.length||x.account.balance!==null),today:todayISO()};
}
