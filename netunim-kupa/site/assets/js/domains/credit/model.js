import {num} from '../../core/money.js';
import {addMonthsISO, todayISO, dObj, monthKey, localISO} from '../../core/dates.js';
import {syncedInstallmentsData, syncedCreditSeries, syncedPendingTransactionsData, syncedForeignCurrencyTransactionsData} from './sync-feed.js';

export const CREDIT_DETAIL_HISTORY_MONTHS=3;

export function creditDetailItemIdentity(item={}){
  if(item.source==='manual')return `manual:${String(item.record?.id||'')}:${String(item.date||'')}:${Number(item.part||1)}`;
  if(item.source==='credit_pending')return `pending:${String(item.pending?.id||item.id||'')}:${String(item.date||'')}`;
  if(item.source==='credit_foreign')return `foreign:${String(item.foreign?.id||item.id||'')}:${String(item.date||'')}:${Number(item.part||1)}`;
  return `sync:${String(item.series?.id||'')}:${String(item.date||'')}:${Number(item.part||1)}`;
}

export function rawCreditSchedule(cr){if(!cr.firstChargeDate||num(cr.installments)<1)return[];const total=num(cr.totalAmount),n=Number(cr.installments);const base=Math.round((total/n)*100)/100;let rows=[];let used=0;for(let i=0;i<n;i++){let amt=i===n-1?Math.round((total-used)*100)/100:base;used+=amt;rows.push({creditId:cr.id,date:addMonthsISO(cr.firstChargeDate,i),amount:amt,part:i+1,totalParts:n,card:cr.card,account:cr.account==='ביתי'?'ביתי':'עסקי',ownerLabel:String(cr.ownerLabel||''),hidden:false,description:cr.description,source:'manual'})}return rows}

export function creditSchedule(cr){return cr.active?rawCreditSchedule(cr):[]}

export function inactiveCreditExpired(cr,asOf=todayISO()){if(cr?.active!==false)return false;const rows=rawCreditSchedule(cr);if(!rows.length)return false;const last=rows[rows.length-1].date;return Math.floor((dObj(asOf)-dObj(last))/86400000)>60}

export function creditProgress(cr,asOf=todayISO()){const schedule=creditSchedule(cr);const completed=schedule.filter(x=>x.date<asOf);const pending=schedule.filter(x=>x.date>=asOf);return {schedule,completed,pending,completedCount:completed.length,remainingCount:pending.length,next:pending[0]||null,remainingAmount:pending.reduce((a,x)=>a+x.amount,0),complete:cr.active&&schedule.length>0&&pending.length===0}}

export function allInstallmentsData(state){return [...syncedInstallmentsData(state),...(Array.isArray(state?.credits)?state.credits:[]).flatMap(creditSchedule)]}

export function pendingInstallmentsData(state){return allInstallmentsData(state).filter(x=>x.date>=todayISO())}

// Credit-page visibility and Kupa cash-flow ownership are intentionally separate.
// Every explicitly included card remains visible in credit reporting, while only
// obligations classified as business are allowed to affect business cash/bank math.
export function accountInstallmentsData(state,account='עסקי'){const target=account==='ביתי'?'ביתי':'עסקי';return allInstallmentsData(state).filter(x=>x.account===target)}

export function businessInstallmentsData(state){return accountInstallmentsData(state,'עסקי')}

export function homeInstallmentsData(state){return accountInstallmentsData(state,'ביתי')}

export function pendingBusinessInstallmentsData(state){return businessInstallmentsData(state).filter(x=>x.date>=todayISO())}

export function monthSumInstallmentsData(state,key,pendingOnly=false){const rows=pendingOnly?pendingInstallmentsData(state):allInstallmentsData(state);return rows.filter(x=>monthKey(x.date)===key).reduce((a,x)=>a+x.amount,0)}

export function monthSumBusinessInstallmentsData(state,key,pendingOnly=false){const rows=pendingOnly?pendingBusinessInstallmentsData(state):businessInstallmentsData(state);return rows.filter(x=>monthKey(x.date)===key).reduce((a,x)=>a+x.amount,0)}

export function nextChargeDateData(state,cardName,tx){const card=state.cards.find(c=>c.name===cardName);if(!tx)return '';const d=dObj(tx),day=card?.chargeDay||10;let y=d.getFullYear(),m=d.getMonth();if(d.getDate()>day)m++;const x=new Date(y,m,1);const last=new Date(x.getFullYear(),x.getMonth()+1,0).getDate();x.setDate(Math.min(day,last));return localISO(x)}

function nextCreditCycleFromRows(rows,reference){
  const future=rows.filter(x=>x.date>=reference);
  const byCard=new Map();
  const cardKey=x=>x.creditAccountKey||`manual:${x.card}`;
  future.forEach(x=>{const key=cardKey(x),cur=byCard.get(key);if(!cur||x.date<cur)byCard.set(key,x.date)});
  const cycleRows=future.filter(x=>byCard.get(cardKey(x))===x.date).sort((a,b)=>a.date.localeCompare(b.date)||String(a.card).localeCompare(String(b.card)));
  const targetDate=cycleRows.length?cycleRows.reduce((m,x)=>x.date>m?x.date:m,cycleRows[0].date):reference;
  const targetMonth=monthKey(targetDate);
  const [y,m]=targetMonth.split('-').map(Number);
  const targetEnd=localISO(new Date(y,m,0));
  return {rows:cycleRows,total:cycleRows.reduce((a,x)=>a+x.amount,0),targetDate,targetMonth,targetEnd};
}

export function nextCreditCycleData(state,reference=todayISO()){return nextCreditCycleFromRows(allInstallmentsData(state),reference)}

export function nextAccountCreditCycleData(state,account='עסקי',reference=todayISO()){return nextCreditCycleFromRows(accountInstallmentsData(state,account),reference)}

export function nextBusinessCreditCycleData(state,reference=todayISO()){return nextAccountCreditCycleData(state,'עסקי',reference)}

export function nextHomeCreditCycleData(state,reference=todayISO()){return nextAccountCreditCycleData(state,'ביתי',reference)}

export function creditMonthlyDetailData(state,asOf=todayISO(),historyMonths=CREDIT_DETAIL_HISTORY_MONTHS){
  const currentMonth=monthKey(asOf),safeHistory=Math.max(0,Math.trunc(Number(historyMonths)||0));
  const cutoffMonth=monthKey(addMonthsISO(`${currentMonth}-01`,-safeHistory)),items=[];
  for(const series of syncedCreditSeries(state,asOf)){
    for(const charge of series.items){
      const key=monthKey(charge.date);if(!key||key<cutoffMonth)continue;
      items.push({source:'credit_sync',series,charge,date:charge.date,amount:charge.amount,part:charge.part,totalParts:charge.totalParts,transactionDate:charge.transactionDate||series.transactionDate||'',transactionTime:charge.transactionTime||series.transactionTime||'',account:series.account,ownerLabel:series.ownerLabel,provider:series.provider,profileId:series.profileId,accountNumber:series.accountNumber,creditAccountKey:`sync:${series.profileId}:${series.accountNumber}`,card:series.card,description:series.description,foreignCurrency:series.foreignCurrency===true,originalCurrency:series.originalCurrency||'',status:'completed'});
    }
  }
  for(const pending of syncedPendingTransactionsData(state,asOf)){
    const key=monthKey(pending.date);if(!key||key<cutoffMonth)continue;
    // Pending authorizations are first-class credit-page rows. Only a fresh, ILS-valued
    // approval contributes to the provisional credit-page monthly forecast; stale LKG or
    // foreign-only approvals stay visible with a zero ILS contribution until the issuer
    // supplies a current/final billing amount.
    const forecastAmount=pending.pendingFresh&&pending.isShekel?pending.amount:0;
    // Keep provisional billing and purchase value separate. Some issuers (notably MAX pending
    // approvals) can expose chargedAmount=0 until settlement while originalAmount already contains
    // the real authorized purchase amount. That zero must remain zero in the provisional monthly
    // charge, but it must not erase the known purchase value in the "transaction amount" column.
    const pendingOriginal=Number(pending.originalAmount),transactionAmount=pending.foreignCurrency!==true&&Number.isFinite(pendingOriginal)&&Math.abs(pendingOriginal)>0.004?Math.abs(pendingOriginal):pending.amount;
    items.push({source:'credit_pending',pending,id:pending.id,date:pending.date,amount:forecastAmount,displayAmount:pending.amount,transactionAmount,displayCurrency:pending.currency,part:1,totalParts:1,transactionDate:pending.transactionDate,transactionTime:pending.transactionTime||'',account:pending.account,ownerLabel:pending.ownerLabel,provider:pending.provider,profileId:pending.profileId,accountNumber:pending.accountNumber,creditAccountKey:pending.creditAccountKey,card:pending.card,description:pending.description,foreignCurrency:pending.foreignCurrency===true,originalAmount:pending.originalAmount,originalCurrency:pending.originalCurrency||'',pendingFresh:pending.pendingFresh,chargeDateSource:pending.chargeDateSource,status:'pending'});
  }
  for(const foreign of syncedForeignCurrencyTransactionsData(state)){
    const key=monthKey(foreign.date);if(!key||key<cutoffMonth)continue;
    items.push({source:'credit_foreign',foreign,id:foreign.id,date:foreign.date,amount:0,displayAmount:foreign.amount,displayCurrency:foreign.currency,part:foreign.part,totalParts:foreign.totalParts,transactionDate:foreign.transactionDate,transactionTime:foreign.transactionTime||'',account:foreign.account,ownerLabel:foreign.ownerLabel,provider:foreign.provider,profileId:foreign.profileId,accountNumber:foreign.accountNumber,creditAccountKey:foreign.creditAccountKey,card:foreign.card,description:foreign.description,foreignCurrency:true,originalAmount:foreign.originalAmount,originalCurrency:foreign.originalCurrency||'',status:foreign.status||'completed'});
  }
  for(const record of Array.isArray(state?.credits)?state.credits:[]){
    for(const charge of rawCreditSchedule(record)){
      if(record.active===false&&charge.date>=asOf)continue;
      const key=monthKey(charge.date);if(!key||key<cutoffMonth)continue;
      items.push({source:'manual',record,charge,date:charge.date,amount:charge.amount,part:charge.part,totalParts:charge.totalParts,transactionDate:record.transactionDate||'',account:record.account==='ביתי'?'ביתי':'עסקי',ownerLabel:String(record.ownerLabel||''),provider:'manual',profileId:'',accountNumber:'',creditAccountKey:`manual:${record.card}`,card:record.card,description:record.description});
    }
  }
  const detailSort=(a,b)=>String(b.transactionDate||b.date||'').localeCompare(String(a.transactionDate||a.date||''))||String(b.date||'').localeCompare(String(a.date||''))||String(a.card||'').localeCompare(String(b.card||''),'he')||String(a.description||'').localeCompare(String(b.description||''),'he');
  const byMonth=new Map();
  for(const item of items){const key=monthKey(item.date);if(!byMonth.has(key))byMonth.set(key,{key,total:0,items:[]});const month=byMonth.get(key);month.total+=item.amount;month.items.push(item)}
  for(const month of byMonth.values())month.items.sort(detailSort);
  return {months:[...byMonth.values()].sort((a,b)=>a.key.localeCompare(b.key)),cutoffMonth,historyMonths:safeHistory,currentMonth};
}
