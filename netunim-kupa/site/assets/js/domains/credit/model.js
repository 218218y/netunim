import {num} from '../../core/money.js';
import {addMonthsISO, todayISO, dObj, monthKey, localISO} from '../../core/dates.js';
import {syncedInstallmentsData, syncedCreditSeries} from './sync-feed.js';

export const CREDIT_DETAIL_HISTORY_DAYS=60;

export function rawCreditSchedule(cr){if(!cr.firstChargeDate||num(cr.installments)<1)return[];const total=num(cr.totalAmount),n=Number(cr.installments);const base=Math.round((total/n)*100)/100;let rows=[];let used=0;for(let i=0;i<n;i++){let amt=i===n-1?Math.round((total-used)*100)/100:base;used+=amt;rows.push({creditId:cr.id,date:addMonthsISO(cr.firstChargeDate,i),amount:amt,part:i+1,totalParts:n,card:cr.card,account:cr.account,ownerLabel:String(cr.ownerLabel||''),hidden:false,description:cr.description,source:'manual'})}return rows}

export function creditSchedule(cr){return cr.active?rawCreditSchedule(cr):[]}

export function inactiveCreditExpired(cr,asOf=todayISO()){if(cr?.active!==false)return false;const rows=rawCreditSchedule(cr);if(!rows.length)return false;const last=rows[rows.length-1].date;return Math.floor((dObj(asOf)-dObj(last))/86400000)>60}

export function creditProgress(cr,asOf=todayISO()){const schedule=creditSchedule(cr);const completed=schedule.filter(x=>x.date<asOf);const pending=schedule.filter(x=>x.date>=asOf);return {schedule,completed,pending,completedCount:completed.length,remainingCount:pending.length,next:pending[0]||null,remainingAmount:pending.reduce((a,x)=>a+x.amount,0),complete:cr.active&&schedule.length>0&&pending.length===0}}

export function pendingInstallmentsData(state){return allInstallmentsData(state).filter(x=>x.date>=todayISO())}

// From credit sync v3 onward the issuer feed is always the primary source. Manual rows are explicit additive exceptions.
export function allInstallmentsData(state){return [...syncedInstallmentsData(state),...(Array.isArray(state?.credits)?state.credits:[]).flatMap(creditSchedule)]}

export function monthSumInstallmentsData(state,key,pendingOnly=false){const rows=pendingOnly?pendingInstallmentsData(state):allInstallmentsData(state);return rows.filter(x=>monthKey(x.date)===key).reduce((a,x)=>a+x.amount,0)}

export function nextChargeDateData(state,cardName,tx){const card=state.cards.find(c=>c.name===cardName);if(!tx)return '';const d=dObj(tx),day=card?.chargeDay||10;let y=d.getFullYear(),m=d.getMonth();if(d.getDate()>day)m++;const x=new Date(y,m,1);const last=new Date(x.getFullYear(),x.getMonth()+1,0).getDate();x.setDate(Math.min(day,last));return localISO(x)}

export function nextCreditCycleData(state,reference=todayISO()){
  const future=allInstallmentsData(state).filter(x=>x.date>=reference);
  const byCard=new Map();
  const cardKey=x=>x.creditAccountKey||`manual:${x.card}`;
  future.forEach(x=>{const key=cardKey(x),cur=byCard.get(key);if(!cur||x.date<cur)byCard.set(key,x.date)});
  const rows=future.filter(x=>byCard.get(cardKey(x))===x.date).sort((a,b)=>a.date.localeCompare(b.date)||String(a.card).localeCompare(String(b.card)));
  const targetDate=rows.length?rows.reduce((m,x)=>x.date>m?x.date:m,rows[0].date):reference;
  const targetMonth=monthKey(targetDate);
  const [y,m]=targetMonth.split('-').map(Number);
  const targetEnd=localISO(new Date(y,m,0));
  return {rows,total:rows.reduce((a,x)=>a+x.amount,0),targetDate,targetMonth,targetEnd};
}

function historyCutoff(asOf,days){const d=dObj(asOf);if(!d)return asOf;d.setDate(d.getDate()-Math.max(0,Math.trunc(Number(days)||0)));return localISO(d)}

export function creditDetailPartitionsData(state,asOf=todayISO(),historyDays=CREDIT_DETAIL_HISTORY_DAYS){
  const items=[];
  for(const series of syncedCreditSeries(state,asOf))items.push({source:'credit_sync',series,account:series.account,ownerLabel:series.ownerLabel,nextDate:series.next?.date||'9999-12-31',completedDate:series.complete?series.lastChargeDate:null,complete:series.complete});
  for(const record of Array.isArray(state?.credits)?state.credits:[]){const progress=creditProgress(record,asOf),schedule=rawCreditSchedule(record),lastDate=schedule.at(-1)?.date||null,complete=record.active===false||progress.complete;items.push({source:'manual',record,progress,account:record.account,ownerLabel:record.ownerLabel||'',nextDate:progress.next?.date||'9999-12-31',completedDate:complete?lastDate:null,complete})}
  const active=items.filter(x=>!x.complete).sort((a,b)=>a.nextDate.localeCompare(b.nextDate)||String((a.series||a.record)?.card||'').localeCompare(String((b.series||b.record)?.card||''),'he'));
  const cutoff=historyCutoff(asOf,historyDays),completed=items.filter(x=>x.complete),history=completed.filter(x=>x.completedDate&&x.completedDate>=cutoff).sort((a,b)=>String(b.completedDate).localeCompare(String(a.completedDate))||String((a.series||a.record)?.card||'').localeCompare(String((b.series||b.record)?.card||''),'he'));
  return {active,history,olderCount:completed.length-history.length,cutoff,historyDays};
}
