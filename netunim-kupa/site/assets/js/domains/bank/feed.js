export const BANK_FEED_VERSION=2;
export const BANK_FEED_TRANSACTION_LIMIT=1000;

function finiteNumber(value,fallback=0){const n=Number(value);return Number.isFinite(n)?n:fallback}
function cleanText(value,max=260){return String(value??'').replace(/\s+/g,' ').trim().slice(0,max)}
function cleanIso(value){const s=String(value||'').trim();return s&&Number.isFinite(Date.parse(s))?new Date(s).toISOString():null}

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
    status:row.status==='pending'?'pending':'completed',
    balanceAfter:row.balanceAfter===null||row.balanceAfter===undefined||row.balanceAfter===''?null:(Number.isFinite(Number(row.balanceAfter))?Number(row.balanceAfter):null),
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
    syncedAt,
    transactions,
    transactionWarning:cleanText(feed.transactionWarning,320),
  };
}
