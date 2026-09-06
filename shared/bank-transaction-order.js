function rowKey(row){return String(row?.id||row?.mergeKey||'').trim()}
function rowDate(row){return String(row?.date||row?.processedDate||'')}
function valueDate(row){return String(row?.processedDate||'')}
function dayKey(row){return rowDate(row).slice(0,10)}
function pending(row){return row?.status==='pending'}
function numericId(row){const n=Number(row?.archiveId);return Number.isSafeInteger(n)&&n>0?n:0}

/**
 * Canonical ordering for the smart bank-history view.
 *
 * The archive is intentionally append/update oriented; its database row id is not a bank
 * sequence number. Hapoalim can return several movements with the same event date, especially
 * pending movements whose value date is later. The latest complete direct snapshot is the only
 * authoritative source-order we have for those ties, so preserve it whenever both rows belong to
 * that snapshot. Pending rows stay above settled history, matching the bank's recent feed and
 * preventing an archive insertion order from pushing an unsettled movement behind settled rows.
 *
 * Active reconciliation warnings are still allowed to pin rows above the financial sequence;
 * their warning UI makes that deliberate exception explicit.
 */
export function bankSmartHistoryRows(rows,{directTransactions=[],isMissingActive=()=>false}={}){
  const source=Array.isArray(rows)?rows:[],direct=Array.isArray(directTransactions)?directTransactions:[],rank=new Map();
  direct.forEach((row,index)=>{const key=rowKey(row);if(key&&!rank.has(key))rank.set(key,index)});
  return source.map((row,index)=>({row,index,key:rowKey(row)})).sort((a,b)=>{
    const missingDelta=Number(!!isMissingActive(b.row))-Number(!!isMissingActive(a.row));
    if(missingDelta)return missingDelta;

    // If both rows still exist in the latest complete direct snapshot, preserve the bank's exact
    // source order across dates and statuses. Do not second-guess a complete snapshot.
    const aRank=a.key&&rank.has(a.key)?rank.get(a.key):null,bRank=b.key&&rank.has(b.key)?rank.get(b.key):null;
    if(aRank!==null&&bRank!==null&&aRank!==bRank)return aRank-bRank;

    // Rows that are not jointly represented by the complete snapshot need a safe fallback.
    // Pending movements stay above settled history so partial/new archive rows cannot drift back
    // merely because their event date predates their future value date.
    const pendingDelta=Number(pending(b.row))-Number(pending(a.row));
    if(pendingDelta)return pendingDelta;

    const aDay=dayKey(a.row),bDay=dayKey(b.row);
    if(aDay!==bDay)return bDay.localeCompare(aDay);

    // Older archive rows may no longer exist in the rolling direct snapshot. Prefer the value
    // date before archive id for a deterministic, bank-semantic fallback; never treat id as time.
    const aValue=valueDate(a.row),bValue=valueDate(b.row);
    if(aValue!==bValue)return bValue.localeCompare(aValue);

    const dateDelta=rowDate(b.row).localeCompare(rowDate(a.row));
    if(dateDelta)return dateDelta;

    const idDelta=numericId(b.row)-numericId(a.row);
    if(idDelta)return idDelta;
    return a.index-b.index;
  }).map(item=>item.row);
}
