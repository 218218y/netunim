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
  return {id:text(txn.id||txn.identifier||'',120),type:text(txn.type||'normal',30)||'normal',date:iso(txn.date),processedDate:iso(txn.processedDate),transactionDate:iso(txn.transactionDate),originalAmount:original,originalCurrency:text(txn.originalCurrency||'',12),chargedAmount:charged,chargedCurrency:text(txn.chargedCurrency||txn.originalCurrency||'ILS',12)||'ILS',description:text(txn.description||'עסקת אשראי',220)||'עסקת אשראי',memo:text(txn.memo||'',260),installments:normalizeInstallments(txn.installments),status:['pending','completed'].includes(String(txn.status))?String(txn.status):'completed'};
}

export function normalizeCreditAccount(account={}){
  const txns=(Array.isArray(account.txns)?account.txns:[]).map(normalizeCreditTransaction).filter(tx=>tx.date||tx.processedDate||tx.id),seen=new Set();
  return {accountNumber:text(account.accountNumber||'',80),balance:finite(account.balance),balanceDate:iso(account.balanceDate),cardType:text(account.cardType||'',80),cardFrame:finite(account.cardFrame),availableCredit:finite(account.availableCredit),txns:txns.filter(tx=>{if(!tx.id)return true;const key=`${tx.id}|${tx.date}|${tx.processedDate}|${tx.chargedAmount}|${tx.description}|${tx.installments?.number||0}`;if(seen.has(key))return false;seen.add(key);return true})};
}

export function normalizeCreditProfile(profile={}){
  const provider=Object.prototype.hasOwnProperty.call(CREDIT_PROVIDER_LABELS,profile.provider)?profile.provider:'';
  return {profileId:text(profile.profileId||'',80),provider,label:text(profile.label||CREDIT_PROVIDER_LABELS[provider]||'חיבור אשראי',100),ownerLabel:text(profile.ownerLabel||'',100),defaultAccount:profile.defaultAccount==='ביתי'?'ביתי':'עסקי',syncedAt:iso(profile.syncedAt),accounts:(Array.isArray(profile.accounts)?profile.accounts:[]).map(normalizeCreditAccount).filter(x=>x.accountNumber||x.txns.length)};
}

function normalizedMapping(raw={},legacyInclude=false){return {included:typeof raw.included==='boolean'?raw.included:legacyInclude,hidden:raw.hidden===true,account:raw.account==='ביתי'?'ביתי':'עסקי',cardName:text(raw.cardName||'',100)}}

export function normalizeCreditSync(value={}){
  const source=value&&typeof value==='object'&&!Array.isArray(value)?value:{},sourceVersion=Math.trunc(Number(source.version)||1),legacyInclude=sourceVersion<2;
  const profiles=(Array.isArray(source.profiles)?source.profiles:[]).map(normalizeCreditProfile).filter(x=>x.profileId),mappings={};
  for(const [key,raw] of Object.entries(source.cardMappings&&typeof source.cardMappings==='object'&&!Array.isArray(source.cardMappings)?source.cardMappings:{})){if(!key||!raw||typeof raw!=='object'||Array.isArray(raw))continue;mappings[text(key,180)]=normalizedMapping(raw,legacyInclude)}
  if(legacyInclude)for(const profile of profiles)for(const account of profile.accounts){const key=creditCardMappingKey(profile.profileId,account.accountNumber);if(!mappings[key])mappings[key]={included:true,hidden:false,account:profile.defaultAccount,cardName:''}}
  return {version:CREDIT_SYNC_VERSION,mode:'synced',syncedAt:iso(source.syncedAt),profiles,errors:(Array.isArray(source.errors)?source.errors:[]).slice(0,20).map(e=>({profileId:text(e?.profileId||'',80),provider:text(e?.provider||'',30),label:text(e?.label||'',100),code:text(e?.code||'SCRAPE_FAILED',80),stage:text(e?.stage||'',80),httpStatus:Math.max(0,Math.trunc(Number(e?.httpStatus)||0)),message:safeCreditErrorMessage(e?.message),at:iso(e?.at)||new Date().toISOString()})),cardMappings:mappings};
}

export function mergeCreditSyncResult(current,payload={}){
  const base=normalizeCreditSync(current),successes=(Array.isArray(payload.profiles)?payload.profiles:[]).map(normalizeCreditProfile).filter(x=>x.profileId),byId=new Map(base.profiles.map(p=>[p.profileId,p]));
  successes.forEach(p=>byId.set(p.profileId,p));
  const mappings={...base.cardMappings};
  for(const profile of successes)for(const account of profile.accounts){const key=creditCardMappingKey(profile.profileId,account.accountNumber);if(!mappings[key])mappings[key]={included:false,hidden:false,account:profile.defaultAccount,cardName:''}}
  const errors=(Array.isArray(payload.errors)?payload.errors:[]).map(e=>({profileId:text(e?.profileId||'',80),provider:text(e?.provider||'',30),label:text(e?.label||'',100),code:text(e?.code||'SCRAPE_FAILED',80),stage:text(e?.stage||'',80),httpStatus:Math.max(0,Math.trunc(Number(e?.httpStatus)||0)),message:safeCreditErrorMessage(e?.message),at:iso(e?.at)||new Date().toISOString()}));
  const syncedAt=successes.length?(iso(payload.syncedAt)||new Date().toISOString()):base.syncedAt;
  return normalizeCreditSync({...base,syncedAt,profiles:[...byId.values()],errors,cardMappings:mappings});
}
