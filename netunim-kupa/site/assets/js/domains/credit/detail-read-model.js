// @ts-check
import {
  creditDetailMonthIsPast,creditDetailRangeMatch,creditDetailQuickPeriodMatch,
  creditViewAllowsMonth,creditDetailDayMatch,creditDetailMonthDayMatch,creditDetailFutureMonths,
} from '../../shared/credit-detail-policy.js';
/** @typedef {import('../../shared/credit-detail-read-contracts.js').DetailRow} DetailRow */

/** @param {string} profileId @param {string} accountNumber */
export function synchronizedCardKey(profileId,accountNumber){
  return `sync:${profileId}:${accountNumber}`;
}

/** @param {Partial<DetailRow>} row */
export function rowCardKey(row){
  if(row?.creditAccountKey)return row.creditAccountKey;
  if(row?.profileId&&row?.accountNumber)return synchronizedCardKey(row.profileId,row.accountNumber);
  if(row?.source==='manual'&&row?.card)return `manual:${row.card}`;
  return '';
}

/**
 * @param {Pick<import('../../shared/credit-detail-read-contracts.js').DetailQuery,'creditAccountFilter'|'creditProviderFilter'|'creditCardFilter'>} filters
 * @param {DetailRow} row
 */
export function filterMatch(filters,row){
  const account=filters.creditAccountFilter||'all';
  const provider=filters.creditProviderFilter||'all';
  const card=filters.creditCardFilter||'all';
  if(account!=='all'&&row.account!==account)return false;
  if(provider!=='all'&&row.provider!==provider)return false;
  if(card!=='all'&&rowCardKey(row)!==card)return false;
  return true;
}

/**
 * Select from the existing revision projection. The caller applies returned
 * focus only in month mode; period/upcoming reads retain the previous UI focus.
 * @template {DetailRow} R
 * @param {import('../../shared/credit-detail-read-contracts.js').KupaDetailInput<R>} input
 * @returns {import('../../shared/credit-detail-read-contracts.js').KupaDetailReport<R>}
 */
export function selectKupaCreditDetail({prepared,query,reference,matches}){
  const mode=['month','range','all','recent3'].includes(query.creditDetailMode)?query.creditDetailMode:'upcoming';
  const chargeDay=query.creditDetailChargeDay==='10'||query.creditDetailChargeDay==='15'?query.creditDetailChargeDay:'all';
  const currentMonth=reference.slice(0,7);
  const allDetailMonths=prepared.detail.months.map(month=>{
    const items=month.items.filter(item=>filterMatch(query,item));
    const missingAmountCount=items.filter(row=>row.amountStatus!=='known_ils').length;
    const coverageGapCount=items.filter(row=>row.coverageIncomplete).length;
    const incompleteCount=items.filter(row=>!row.includedInIlsTotal||row.coverageIncomplete).length;
    return {...month,items,total:items.reduce((sum,item)=>sum+item.amount,0),
      missingAmountCount,coverageGapCount,incompleteCount,partial:incompleteCount>0};
  }).filter(month=>month.items.length);
  const historyMonths=allDetailMonths.filter(month=>creditDetailMonthIsPast(month,reference));
  const detailMonths=allDetailMonths.filter(month=>!creditDetailMonthIsPast(month,reference)
    &&(month.key==='unassigned'||creditViewAllowsMonth(month.key,query.creditView,currentMonth)));
  const selectableMonths=[...historyMonths,...detailMonths];
  const allUpcomingItems=prepared.upcoming.items.filter(item=>filterMatch(query,item));
  const base={mode,chargeDay,detailMonths,historyMonths};

  if(mode==='range'||mode==='all'||mode==='recent3'){
    const allItems=allDetailMonths.flatMap(month=>month.items);
    const focusedItems=mode==='range'
      ?allItems.filter(item=>creditDetailRangeMatch(item,query.creditDateFrom,query.creditDateTo))
      :allItems.filter(item=>creditDetailQuickPeriodMatch(item,mode,reference));
    return {...base,chargeDay:'all',futureMonths:creditDetailFutureMonths(detailMonths,allUpcomingItems),
      detailFocus:null,detailItems:focusedItems.filter(matches),focusedCount:focusedItems.length,
      detailFocusLabel:'',upcomingTotal:0};
  }
  if(mode==='upcoming'){
    const focusedItems=allUpcomingItems.filter(item=>creditDetailDayMatch(item,chargeDay));
    return {...base,futureMonths:creditDetailFutureMonths(detailMonths,allUpcomingItems),
      detailFocus:null,detailItems:focusedItems.filter(matches),focusedCount:focusedItems.length,
      detailFocusLabel:'',upcomingTotal:allUpcomingItems.reduce((sum,item)=>sum+item.amount,0)};
  }

  const nearestDetailMonth=detailMonths.find(month=>month.key!=='unassigned'
    &&month.items.some(item=>(item.date||item.detailDisplayBillingDate||'')>=reference))?.key
    ||detailMonths.find(month=>month.key===currentMonth)?.key
    ||detailMonths.find(month=>month.key!=='unassigned')?.key
    ||historyMonths.at(-1)?.key||detailMonths.at(-1)?.key||currentMonth;
  let detailFocus=query.creditDetailFocus;
  if(!selectableMonths.length){
    detailFocus=null;
  }else{
    if(!detailFocus||!selectableMonths.some(month=>month.key===detailFocus?.monthKey)){
      detailFocus={monthKey:nearestDetailMonth,cardKey:''};
    }
    const selected=selectableMonths.find(month=>month.key===detailFocus?.monthKey);
    if(detailFocus.cardKey&&!selected?.items.some(item=>rowCardKey(item)===detailFocus?.cardKey)){
      detailFocus={monthKey:detailFocus.monthKey,cardKey:''};
    }
  }
  const detailMonth=detailFocus?selectableMonths.find(month=>month.key===detailFocus?.monthKey):null;
  const focusedItems=(detailMonth?.items||[]).filter(item=>(!detailFocus?.cardKey||rowCardKey(item)===detailFocus.cardKey)
    &&creditDetailMonthDayMatch(item,chargeDay));
  const focusRow=detailFocus?.cardKey?detailMonth?.items.find(item=>rowCardKey(item)===detailFocus?.cardKey):null;
  return {...base,futureMonths:creditDetailFutureMonths(detailMonths,allUpcomingItems,detailFocus?.monthKey||''),
    detailFocus,detailItems:focusedItems.filter(matches),focusedCount:focusedItems.length,
    detailFocusLabel:focusRow?.hidden?'כרטיסים מוסתרים':focusRow?.card||'',upcomingTotal:0};
}
