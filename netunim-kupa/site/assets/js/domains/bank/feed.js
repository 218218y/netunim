export const BANK_FEED_VERSION=4;
export const BANK_FEED_TRANSACTION_LIMIT=1000;

export function bankTransactionIdentity(row={},role='business',index=0){
  const side=role==='home'?'home':'business',when=String(row.date||row.processedDate||'').slice(0,10),stable=String(row.id||row.bankSerial||row.bankReference||'').trim(),fallback=stable||`${String(row.description||'').trim()}|${Number(row.amount||0)}|${index}`;
  return `${side}:${fallback}:${when}:${Number(row.amount||0)}`;
}

function finiteNumber(value,fallback=0){const n=Number(value);return Number.isFinite(n)?n:fallback}
function cleanText(value,max=260){return String(value??'').replace(/\s+/g,' ').trim().slice(0,max)}
function cleanIso(value){const s=String(value||'').trim();return s&&Number.isFinite(Date.parse(s))?new Date(s).toISOString():null}
function normalizeCheckDetails(value){
  if(!value||typeof value!=='object')return null;
  const numbers=[...new Set((Array.isArray(value.checkNumbers)?value.checkNumbers:[]).map(x=>cleanText(x,80)).filter(x=>x&&x!=='0'))].slice(0,50);
  const count=value.checkCount===null||value.checkCount===undefined||value.checkCount===''?null:(Number.isFinite(Number(value.checkCount))&&Number(value.checkCount)>0?Math.trunc(Number(value.checkCount)):null);
  const items=(Array.isArray(value.checkItems)?value.checkItems:[]).map(item=>({
    bankNumber:cleanText(item?.bankNumber,20),
    branchNumber:cleanText(item?.branchNumber,20),
    accountNumber:cleanText(item?.accountNumber,40),
    checkNumber:cleanText(item?.checkNumber,80),
    amount:item?.amount===null||item?.amount===undefined||item?.amount===''?null:(Number.isFinite(Number(item.amount))&&Number(item.amount)>0?Number(item.amount):null),
    hasDocumentReference:!!item?.hasDocumentReference,
  })).filter(item=>item.amount&&(item.checkNumber||(item.bankNumber&&item.branchNumber&&item.accountNumber))).slice(0,50);
  for(const item of items){if(item.checkNumber&&!numbers.includes(item.checkNumber))numbers.push(item.checkNumber)}
  return {checkNumbers:numbers,checkCount:count||items.length||null,checkItems:items,hasDocumentReference:!!value.hasDocumentReference,warning:cleanText(value.warning,220)};
}

export function normalizeBankFeedTransaction(value){
  const row=value&&typeof value==='object'?value:{};
  return {
    id:cleanText(row.id,100),
    date:cleanIso(row.date),
    processedDate:cleanIso(row.processedDate),
    amount:finiteNumber(row.amount,0),
    currency:cleanText(row.currency||'ILS',8)||'ILS',
    description:cleanText(row.description,180)||'תנועת בנק',
    memo:cleanText(row.memo,260),
    partyName:cleanText(row.partyName,160),partyHeadline:cleanText(row.partyHeadline,160),messageHeadline:cleanText(row.messageHeadline,160),messageDetail:cleanText(row.messageDetail,220),
    activityTypeCode:row.activityTypeCode===null||row.activityTypeCode===undefined||row.activityTypeCode===''?null:(Number.isFinite(Number(row.activityTypeCode))?Number(row.activityTypeCode):null),
    status:row.status==='pending'?'pending':'completed',
    balanceAfter:row.balanceAfter===null||row.balanceAfter===undefined||row.balanceAfter===''?null:(Number.isFinite(Number(row.balanceAfter))?Number(row.balanceAfter):null),
    bankReference:cleanText(row.bankReference,100),
    bankSerial:cleanText(row.bankSerial,100),
    cheque:!!row.cheque,
    checkDetails:row.cheque?normalizeCheckDetails(row.checkDetails):null,
  };
}

export function normalizeBankFeed(feed){
  if(!feed||typeof feed!=='object')return null;
  const syncedAt=cleanIso(feed.syncedAt||feed.fetchedAt);
  const balance=Number(feed.balance);
  if(!syncedAt||!Number.isFinite(balance))return null;
  const seen=new Set(),transactions=[];
  for(const raw of Array.isArray(feed.transactions)?feed.transactions:[]){
    const row=normalizeBankFeedTransaction(raw),key=`${row.id}|${row.date}|${row.amount}|${row.description}`;
    if(seen.has(key))continue;seen.add(key);transactions.push(row);
  }
  transactions.sort((a,b)=>String(b.date||b.processedDate||'').localeCompare(String(a.date||a.processedDate||'')));
  transactions.length=Math.min(transactions.length,BANK_FEED_TRANSACTION_LIMIT);
  return {
    version:BANK_FEED_VERSION,
    provider:'hapoalim',
    accountNumber:cleanText(feed.accountNumber,64),
    balance,
    availableBalance:feed.availableBalance===null||feed.availableBalance===undefined||feed.availableBalance===''?null:(Number.isFinite(Number(feed.availableBalance))?Number(feed.availableBalance):null),
    creditLimit:feed.creditLimit===null||feed.creditLimit===undefined||feed.creditLimit===''?null:(Number.isFinite(Number(feed.creditLimit))?Number(feed.creditLimit):null),
    creditLimitUsed:feed.creditLimitUsed===null||feed.creditLimitUsed===undefined||feed.creditLimitUsed===''?null:(Number.isFinite(Number(feed.creditLimitUsed))?Number(feed.creditLimitUsed):null),
    creditLimitUsedPercent:feed.creditLimitUsedPercent===null||feed.creditLimitUsedPercent===undefined||feed.creditLimitUsedPercent===''?null:(Number.isFinite(Number(feed.creditLimitUsedPercent))?Number(feed.creditLimitUsedPercent):null),
    syncedAt,
    transactions,
    transactionWarning:cleanText(feed.transactionWarning,320),
  };
}
