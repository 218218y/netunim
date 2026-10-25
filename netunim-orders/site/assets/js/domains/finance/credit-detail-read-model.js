// @ts-check
import {
  creditDetailMonthIsPast,creditDetailRangeMatch,creditDetailQuickPeriodMatch,
  creditViewAllowsMonth,creditDetailDayMatch,creditDetailMonthDayMatch,creditDetailFutureMonths,
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
  const months=allMonths.filter(month=>!creditDetailMonthIsPast(month,reference)
    &&(month.key==='unassigned'||creditViewAllowsMonth(month.key,query.creditView,current)));
  const selectableMonths=[...historyMonths,...months];
  const base={mode,chargeDay,historyMonths,months,upcomingTotal:upcomingRows.reduce((sum,row)=>sum+row.amount,0)};
  if(mode!=='month'){
    const allRows=allMonths.flatMap(month=>month.items);
    const periodRows=mode==='upcoming'?upcomingRows:mode==='range'
      ?allRows.filter(row=>creditDetailRangeMatch(row,query.creditDateFrom,query.creditDateTo))
      :allRows.filter(row=>creditDetailQuickPeriodMatch(row,mode,reference));
    const focusedRows=mode==='upcoming'?periodRows.filter(row=>creditDetailDayMatch(row,chargeDay)):periodRows;
    return {...base,focus:null,selected:null,items:focusedRows.filter(matches),focusedCount:focusedRows.length,
      futureMonths:creditDetailFutureMonths(months,upcomingRows)};
  }
  const first=selectableMonths[0];
  if(!first)return {...base,focus:null,selected:null,items:[],focusedCount:0,
    futureMonths:creditDetailFutureMonths(months,upcomingRows)};

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
    futureMonths:creditDetailFutureMonths(months,upcomingRows,focus.monthKey)};
}
