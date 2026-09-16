// Retention is independent of the connector's fetch window: accumulate existing
// months through ordinary syncs without asking the issuer for older history.
export const CREDIT_DETAIL_HISTORY_MONTHS=6;

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

export function creditCardCompare(a,b,mappings={}){
  const key=row=>String(row.creditAccountKey||'').replace(/^sync:/,''),order=row=>creditCardSortOrder(mappings[key(row)]?.sortOrder)??Number.MAX_SAFE_INTEGER;
  return order(a)-order(b)||String(a.card||'').localeCompare(String(b.card||''),'he')||key(a).localeCompare(key(b));
}
