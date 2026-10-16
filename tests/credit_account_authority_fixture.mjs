// Project only the separately tested account-authority change out of historical
// policy comparisons. Keep the immutable baseline hashes and every other byte.
export function restoreCreditPendingStatus(source){
  return source.replace(
    /(['"]network_error['"])(,\s*['"]missing['"])(\]\.includes\(\s*String\(account\.pendingStatus\)\s*\))/, '$1$3');
}

export function restoreCreditAccountFeed(source,{orders=false}={}){
  source=restoreCreditPendingStatus(source);
  if(orders){
    const start=source.indexOf('export function normalizeCreditAccount('),
      end=source.indexOf('\nexport function normalizeCreditProfile',start);
    if(start>=0&&end>start)source=source.slice(0,start)+
      source.slice(start,end).replace(/,\n\s*/g,',')+source.slice(end);
  }
  return source;
}
