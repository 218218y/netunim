import {checkNum, kupaWholeMoney} from '../../core/money.js';
import {checkAddMonthsISO, checkLocalISO, checkDateObj, checkMonthKey, checkTodayISO} from '../../core/dates.js';
import {normalizeSharedChecks} from '../checks/model.js';

const CREDIT_PROVIDER_LABELS={visaCal:'כאל',max:'MAX',isracard:'ישראכרט',amex:'American Express'};
function finite(value){if(value===null||value===undefined||value==='')return null;const n=Number(value);return Number.isFinite(n)?n:null}
function shekelTransaction(tx){const currency=String(tx?.chargedCurrency||tx?.originalCurrency||'ILS').trim().toUpperCase().replace(/\s+/g,'');return !currency||['ILS','NIS','₪','ש״ח','שח'].includes(currency)}
function creditMappingKey(profileId,accountNumber){return `${String(profileId||'').trim()}:${String(accountNumber||'').trim()}`}
function synchronizedCardKey(profile,account){return `sync:${profile?.profileId||''}:${account?.accountNumber||''}`}

export function kupaCreditSchedule(cr){if(!cr?.active||!cr.firstChargeDate||checkNum(cr.installments)<1)return[];const total=kupaWholeMoney(cr.totalAmount),n=Math.max(1,Math.round(checkNum(cr.installments))),base=Math.round((total/n)*100)/100;let rows=[],used=0;for(let i=0;i<n;i++){const amount=i===n-1?Math.round((total-used)*100)/100:base;used+=amount;rows.push({creditId:cr.id,date:checkAddMonthsISO(cr.firstChargeDate,i),amount,part:i+1,totalParts:n,card:cr.card,account:cr.account==='ביתי'?'ביתי':'עסקי'})}return rows}

export function kupaSyncedInstallments(kupa){
  const sync=kupa?.creditSync&&typeof kupa.creditSync==='object'?kupa.creditSync:{},rows=[],seen=new Set();
  for(const profile of Array.isArray(sync.profiles)?sync.profiles:[])for(const account of Array.isArray(profile?.accounts)?profile.accounts:[]){
    const mapping=sync.cardMappings?.[creditMappingKey(profile.profileId,account.accountNumber)]||{};
    if(mapping.included!==true)continue;
    const card=mapping.cardName||[CREDIT_PROVIDER_LABELS[profile.provider]||profile.label||'כרטיס אשראי',account.accountNumber?`••${String(account.accountNumber).slice(-4)}`:''].filter(Boolean).join(' '),accountClass=mapping.account==='ביתי'?'ביתי':'עסקי';
    for(const [index,tx] of (Array.isArray(account.txns)?account.txns:[]).entries()){
      if(tx?.status==='pending'||!shekelTransaction(tx))continue;
      const date=String(tx?.processedDate||tx?.date||'').slice(0,10),raw=finite(tx?.chargedAmount)??finite(tx?.originalAmount),amount=raw===null?0:-raw;
      if(!date||!amount)continue;
      const part=Math.max(1,Math.trunc(Number(tx?.installments?.number)||1)),totalParts=Math.max(1,Math.trunc(Number(tx?.installments?.total)||1));
      const stable=tx?.id?`${tx.id}|${date}|${amount}|${tx.description||''}|${part}`:`idless-${index}|${date}|${amount}|${tx?.description||''}|${part}`,identity=`${profile.profileId||''}|${account.accountNumber||''}|${stable}`;
      if(seen.has(identity))continue;seen.add(identity);
      rows.push({creditId:`SYNC:${identity}`,creditAccountKey:synchronizedCardKey(profile,account),date,amount,part,totalParts,card,account:accountClass,source:'credit_sync'});
    }
  }
  return rows;
}

export function kupaAllInstallments(kupa){return [...kupaSyncedInstallments(kupa),...(Array.isArray(kupa?.credits)?kupa.credits:[]).flatMap(kupaCreditSchedule)]}

export function kupaBusinessInstallments(kupa){return kupaAllInstallments(kupa).filter(row=>row.account==='עסקי')}

export function kupaExpenseOccurrencesForMonth(kupa,key){const [yy,mm]=String(key||'').split('-').map(Number);if(!yy||!mm)return[];const end=new Date(yy,mm,0);return (Array.isArray(kupa?.expenses)?kupa.expenses:[]).filter(x=>x.active).flatMap(x=>{let due;if(x.recurring!==false){const base=checkDateObj(x.date||`${key}-01`);const day=Math.max(1,Math.min(base?.getDate()||1,end.getDate()));due=checkLocalISO(new Date(yy,mm-1,day))}else{if(checkMonthKey(x.date)!==key)return[];due=x.date}return [{...x,dueDate:due}]})}

export function kupaNextCreditCycle(kupa,reference=checkTodayISO()){const future=kupaBusinessInstallments(kupa).filter(x=>x.date>=reference),byCard=new Map();future.forEach(x=>{const key=x.creditAccountKey||`manual:${x.card}`,cur=byCard.get(key);if(!cur||x.date<cur)byCard.set(key,x.date)});const rows=future.filter(x=>byCard.get(x.creditAccountKey||`manual:${x.card}`)===x.date).sort((a,b)=>a.date.localeCompare(b.date)||String(a.card).localeCompare(String(b.card))),targetDate=rows.length?rows.reduce((m,x)=>x.date>m?x.date:m,rows[0].date):reference;return {targetMonth:checkMonthKey(targetDate)}}

export function computeKupaNetReadoutData(state,kupa){if(!kupa||typeof kupa!=='object')return null;const bankObj=kupa.bank&&typeof kupa.bank==='object'?kupa.bank:{},rawBase=bankObj.currentBalance;if(rawBase===null||rawBase===undefined||rawBase==='')return {net:null};const sharedChecks=normalizeSharedChecks(state.checks),manualAdjustments=(Array.isArray(bankObj.adjustments)?bankObj.adjustments:[]).filter(x=>x?.type!=='check_deposit'),bank=kupaWholeMoney(rawBase)+manualAdjustments.reduce((a,x)=>a+kupaWholeMoney(x.amount),0),start=bankObj.asOfDate||(bankObj.updatedAt?String(bankObj.updatedAt).slice(0,10):checkTodayISO()),cycle=kupaNextCreditCycle(kupa,checkTodayISO()),credit=kupaBusinessInstallments(kupa).filter(x=>x.date>=start).reduce((a,x)=>a+x.amount,0),expenseRows=kupaExpenseOccurrencesForMonth(kupa,cycle.targetMonth).filter(x=>cycle.targetMonth!==checkMonthKey(start)||x.dueDate>=start),expenses=expenseRows.reduce((a,x)=>a+kupaWholeMoney(x.amount),0),cash=(Array.isArray(kupa.cash)?kupa.cash:[]).reduce((a,x)=>a+kupaWholeMoney(x.amount),0),checks=sharedChecks.filter(x=>x.status==='בקופה').reduce((a,x)=>a+kupaWholeMoney(x.amount),0);return {bank,credit,expenses,cash,checks,kupa:cash+checks,net:bank-credit-expenses+cash+checks}}
