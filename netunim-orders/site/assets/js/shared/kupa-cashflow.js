import {cashflowAlertForAccount,cashflowCheckCutoffDayForAccount} from './cashflow.js';

const CREDIT_PROVIDER_LABELS={visaCal:'כאל',max:'MAX',isracard:'ישראכרט',amex:'American Express'};
function finite(value){if(value===null||value===undefined||value==='')return null;const n=Number(value);return Number.isFinite(n)?n:null}
function num(value){const n=Number(value);return Number.isFinite(n)?n:0}
function accountRole(value){return value==='ביתי'||value==='home'?'ביתי':'עסקי'}
function expenseBelongsTo(row,account){return accountRole(row?.account)===accountRole(account)}
export function kupaExpenseBelongsToAccountData(row,account='עסקי'){return expenseBelongsTo(row,account)}
function pad2(value){return String(value).padStart(2,'0')}
function isoDay(value){const raw=String(value||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(raw)?raw:''}
function monthKey(value){const day=isoDay(value);return day?day.slice(0,7):''}
function daysInMonth(year,month){return new Date(Date.UTC(year,month,0)).getUTCDate()}
function localTodayISO(){const d=new Date();return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`}
function addMonthsISO(value,delta){const raw=isoDay(value);if(!raw)return '';const [year,month,day]=raw.split('-').map(Number),index=year*12+(month-1)+Number(delta||0),targetYear=Math.floor(index/12),targetMonth=index-targetYear*12+1,targetDay=Math.min(day,daysInMonth(targetYear,targetMonth));return `${targetYear}-${pad2(targetMonth)}-${pad2(targetDay)}`}
function monthCutoffISO(key,day){const match=/^(\d{4})-(\d{2})$/.exec(String(key||''));if(!match)return '';const year=Number(match[1]),month=Number(match[2]);if(month<1||month>12)return '';const bounded=Math.max(1,Math.min(Math.trunc(Number(day)||1),daysInMonth(year,month)));return `${year}-${pad2(month)}-${pad2(bounded)}`}
function monthKeysBetween(start,end){const a=monthKey(start),b=monthKey(end);if(!a||!b||a>b)return[];let [year,month]=a.split('-').map(Number),[lastYear,lastMonth]=b.split('-').map(Number),rows=[];while(year<lastYear||(year===lastYear&&month<=lastMonth)){rows.push(`${year}-${pad2(month)}`);month++;if(month>12){month=1;year++}}return rows}
function shekelTransaction(tx){const currency=String(tx?.chargedCurrency||tx?.originalCurrency||'ILS').trim().toUpperCase().replace(/\s+/g,'');return !currency||['ILS','NIS','₪','ש״ח','שח'].includes(currency)}
function creditMappingKey(profileId,accountNumber){return `${String(profileId||'').trim()}:${String(accountNumber||'').trim()}`}
function synchronizedCardKey(profile,account){return `sync:${profile?.profileId||''}:${account?.accountNumber||''}`}
function transactionForecastAmount(tx){const charged=finite(tx?.chargedAmount),original=finite(tx?.originalAmount),value=charged!==null?charged:original;return value===null||value===0?0:-value}
function creditCardKey(row){return row?.creditAccountKey||`manual:${row?.card||''}`}
function bankFeedForAccount(kupa,account){
  const role=accountRole(account),bank=kupa?.bank&&typeof kupa.bank==='object'?kupa.bank:{};
  if(role==='ביתי')return bank.homeFeed&&typeof bank.homeFeed==='object'?bank.homeFeed:null;
  if(bank.source==='manual')return null;
  return bank.feed&&typeof bank.feed==='object'?bank.feed:null;
}
function bankTransactionDay(row){return isoDay(row?.date)||isoDay(row?.processedDate)}
function bankTransactionSearchText(row){return [row?.description,row?.memo,row?.partyName,row?.partyHeadline,row?.messageHeadline,row?.messageDetail].map(value=>String(value||'').toLowerCase()).join(' ')}
const CREDIT_SETTLEMENT_MARKERS={
  visaCal:['כאל','כרטיסי אשראי לישראל'],
  max:['מקס','max'],
  isracard:['ישראכרט','isracard'],
  amex:['אמריקן אקספרס','american express','amex','פרימיום אקספרס','premium express'],
};
function providerHintsForRows(rows){
  const providers=new Set();
  for(const row of rows){
    const provider=String(row?.provider||'').trim();if(provider)providers.add(provider);
    const card=String(row?.card||'').toLowerCase();
    if(card.includes('כאל')||card.includes(' cal'))providers.add('visaCal');
    if(card.includes('מקס')||card.includes('max'))providers.add('max');
    if(card.includes('ישראכרט')||card.includes('isracard'))providers.add('isracard');
    if(card.includes('אמריקן')||card.includes('american express')||card.includes('amex'))providers.add('amex');
  }
  return [...providers];
}
function bankRowLooksLikeCreditSettlement(row,providers=[]){
  if(row?.status==='pending'||row?.presenceState==='missing')return false;
  const text=bankTransactionSearchText(row);
  if(!text)return false;
  if(text.includes('אשראי')||text.includes('credit card'))return true;
  return providers.some(provider=>(CREDIT_SETTLEMENT_MARKERS[provider]||[]).some(marker=>text.includes(String(marker).toLowerCase())));
}
function moneyCents(value){return Math.round(num(value)*100)}
function settlementRowsForLatestElapsedCycle(installments,start,reference){
  const latestByCard=new Map();
  for(const row of installments){
    if(!row?.date||row.date>=reference||row.date>=start)continue;
    const key=creditCardKey(row),current=latestByCard.get(key);
    if(!current||row.date>current)latestByCard.set(key,row.date);
  }
  return installments.filter(row=>row?.date&&latestByCard.get(creditCardKey(row))===row.date);
}
function settlementGroupKey(row,level){
  const due=String(row?.date||'');
  if(level==='card')return `${due}|${creditCardKey(row)}`;
  if(level==='profile'){const profile=String(row?.profileId||'').trim();return profile?`${due}|${profile}`:`${due}|${creditCardKey(row)}`}
  if(level==='provider'){const provider=String(row?.provider||'').trim();return provider?`${due}|${provider}`:`${due}|${creditCardKey(row)}`}
  return due;
}
function bankSettlementMatchIndexes(bankRows,groupRows,used,reference){
  const due=groupRows.reduce((min,row)=>!min||row.date<min?row.date:min,''),expected=-moneyCents(groupRows.reduce((sum,row)=>sum+num(row.amount),0));
  if(!due||!expected)return [];
  const providers=providerHintsForRows(groupRows),sameSign=value=>expected<0?value<0:value>0,candidates=[];
  for(let index=0;index<bankRows.length;index++){
    if(used.has(index))continue;
    const row=bankRows[index],day=bankTransactionDay(row),value=moneyCents(row?.amount);
    if(!day||day<due||day>reference||!sameSign(value)||Math.abs(value)>Math.abs(expected)||!bankRowLooksLikeCreditSettlement(row,providers))continue;
    candidates.push({index,value});
  }
  const exact=candidates.find(item=>item.value===expected);if(exact)return[exact.index];
  if(candidates.length<2||candidates.length>12)return null;
  const target=Math.abs(expected),positive=candidates.map(item=>({index:item.index,value:Math.abs(item.value)})).filter(item=>item.value<=target),reachable=new Map([[0,[]]]);
  for(const item of positive){
    for(const [sum,indexes] of [...reachable.entries()]){
      const next=sum+item.value;if(next>target||reachable.has(next))continue;
      const nextIndexes=[...indexes,item.index];if(next===target)return nextIndexes;reachable.set(next,nextIndexes);
    }
  }
  return null;
}
function pendingCreditSettlementData(kupa,account,installments,start,reference){
  const feed=bankFeedForAccount(kupa,account);
  if(!feed||!isoDay(feed.syncedAt))return {rows:[],total:0};
  const candidates=settlementRowsForLatestElapsedCycle(installments,start,reference);
  if(!candidates.length)return {rows:[],total:0};
  const bankRows=Array.isArray(feed.transactions)?feed.transactions:[],unresolved=new Set(candidates.map((_,index)=>index)),used=new Set();
  for(const level of ['card','profile','provider','date']){
    const groups=new Map();
    for(const index of unresolved){
      const row=candidates[index],key=settlementGroupKey(row,level);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(index);
    }
    for(const indexes of groups.values()){
      const rows=indexes.map(index=>candidates[index]),match=bankSettlementMatchIndexes(bankRows,rows,used,reference);
      if(match===null)continue;
      if(match.length){for(const bankIndex of match)used.add(bankIndex)}
      for(const index of indexes)unresolved.delete(index);
    }
  }
  const rows=[...unresolved].map(index=>candidates[index]).sort((a,b)=>a.date.localeCompare(b.date)||String(a.card).localeCompare(String(b.card),'he'));
  return {rows,total:rows.reduce((sum,row)=>sum+num(row.amount),0)};
}

function accountTransactions(account={}){
  const direct=Array.isArray(account.txns)?account.txns:[];
  if(direct.length)return direct;
  const rows=[];
  for(const slice of Array.isArray(account.months)?account.months:[])rows.push(...(Array.isArray(slice?.transactions)?slice.transactions:[]));
  rows.push(...(Array.isArray(account.pendingTransactions)?account.pendingTransactions:[]));
  rows.push(...(Array.isArray(account.unassignedTransactions)?account.unassignedTransactions:[]));
  const seen=new Set();
  return rows.filter((tx,index)=>{const id=String(tx?.id||tx?.identifier||''),date=String(tx?.date||''),processed=String(tx?.processedDate||''),amount=finite(tx?.chargedAmount)??finite(tx?.originalAmount),part=Math.max(0,Math.trunc(Number(tx?.installments?.number)||0)),key=id?`${id}|${date}|${processed}|${amount}|${tx?.description||''}|${part}`:`idless-${index}|${date}|${processed}|${amount}|${tx?.description||''}|${part}`;if(seen.has(key))return false;seen.add(key);return true});
}

export function kupaCreditScheduleData(cr){
  if(!cr?.active||!isoDay(cr.firstChargeDate)||num(cr.installments)<1)return[];
  const total=num(cr.totalAmount),count=Math.max(1,Math.round(num(cr.installments))),base=Math.round((total/count)*100)/100;let rows=[],used=0;
  for(let i=0;i<count;i++){const amount=i===count-1?Math.round((total-used)*100)/100:base;used+=amount;rows.push({creditId:cr.id,date:addMonthsISO(cr.firstChargeDate,i),amount,part:i+1,totalParts:count,card:cr.card,account:accountRole(cr.account),ownerLabel:String(cr.ownerLabel||''),hidden:false,description:cr.description,source:'manual'})}
  return rows;
}

export function kupaSyncedInstallmentsData(kupa){
  const sync=kupa?.creditSync&&typeof kupa.creditSync==='object'&&!Array.isArray(kupa.creditSync)?kupa.creditSync:{},rows=[],seen=new Set(),mappings=sync.cardMappings&&typeof sync.cardMappings==='object'&&!Array.isArray(sync.cardMappings)?sync.cardMappings:{};
  for(const profile of Array.isArray(sync.profiles)?sync.profiles:[])for(const account of Array.isArray(profile?.accounts)?profile.accounts:[]){
    const mapping=mappings[creditMappingKey(profile.profileId,account.accountNumber)]||{};
    if(mapping.included!==true)continue;
    const role=mapping.account==='ביתי'?'ביתי':mapping.account==='עסקי'?'עסקי':accountRole(profile.defaultAccount),card=mapping.cardName||[CREDIT_PROVIDER_LABELS[profile.provider]||profile.label||profile.provider||'כרטיס אשראי',account.accountNumber?`••${String(account.accountNumber).slice(-4)}`:''].filter(Boolean).join(' ');
    for(const [index,tx] of accountTransactions(account).entries()){
      if(tx?.status==='pending'||!shekelTransaction(tx))continue;
      const date=isoDay(tx?.processedDate||tx?.date),amount=transactionForecastAmount(tx);if(!date||!amount)continue;
      const part=Math.max(1,Math.trunc(Number(tx?.installments?.number)||1)),totalParts=Math.max(1,Math.trunc(Number(tx?.installments?.total)||1)),id=String(tx?.id||tx?.identifier||''),stable=id?`${id}|${date}|${amount}|${tx?.description||''}|${part}`:`idless-${index}|${date}|${amount}|${tx?.description||''}|${part}`,identity=`${profile.profileId||''}|${account.accountNumber||''}|${stable}`;
      if(seen.has(identity))continue;seen.add(identity);
      rows.push({creditId:`SYNC:${identity}`,creditAccountKey:synchronizedCardKey(profile,account),date,amount,part,totalParts,card:card||'כרטיס אשראי',account:role,ownerLabel:String(profile.ownerLabel||''),hidden:mapping.hidden===true,description:String(tx?.description||''),source:'credit_sync',profileId:String(profile.profileId||''),accountNumber:String(account.accountNumber||''),provider:String(profile.provider||''),status:String(tx?.status||'completed')});
    }
  }
  return rows.sort((a,b)=>a.date.localeCompare(b.date)||String(a.card).localeCompare(String(b.card),'he'));
}

export function kupaAllInstallmentsData(kupa){return [...kupaSyncedInstallmentsData(kupa),...(Array.isArray(kupa?.credits)?kupa.credits:[]).flatMap(kupaCreditScheduleData)]}
export function kupaAccountInstallmentsData(kupa,account='עסקי'){const role=accountRole(account);return kupaAllInstallmentsData(kupa).filter(row=>row.account===role)}

export function kupaExpenseOccurrencesForMonthData(kupa,key){
  const match=/^(\d{4})-(\d{2})$/.exec(String(key||''));if(!match)return[];const year=Number(match[1]),month=Number(match[2]);if(month<1||month>12)return[];const last=daysInMonth(year,month);
  return (Array.isArray(kupa?.expenses)?kupa.expenses:[]).filter(row=>row?.active).flatMap(row=>{let due;if(row.recurring!==false){const source=isoDay(row.date)||`${key}-01`,day=Math.max(1,Math.min(Number(source.slice(8,10))||1,last));due=`${year}-${pad2(month)}-${pad2(day)}`}else{if(monthKey(row.date)!==key)return[];due=isoDay(row.date)}return due?[{...row,dueDate:due}]:[]});
}

export function kupaExpenseRowsBetweenData(kupa,start,end){if(!isoDay(start)||!isoDay(end))return[];return monthKeysBetween(start,end).flatMap(key=>kupaExpenseOccurrencesForMonthData(kupa,key)).filter(row=>row.dueDate>=start&&row.dueDate<=end)}

export function kupaNextAccountCreditCycleData(kupa,account='עסקי',reference=localTodayISO()){
  const ref=isoDay(reference)||localTodayISO(),future=kupaAccountInstallmentsData(kupa,account).filter(row=>row.date>=ref),byCard=new Map();
  for(const row of future){const key=creditCardKey(row),current=byCard.get(key);if(!current||row.date<current)byCard.set(key,row.date)}
  const rows=future.filter(row=>byCard.get(creditCardKey(row))===row.date).sort((a,b)=>a.date.localeCompare(b.date)||String(a.card).localeCompare(String(b.card),'he')),targetDate=rows.length?rows.reduce((max,row)=>row.date>max?row.date:max,rows[0].date):ref,targetMonth=monthKey(targetDate)||monthKey(ref),[year,month]=targetMonth.split('-').map(Number),targetEnd=`${year}-${pad2(month)}-${pad2(daysInMonth(year,month))}`;
  return {rows,total:rows.reduce((sum,row)=>sum+row.amount,0),targetDate,targetMonth,targetEnd};
}

export function kupaAccountBankBalanceData(kupa,account='עסקי'){
  const role=accountRole(account),bank=kupa?.bank&&typeof kupa.bank==='object'?kupa.bank:{};
  if(role==='ביתי')return finite(bank.homeFeed?.balance);
  const base=finite(bank.currentBalance);if(base===null)return null;
  return base+(Array.isArray(bank.adjustments)?bank.adjustments:[]).filter(row=>row?.type!=='check_deposit').reduce((sum,row)=>sum+num(row.amount),0);
}

export function kupaAccountBankAsOfDateData(kupa,account='עסקי',reference=localTodayISO()){
  const role=accountRole(account),bank=kupa?.bank&&typeof kupa.bank==='object'?kupa.bank:{},ref=isoDay(reference)||localTodayISO();
  if(role==='ביתי')return isoDay(bank.homeFeed?.syncedAt)||ref;
  return isoDay(bank.asOfDate)||isoDay(bank.updatedAt)||ref;
}

export function kupaAccountCheckDepositsData(kupa,account='עסקי',reference=localTodayISO(),targetMonth=monthKey(reference)){
  const role=accountRole(account),cutoffDay=cashflowCheckCutoffDayForAccount(kupa?.cashflowSettings,role),cutoffDate=monthCutoffISO(targetMonth,cutoffDay);
  const rows=(Array.isArray(kupa?.checks)?kupa.checks:[]).filter(row=>row?.status==='בקופה'&&accountRole(row?.account)===role).map(row=>({...row,dueDate:isoDay(row?.dueDate)})).filter(row=>row.dueDate&&cutoffDate&&row.dueDate<=cutoffDate).sort((a,b)=>a.dueDate.localeCompare(b.dueDate)||String(a.id||'').localeCompare(String(b.id||'')));
  return {rows,total:rows.reduce((sum,row)=>sum+num(row.amount),0),cutoffDay,cutoffDate};
}

export function kupaAccountCashflowData(kupa,account='עסקי',reference=localTodayISO()){
  const role=accountRole(account),ref=isoDay(reference)||localTodayISO(),balance=kupaAccountBankBalanceData(kupa,role),start=kupaAccountBankAsOfDateData(kupa,role,ref),cycle=kupaNextAccountCreditCycleData(kupa,role,ref);
  const installments=kupaAccountInstallmentsData(kupa,role),elapsedCreditRows=installments.filter(row=>row.date>=start&&row.date<ref),settlingCredit=pendingCreditSettlementData(kupa,role,installments,start,ref),elapsedExpenseRows=kupaExpenseRowsBetweenData(kupa,start,ref).filter(row=>row.dueDate<ref&&expenseBelongsTo(row,role)),targetExpenseRows=kupaExpenseOccurrencesForMonthData(kupa,cycle.targetMonth).filter(row=>row.dueDate>=ref&&expenseBelongsTo(row,role)),checkDeposits=kupaAccountCheckDepositsData(kupa,role,ref,cycle.targetMonth);
  const creditRows=[...elapsedCreditRows,...settlingCredit.rows,...cycle.rows].filter((row,index,all)=>all.findIndex(candidate=>candidate.creditId===row.creditId&&candidate.part===row.part)===index),expenseRows=[...elapsedExpenseRows,...targetExpenseRows].filter((row,index,all)=>all.findIndex(candidate=>candidate.id===row.id&&candidate.dueDate===row.dueDate)===index),credit=creditRows.reduce((sum,row)=>sum+row.amount,0),expenses=expenseRows.reduce((sum,row)=>sum+num(row.amount),0),checks=checkDeposits.total,targetExpenseTotal=targetExpenseRows.reduce((sum,row)=>sum+num(row.amount),0),total=credit+expenses,expectedChange=checks-total,projected=balance===null?null:balance+expectedChange;
  return {account:role,balance,credit,expenses,checks,total,expectedChange,start,end:cycle.targetEnd,targetMonth:cycle.targetMonth,nextCreditRows:cycle.rows,nextCreditTotal:cycle.total,settlingCreditRows:settlingCredit.rows,settlingCredit:settlingCredit.total,elapsedCredit:elapsedCreditRows.reduce((sum,row)=>sum+row.amount,0),elapsedExpenses:elapsedExpenseRows.reduce((sum,row)=>sum+num(row.amount),0),targetExpenseRows,targetExpenseTotal,checkRows:checkDeposits.rows,checkCutoffDay:checkDeposits.cutoffDay,checkCutoffDate:checkDeposits.cutoffDate,projected,alert:cashflowAlertForAccount(projected,kupa?.cashflowSettings,role)};
}
