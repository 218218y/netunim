import {normalizedCalendarTimestamp as cleanIso} from '../../shared/observation-time.js';
import {normalizeBankFeed as normalizeFeed, normalizeBankFeedTransaction as normalizeTransaction} from '../../shared/bank-feed.js';
export {BANK_FEED_VERSION, BANK_FEED_TRANSACTION_LIMIT} from '../../shared/bank-feed.js';

function cleanText(value,max=260){return String(value??'').replace(/\s+/g,' ').trim().slice(0,max)}
function normalizeMorningDocumentLinks(value){
  if(!Array.isArray(value))return [];
  const seen=new Set(),rows=[];
  for(const raw of value){
    const documentId=cleanText(raw?.documentId,80),operationId=cleanText(raw?.operationId,80),verifiedAt=cleanIso(raw?.verifiedAt),type=Number(raw?.documentType),amount=Number(raw?.documentAmount),linkId=Number(raw?.linkId);
    const key=documentId||operationId;if(!key||seen.has(key)||![320,400].includes(type)||!Number.isFinite(amount)||amount<=0||!verifiedAt)continue;
    seen.add(key);rows.push({linkId:Number.isSafeInteger(linkId)&&linkId>0?linkId:null,operationId,documentId,documentNumber:cleanText(raw?.documentNumber,80),documentType:type,documentAmount:Math.round(amount*100)/100,verifiedAt});
  }
  return rows.sort((a,b)=>String(b.verifiedAt).localeCompare(String(a.verifiedAt)));
}


export function normalizeBankFeedTransaction(value){
  const row=value&&typeof value==='object'?value:{};
  return {...normalizeTransaction(row),handledAt:cleanIso(row.handledAt),documentLinks:normalizeMorningDocumentLinks(row.documentLinks)};
}

export function normalizeBankFeed(feed){
  return normalizeFeed(feed,normalizeBankFeedTransaction);
}
