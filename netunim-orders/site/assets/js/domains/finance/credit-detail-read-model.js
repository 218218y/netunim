// @ts-check
import {
  creditDetailMonthIsPast,creditDetailRangeMatch,creditDetailQuickPeriodMatch,
  creditDetailDayMatch,creditDetailMonthDayMatch,creditDetailFutureMonths,
} from '../../shared/credit-detail-policy.js';

/**
 * Orders keeps its existing month-key preference and read-only report policy.
 * No UI state, authoritative records, storage or DOM is mutated here.
 * @template {import('../../shared/credit-detail-read-contracts.js').DetailRow} R
 * @param {import('../../shared/credit-detail-read-contracts.js').OrdersDetailInput<R>} input
 * @returns {import('../../shared/credit-detail-read-contracts.js').OrdersDetailReport<R>}
 */
export function selectOrdersCreditDetail({allMonths,upcomingRows,query,reference,matches}){
  const current=reference.slice(0,7);
  const mode=['month','range','all','recent3'].includes(query.creditDetailMode)?query.creditDetailMode:'upcoming';
  const chargeDay=query.creditDetailChargeDay==='10'||query.creditDetailChargeDay==='15'?query.creditDetailChargeDay:'all';
  const historyMonths=allMonths.filter(month=>creditDetailMonthIsPast(month,reference));
  const months=allMonths.filter(month=>!creditDetailMonthIsPast(month,reference));
  const selectableMonths=[...historyMonths,...months];
  const base={mode,chargeDay,historyMonths,months,upcomingTotal:upcomingRows.reduce((sum,row)=>sum+row.amount,0)};
  if(mode!=='month'){
    const allRows=allMonths.flatMap(month=>month.items);
    const periodRows=mode==='upcoming'?upcomingRows:mode==='range'
      ?allRows.filter(row=>creditDetailRangeMatch(row,query.creditDateFrom,query.creditDateTo))
      :allRows.filter(row=>creditDetailQuickPeriodMatch(row,mode,reference));
    const focusedRows=mode==='upcoming'?periodRows.filter(row=>creditDetailDayMatch(row,chargeDay)):periodRows;
    return {...base,focus:null,selected:null,items:focusedRows.filter(matches),focusedCount:focusedRows.length,
      futureMonths:creditDetailFutureMonths(months)};
  }
  const first=selectableMonths[0];
  if(!first)return {...base,focus:null,selected:null,items:[],focusedCount:0,
    futureMonths:creditDetailFutureMonths(months)};

  let focus=query.creditDetailFocus;
  if(!focus||!selectableMonths.some(month=>month.key===focus?.monthKey)){
    focus={monthKey:months.find(month=>month.key!=='unassigned'&&month.key>=current)?.key
      ||months.find(month=>month.key===current)?.key||months.find(month=>month.key!=='unassigned')?.key
      ||historyMonths.at(-1)?.key||months.at(-1)?.key||first.key,cardKey:''};
  }
  const selected=selectableMonths.find(month=>month.key===focus?.monthKey)||first;
  if(focus.cardKey&&!selected.items.some(row=>(row.creditAccountKey||'')===focus?.cardKey)){
    focus={monthKey:selected.key,cardKey:''};
  }
  const focusedRows=selected.items.filter(row=>(!focus?.cardKey||(row.creditAccountKey||'')===focus.cardKey)
    &&creditDetailMonthDayMatch(row,chargeDay));
  return {...base,focus,selected,items:focusedRows.filter(matches),focusedCount:focusedRows.length,
    futureMonths:creditDetailFutureMonths(months)};
}

/**
 * @typedef {{card:string, account:string, ownerLabel?:string, creditAccountKey?:string, hidden?:boolean,
 * date:string, amount:number, status?:string, amountStatus?:string, coverageIncomplete?:boolean,
 * includedInIlsTotal?:boolean, bankPendingSettlementDetected?:boolean}} ForecastRow
 * @typedef {{card:string, account:string, ownerLabel:string|undefined, cardKey:string, billingDate:string,
 * total:number, pendingCount:number, incompleteCount:number, missingAmountCount:number,
 * coverageGapCount:number, bankPendingSettlementDetected:boolean}} ForecastCard
 */

/** @param {readonly ForecastRow[]} rows */
export function creditForecastCardGroups(rows) {
    /** @type {Map<string, ForecastCard>} */
    const groups = new Map();
    for (const row of rows) {
        const cardKey = row.hidden ? '' : row.creditAccountKey || '';
        const key = row.hidden ? 'hidden' : cardKey || `${row.card}\u0000${row.account}\u0000${row.ownerLabel || ''}`;
        let group = groups.get(key);
        if (!group) {
            group = {
                card: row.card,
                account: row.account,
                ownerLabel: row.ownerLabel,
                cardKey,
                billingDate: row.date,
                total: 0,
                pendingCount: 0,
                incompleteCount: 0,
                missingAmountCount: 0,
                coverageGapCount: 0,
                bankPendingSettlementDetected: false,
            };
            groups.set(key, group);
        }
        if (row.date && (!group.billingDate || row.date < group.billingDate))
            group.billingDate = row.date;
        group.total += row.amount;
        if (row.status === 'pending')
            group.pendingCount++;
        if (row.amountStatus !== 'known_ils')
            group.missingAmountCount++;
        if (row.coverageIncomplete)
            group.coverageGapCount++;
        if (!row.includedInIlsTotal || row.coverageIncomplete)
            group.incompleteCount++;
        if (row.bankPendingSettlementDetected)
            group.bankPendingSettlementDetected = true;
    }
    return [...groups.values()].sort((a, b) => String(a.card).localeCompare(String(b.card), 'he'));
}
