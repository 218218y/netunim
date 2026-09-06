import {kupaAccountCashflowData} from './readout.js';

const RETURNED_CHEQUE_ALERT_KIND='returned_cheque';
const RETURNED_CHEQUE_PATTERNS=[
  /^החזרת\s+(?:שיק(?:ים)?|צ[׳']?ק(?:ים)?|המחא(?:ה|ות))(?:$|[\s.:,;()\-–—־])/u,
  /^(?:שיק|צ[׳']?ק|המחאה)\s+(?:הוחזר|חזר)(?:$|[\s.:,;()\-–—־])/u,
  /^(?:returned|return)\s+(?:check|cheque)s?(?:$|[\s.:,;()\-–—])/iu,
];

function text(value){return String(value??'').replace(/\s+/g,' ').trim()}
function trimReason(value){return text(value).replace(/^[\s:;,.·•\-–—]+|[\s:;,.·•\-–—]+$/gu,'').trim()}
function returnedChequeAcknowledged(row){return !!row?.alertAcknowledgements?.[RETURNED_CHEQUE_ALERT_KIND]}

export function bankReturnedCheque(row){
  const description=text(row?.description);
  return !!description&&RETURNED_CHEQUE_PATTERNS.some(pattern=>pattern.test(description));
}

export function bankReturnedChequeReason(row){
  const headline=text(row?.messageHeadline),detail=text(row?.messageDetail),memo=text(row?.memo);
  const marker=/סיבת\s+החזרה\s*[:\-–—]?\s*(.*)$/u;
  for(const value of [headline,detail,memo]){
    const match=value.match(marker);
    if(match){const inline=trimReason(match[1]);if(inline)return inline;if(value===headline){const fallback=trimReason(detail);if(fallback&&!marker.test(fallback))return fallback}}
  }
  if(/^סיבת\s+החזרה\s*[:\-–—]?$/u.test(headline)){const fallback=trimReason(detail);if(fallback)return fallback}
  return '';
}

export function bankWarningItems(bank){
  if(!bank||typeof bank!=='object')return [];
  const result=[];
  for(const [role,account,feed] of [['business','עסקי',bank.feed],['home','ביתי',bank.homeFeed]]){
    const rows=Array.isArray(feed?.transactions)?feed.transactions:[];
    for(const row of rows){
      const archiveId=Number(row?.archiveId);
      if(!Number.isSafeInteger(archiveId)||archiveId<=0)continue;
      if(row?.presenceState==='missing'&&!row?.missingAcknowledgedAt){
        result.push({
          id:`bank_missing:${archiveId}`,
          kind:'bank_missing',
          account,role,archiveId,
          amount:Number(row?.amount)||0,
          description:text(row?.description)||'תנועת בנק',
          date:row?.date||row?.processedDate||null,
          lastSeenAt:row?.lastSeenAt||null,
          missingSince:row?.missingSince||null,
          cheque:!!row?.cheque,
        });
      }
      if(bankReturnedCheque(row)&&!returnedChequeAcknowledged(row)){
        result.push({
          id:`bank_returned_cheque:${archiveId}`,
          kind:'bank_returned_cheque',
          alertKind:RETURNED_CHEQUE_ALERT_KIND,
          account,role,archiveId,
          amount:Number(row?.amount)||0,
          description:text(row?.description)||'החזרת שיק',
          reason:bankReturnedChequeReason(row),
          date:row?.date||row?.processedDate||null,
          bankReference:text(row?.bankReference),
        });
      }
    }
  }
  return result.sort((a,b)=>{
    const severity=kind=>kind==='bank_returned_cheque'?0:1,delta=severity(a.kind)-severity(b.kind);
    if(delta)return delta;
    return String(b.date||b.missingSince||'').localeCompare(String(a.date||a.missingSince||''));
  });
}

export function cashflowWarningItems(kupa){
  if(!kupa||typeof kupa!=='object')return [];
  const rows=[kupaAccountCashflowData(kupa,'עסקי').alert,kupaAccountCashflowData(kupa,'ביתי').alert];
  return rows.filter(row=>row.active).map(row=>({
    id:`cashflow:${row.account}`,
    kind:'cashflow',
    account:row.account,
    projected:row.projected,
    minimum:row.minimum,
    reason:row.reason,
  }));
}
