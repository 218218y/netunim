// Retention is independent of the connector's fetch window: accumulate existing
// months through ordinary syncs without asking the issuer for older history.
export const CREDIT_DETAIL_HISTORY_MONTHS=12;

export function creditHistoryCutoffMonth(reference){
  const match=/^(\d{4})-(0[1-9]|1[0-2])-/.exec(String(reference||''));
  if(!match)return '';
  const index=Number(match[1])*12+Number(match[2])-1-CREDIT_DETAIL_HISTORY_MONTHS;
  return `${Math.floor(index/12)}-${String(index%12+1).padStart(2,'0')}`;
}

export function creditCardSortOrder(value){
  if(value===null||value===undefined||String(value).trim()==='')return null;
  const order=Number(value);
  return Number.isSafeInteger(order)&&order>=1?order:null;
}

function creditCardMappingKey(row){return String(row?.creditAccountKey||'').replace(/^sync:/,'')}

export function creditCardConfiguredOrderCompare(a,b,mappings={}){
  const left=creditCardSortOrder(mappings[creditCardMappingKey(a)]?.sortOrder),right=creditCardSortOrder(mappings[creditCardMappingKey(b)]?.sortOrder);
  if(left===null&&right===null)return 0;
  return (left??Number.MAX_SAFE_INTEGER)-(right??Number.MAX_SAFE_INTEGER);
}

export function creditCardCompare(a,b,mappings={}){
  return creditCardConfiguredOrderCompare(a,b,mappings)||String(a.card||'').localeCompare(String(b.card||''),'he')||creditCardMappingKey(a).localeCompare(creditCardMappingKey(b));
}
