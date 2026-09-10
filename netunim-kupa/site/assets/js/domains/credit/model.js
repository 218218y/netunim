import {num} from '../../core/money.js';
import {addMonthsISO,todayISO,dObj,monthKey,localISO} from '../../core/dates.js';
import {creditBillingRowsData,creditCyclesThroughHorizonData,creditForecastRowsData} from '../../shared/credit-billing-cycles.js';

export const CREDIT_DETAIL_HISTORY_MONTHS=3;

export function creditDetailItemIdentity(item={}){
  if(item.source==='manual')return `manual:${String(item.record?.id||item.creditId||'')}:${String(item.date||'')}:${Number(item.part||1)}`;
  if(item.source==='credit_pending')return `pending:${String(item.pending?.id||item.creditId||item.id||'')}:${String(item.date||'unassigned')}`;
  if(item.source==='credit_foreign')return `foreign:${String(item.foreign?.id||item.creditId||item.id||'')}:${String(item.date||'')}:${Number(item.part||1)}`;
  return `sync:${String(item.series?.id||item.creditId||'')}:${String(item.date||'')}:${Number(item.part||1)}`;
}

export function rawCreditSchedule(cr){if(!cr.firstChargeDate||num(cr.installments)<1)return[];const total=num(cr.totalAmount),n=Number(cr.installments),base=Math.round((total/n)*100)/100;let rows=[],used=0;for(let i=0;i<n;i++){const amt=i===n-1?Math.round((total-used)*100)/100:base;used+=amt;rows.push({creditId:cr.id,date:addMonthsISO(cr.firstChargeDate,i),amount:amt,part:i+1,totalParts:n,card:cr.card,account:cr.account==='ביתי'?'ביתי':'עסקי',ownerLabel:String(cr.ownerLabel||''),hidden:false,description:cr.description,source:'manual'})}return rows}

export function creditSchedule(cr){return cr.active?rawCreditSchedule(cr):[]}

export function inactiveCreditExpired(cr,asOf=todayISO()){if(cr?.active!==false)return false;const rows=rawCreditSchedule(cr);if(!rows.length)return false;const last=rows[rows.length-1].date;return Math.floor((dObj(asOf)-dObj(last))/86400000)>60}

export function creditProgress(cr,asOf=todayISO()){const schedule=creditSchedule(cr),completed=schedule.filter(x=>x.date<asOf),pending=schedule.filter(x=>x.date>=asOf);return {schedule,completed,pending,completedCount:completed.length,remainingCount:pending.length,next:pending[0]||null,remainingAmount:pending.reduce((a,x)=>a+x.amount,0),complete:cr.active&&schedule.length>0&&pending.length===0}}

export function allInstallmentsData(state,asOf=todayISO()){return creditBillingRowsData(state,{asOf}).filter(row=>row.date&&row.includedInIlsTotal&&Math.abs(row.amount)>0.004)}

export function pendingInstallmentsData(state,asOf=todayISO()){return allInstallmentsData(state,asOf).filter(row=>row.date>=asOf)}

export function creditForecastInstallmentsData(state,asOf=todayISO()){return creditForecastRowsData(state,{asOf}).filter(row=>row.includedInIlsTotal&&Math.abs(row.amount)>0.004)}

export function accountInstallmentsData(state,account='עסקי',asOf=todayISO()){const target=account==='ביתי'?'ביתי':'עסקי';return allInstallmentsData(state,asOf).filter(row=>row.account===target)}
export function businessInstallmentsData(state,asOf=todayISO()){return accountInstallmentsData(state,'עסקי',asOf)}
export function homeInstallmentsData(state,asOf=todayISO()){return accountInstallmentsData(state,'ביתי',asOf)}
export function pendingBusinessInstallmentsData(state,asOf=todayISO()){return businessInstallmentsData(state,asOf).filter(row=>row.date>=asOf)}
export function monthSumInstallmentsData(state,key,pendingOnly=false,asOf=todayISO()){const rows=pendingOnly?pendingInstallmentsData(state,asOf):allInstallmentsData(state,asOf);return rows.filter(row=>monthKey(row.date)===key).reduce((sum,row)=>sum+row.amount,0)}
export function monthSumBusinessInstallmentsData(state,key,pendingOnly=false,asOf=todayISO()){const rows=pendingOnly?pendingBusinessInstallmentsData(state,asOf):businessInstallmentsData(state,asOf);return rows.filter(row=>monthKey(row.date)===key).reduce((sum,row)=>sum+row.amount,0)}

export function nextChargeDateData(state,cardName,tx){const card=state.cards.find(item=>item.name===cardName);if(!tx)return '';const date=dObj(tx),day=card?.chargeDay||10;let year=date.getFullYear(),month=date.getMonth();if(date.getDate()>day)month++;const target=new Date(year,month,1),last=new Date(target.getFullYear(),target.getMonth()+1,0).getDate();target.setDate(Math.min(day,last));return localISO(target)}

export function nextCreditCycleData(state,reference=todayISO()){return creditCyclesThroughHorizonData(state,'all',reference)}
export function nextAccountCreditCycleData(state,account='עסקי',reference=todayISO()){return creditCyclesThroughHorizonData(state,account,reference)}
export function nextBusinessCreditCycleData(state,reference=todayISO()){return nextAccountCreditCycleData(state,'עסקי',reference)}
export function nextHomeCreditCycleData(state,reference=todayISO()){return nextAccountCreditCycleData(state,'ביתי',reference)}

export function creditMonthlyDetailData(state,asOf=todayISO(),historyMonths=CREDIT_DETAIL_HISTORY_MONTHS){
  const currentMonth=monthKey(asOf),safeHistory=Math.max(0,Math.trunc(Number(historyMonths)||0)),cutoffMonth=monthKey(addMonthsISO(`${currentMonth}-01`,-safeHistory)),rows=creditBillingRowsData(state,{asOf,includeHidden:false}),byMonth=new Map(),unassigned=[];
  for(const row of rows){
    const key=monthKey(row.date);if(!key){if(row.status==='pending')unassigned.push(row);continue}if(key<cutoffMonth)continue;
    if(!byMonth.has(key))byMonth.set(key,{key,total:0,items:[]});const month=byMonth.get(key);month.total+=row.amount;month.items.push(row);
  }
  const detailSort=(a,b)=>String(b.transactionDate||b.date||'').localeCompare(String(a.transactionDate||a.date||''))||String(b.date||'').localeCompare(String(a.date||''))||String(a.card||'').localeCompare(String(b.card||''),'he')||String(a.description||'').localeCompare(String(b.description||''),'he');
  for(const month of byMonth.values()){month.total=Math.round(month.total*100)/100;month.items.sort(detailSort)}
  const months=[...byMonth.values()].sort((a,b)=>a.key.localeCompare(b.key));if(unassigned.length){unassigned.sort(detailSort);months.push({key:'unassigned',total:0,items:unassigned,uncertain:true})}
  return {months,cutoffMonth,historyMonths:safeHistory,currentMonth,unassigned};
}
