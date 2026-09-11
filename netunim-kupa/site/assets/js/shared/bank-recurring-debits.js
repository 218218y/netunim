import {creditBillingISODate} from './credit-billing-cycles.js';

// Explicit obligations requested for this installation. The user confirmed that
// each bank label identifies exactly one obligation in its account. Amounts are
// deliberately absent: only a posted bank debit may seed an estimate.
export const BANK_RECURRING_DEBITS=Object.freeze([
  {id:'home-hapoalim-mortgage',account:'ביתי',name:'משכנתא פועלים',bankLabels:['פועלים-משכנתא'],startMonth:'2026-09',day:15},
  {id:'home-mercantile-mortgage',account:'ביתי',name:'משכנתא מרכנתיל',bankLabels:['בנק מרכנתיל די'],startMonth:'2026-09',day:15},
  {id:'business-pension',account:'עסקי',name:'פנסיה',bankLabels:['מגדל חברה לביט'],startMonth:'2026-09',day:15},
]);

const iso=creditBillingISODate;
const role=value=>value==='ביתי'||value==='home'?'ביתי':'עסקי';
const cents=value=>Math.round(Number(value)*100);
const text=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g,'').replace(/[־–—-]/g,' ').replace(/\s+/g,' ').trim();
const dayOf=row=>iso(row?.date)||iso(row?.processedDate);
const keyOf=row=>JSON.stringify([row?.id||row?.bankSerial||'',dayOf(row),row?.id||row?.bankSerial?'':[row?.bankReference,text(row?.description),row?.amount,row?.memo]]);
const matches=(row,rule)=>rule.bankLabels.some(label=>text(row?.description)===text(label));
const posted=(row,asOf)=>Number.isFinite(Number(row?.amount))&&cents(row.amount)<0&&(!row.currency||row.currency==='ILS')&&(!row.status||row.status==='completed')&&row.presenceState!=='missing'&&dayOf(row)&&dayOf(row)<=asOf&&(!iso(row.processedDate)||iso(row.processedDate)<=asOf);
function months(from,to){const result=[];for(let key=from;key&&key<=to;){result.push(key);const [year,month]=key.split('-').map(Number);key=month===12?`${year+1}-01`:`${year}-${String(month+1).padStart(2,'0')}`}return result}
function dueDate(month,day){const date=new Date(`${month}-${String(day).padStart(2,'0')}T00:00:00Z`);if(date.getUTCDay()===6)date.setUTCDate(date.getUTCDate()+1);return date.toISOString().slice(0,10)}
function combinedRows(feed){const rows=new Map();for(const row of [...(Array.isArray(feed?.recurringDebitHistory)?feed.recurringDebitHistory:[]),...(Array.isArray(feed?.transactions)?feed.transactions:[])])rows.set(keyOf(row),row);return [...rows.values()]}

// Persist just the recognized source rows alongside the same account snapshot.
// Fresh rows (including missing/pending corrections) replace older evidence.
// Absence invalidates a retained row only inside a complete bank coverage window.
export function bankRecurringDebitHistoryData(previousFeed,nextFeed,account,{complete=false,from='',to=''}={}){
  const rules=BANK_RECURRING_DEBITS.filter(rule=>rule.account===role(account));
  const sameAccount=!!nextFeed?.accountNumber&&nextFeed.accountNumber===previousFeed?.accountNumber;
  const current=combinedRows(nextFeed),seen=new Set(current.map(keyOf)),rows=new Map();
  for(const row of sameAccount?combinedRows(previousFeed):[]){
    if(!rules.some(rule=>matches(row,rule)))continue;
    const missing=complete&&from&&to&&dayOf(row)>=from&&dayOf(row)<=to&&!seen.has(keyOf(row));
    rows.set(keyOf(row),missing?{...row,presenceState:'missing'}:row);
  }
  for(const row of current){if(rules.some(rule=>matches(row,rule)))rows.set(keyOf(row),row);else rows.delete(keyOf(row))}
  return [...rows.values()].sort((a,b)=>dayOf(a).localeCompare(dayOf(b))||keyOf(a).localeCompare(keyOf(b)));
}

export function bankRecurringExpensesData(kupa,account,reference,horizon){
  const accountRole=role(account),bank=kupa?.bank||{},feed=accountRole==='ביתי'?bank.homeFeed:bank.source==='manual'?null:bank.feed;
  const synced=iso(feed?.syncedAt),asOf=synced&&synced<reference?synced:reference;
  const rows=[],obligations=[],warnings=[];
  for(const rule of BANK_RECURRING_DEBITS.filter(item=>item.account===accountRole)){
    const matching=combinedRows(feed).filter(row=>matches(row,rule)),byMonth=new Map();
    for(const row of matching.filter(row=>synced&&posted(row,asOf))){const month=dayOf(row).slice(0,7);if(!byMonth.has(month))byMonth.set(month,[]);byMonth.get(month).push(row)}
    const knownMonths=[...byMonth.keys()].sort();
    const obligation={id:rule.id,name:rule.name,account:accountRole,status:'no_bank_source',lastDebit:null,nextDueDate:'',nextAmount:null};
    let latest=null;
    for(const month of knownMonths.filter(month=>month<rule.startMonth))if(byMonth.get(month).length===1)latest=byMonth.get(month)[0];
    const firstMonth=latest?rule.startMonth:knownMonths.find(month=>month>=rule.startMonth);
    if(!firstMonth){
      // Recognition is dormant in accounts with no such bank source.
      // Once recognized, missing source data is an explicit incomplete forecast.
      if(matching.length)warnings.push({ruleId:rule.id,name:rule.name,kind:'no_bank_source'});
      obligations.push(obligation);continue;
    }
    const lastMonth=[horizon.slice(0,7),asOf.slice(0,7)].sort().at(-1);
    for(const month of months(firstMonth,lastMonth)){
      const candidates=byMonth.get(month)||[],due=dueDate(month,rule.day);
      if(candidates.length===1){latest=candidates[0];continue}
      if(candidates.length>1)warnings.push({ruleId:rule.id,name:rule.name,kind:'ambiguous',dueDate:due});
      if(!latest)continue;
      if(due<=horizon)rows.push({id:`bank-recurring:${rule.id}:${month}`,ruleId:rule.id,account:accountRole,name:rule.name,description:rule.name,type:'חיוב בנק משוער',recurring:true,active:true,dueDate:due,amount:-cents(latest.amount)/100,source:'bank_recurring',amountEstimated:true,bankSettlementState:due<reference?'awaiting':'estimated',sourceTransactionId:latest.id||'',sourceDate:dayOf(latest),sourceDescription:latest.description});
    }
    if(latest){
      obligation.lastDebit={date:dayOf(latest),amount:-cents(latest.amount)/100,transactionId:latest.id||''};
      const outstanding=rows.find(row=>row.ruleId===rule.id);
      const nextMonth=months(dayOf(latest).slice(0,7),`${Number(dayOf(latest).slice(0,4))+1}-12`)[1];
      obligation.nextDueDate=outstanding?.dueDate||dueDate(nextMonth,rule.day);
      obligation.nextAmount=outstanding?.amount??obligation.lastDebit.amount;
      obligation.status=outstanding?.bankSettlementState==='awaiting'?'awaiting':'estimated';
    }
    obligations.push(obligation);
  }
  return {rows,obligations,warnings,incomplete:warnings.length>0};
}
