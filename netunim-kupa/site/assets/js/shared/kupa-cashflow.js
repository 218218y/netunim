/** @typedef {import('./kupa-cashflow-contracts.js').CashflowCalculation} Calculation */
import {financeDerivation} from './finance-derivations.js';
import {CREDIT_DETAIL_HISTORY_MONTHS,creditCardCompare,creditCardConfiguredOrderCompare} from './credit-history.js';
import {cashflowAlertForAccount,cashflowCheckCutoffDayForAccount,outstandingCashflowCreditRows} from './cashflow.js';
import {cashflowNotificationData} from './cashflow-notification.js';
import {bankRecurringExpensesData,bankRecurringIncomeData} from './bank-recurring-debits.js';
import {creditAccountNextDisplayBillingDateData,creditAccountStatementCycleDateData,creditBillingRowsData,creditCyclesThroughHorizonData,creditCyclesThroughHorizonRowsData} from './credit-billing-cycles.js';
import {addDaysISO,addMonthsISO,bankObservationDay,daysInMonth,isoDay,localTodayISO,monthCutoffISO,monthKey,monthKeysBetween,pad2} from './kupa-cashflow-dates.js';
import {CREDIT_SETTLEMENT_MAX_HOLD_DAYS,accountRole,bankFeedForAccount,creditCardKey,creditRowKey,moneyCents,pendingBankSettlementGroupKeys,requiredAt,settlementGroupKey,settlementRowsForLatestElapsedCycle,unresolvedSettlementIndexes} from './kupa-credit-settlement.js';
export {kupaBankCreditSettlementIdentityData,kupaBankCreditSettlementIdentitiesData} from './kupa-credit-settlement.js';

/** @type {Calculation['finite']} */
function finite(value){if(value===null||value===undefined||value==='')return null;const n=Number(value);return Number.isFinite(n)?n:null}
/** @type {Calculation['num']} */
function num(value){const n=Number(value);return Number.isFinite(n)?n:0}
/** @type {Calculation['expenseBelongsTo']} */
function expenseBelongsTo(row,account){return accountRole(row?.account)===accountRole(account)}
/** @type {Calculation['kupaExpenseBelongsToAccountData']} */
export function kupaExpenseBelongsToAccountData(row,account='עסקי'){return expenseBelongsTo(row,account)}
/** @type {Calculation['settlementWarningId']} */
function settlementWarningId(account,rows){
  const first=rows[0],due=String(first?.date||''),cardKey=creditCardKey(first),provider=String(first?.provider||'manual');
  return `credit_settlement_unmatched:${accountRole(account)}:${due}:${provider}:${cardKey}`;
}
/** @type {Calculation['expiredSettlementWarnings']} */
function expiredSettlementWarnings(account,rows){
  /** @type {Map<string,import('./kupa-cashflow-contracts.js').ReconciledRow[]>} */
  const groups=new Map();
  for(const row of rows){const key=settlementGroupKey(row,'card'),group=groups.get(key)||[];group.push(row);groups.set(key,group)}
  return [...groups.values()].map(group=>{const first=group[0],due=String(first?.date||''),releaseDate=addDaysISO(due,CREDIT_SETTLEMENT_MAX_HOLD_DAYS);return {id:settlementWarningId(account,group),kind:/** @type {const} */('credit_settlement_unmatched'),account:accountRole(account),dueDate:due,releaseDate,provider:String(first?.provider||''),profileId:String(first?.profileId||''),
  accountNumber:String(first?.accountNumber||''),card:String(first?.card||'כרטיס אשראי'),amount:group.reduce((sum,row)=>sum+num(row.amount),0),rowCount:group.length,amountKnown:group.every(row=>row.includedInIlsTotal),missingAmountCount:group.filter(row=>!row.includedInIlsTotal).length}}).sort((a,b)=>a.dueDate.localeCompare(b.dueDate)||String(a.card).localeCompare(String(b.card),'he'));
}
/** @type {Calculation['pendingCreditSettlementData']} */
function pendingCreditSettlementData(kupa,account,settlementRows,start,reference){
  const feed=bankFeedForAccount(kupa,account),hasFeed=!!bankObservationDay(feed?.syncedAt);
  const unresolvedRows=settlementRows.filter(row=>row.date<reference&&row.bankSettlementState!=='settled'&&(!row.includedInIlsTotal||row.coverageIncomplete||moneyCents(row.amount)!==0)&&((hasFeed&&row.date<start)||!row.includedInIlsTotal||row.coverageIncomplete));
  const expiredRows=[],rows=[];
  for(const row of unresolvedRows){const releaseDate=addDaysISO(row.date,CREDIT_SETTLEMENT_MAX_HOLD_DAYS);if(releaseDate&&reference>=releaseDate)expiredRows.push(row);else rows.push(row)}
  return {rows,total:rows.reduce((sum,row)=>sum+num(row.amount),0),expiredRows,expiredTotal:expiredRows.reduce((sum,row)=>sum+num(row.amount),0),warnings:expiredSettlementWarnings(account,expiredRows)};
}

/** @type {Calculation['rollForwardSettledCycleRows']} */
function rollForwardSettledCycleRows(rows,settlement,reference,{retainSettledCompleted=false}={}){
  if(!settlement?.settledCardKeys?.size)return rows;
  const unresolvedKeys=new Set(settlement.rows.map(creditRowKey)),futureByCard=/** @type {Map<string,{date:string,confidence:import('./credit-calculation-contracts.js').BillingRow['billingDateConfidence']}[]>} */(new Map());
  for(const row of rows){const key=creditCardKey(row);if(!row?.date||row.date<=reference||!['authoritative','issuer','known_cycle','manual'].includes(row.billingDateConfidence)||!settlement.settledCardKeys.has(key))continue;const candidates=futureByCard.get(key)||[];candidates.push({date:row.date,confidence:row.billingDateConfidence});futureByCard.set(key,candidates)}
  for(const candidates of futureByCard.values())candidates.sort((a,b)=>a.date.localeCompare(b.date));
  return rows.flatMap(row=>{
    const key=creditCardKey(row);if(row.date!==reference||!settlement.settledCardKeys.has(key))return [row];
    if(row.status!=='pending')return retainSettledCompleted||unresolvedKeys.has(creditRowKey(row))?[row]:[];
    const transactionDate=isoDay(row.transactionDate),known=(futureByCard.get(key)||[]).find(candidate=>!transactionDate||candidate.date>=transactionDate);
    return known?[{...row,date:known.date,billingDate:known.date,billingMonth:monthKey(known.date),chargeDateSource:'bank_settlement_next_known_cycle',billingDateConfidence:'known_cycle'}]:[{...row,date:'',billingDate:'',billingMonth:'',chargeDateSource:'unassigned_after_bank_settlement',billingDateConfidence:'unassigned',uncertainBillingDate:true,includedInIlsTotal:false,amount:0}];
  });
}

/** @type {Calculation['reconciledCreditRowsForAccount']} */
function reconciledCreditRowsForAccount(kupa,account,reference,{retainSettledCompleted=false,includeHidden=true,monthlySettlement=false}={}){
  const role=accountRole(account),ref=isoDay(reference)||localTodayISO(),options={retainSettledCompleted,includeHidden,monthlySettlement};
  return financeDerivation(kupa,'reconciliation',JSON.stringify([role,ref,retainSettledCompleted,includeHidden,monthlySettlement]),()=>calculateReconciledCreditRows(kupa,role,ref,options));
}
/** @type {Calculation['calculateReconciledCreditRows']} */
function calculateReconciledCreditRows(kupa,account,reference,{retainSettledCompleted,includeHidden,monthlySettlement}){
  // Visibility is a presentation choice, never evidence that another card paid.
  const role=accountRole(account),ref=isoDay(reference)||localTodayISO(),start=kupaAccountBankAsOfDateData(kupa,role,ref),forecastStart=start>ref?start:ref,billingRows=creditBillingRowsData(kupa,{asOf:forecastStart,includeHidden:true}).filter(row=>row.account===role);
  const finalized=billingRows.filter(row=>row.status!=='pending'&&row.amountSource!=='issuer_not_billed'),recentStart=addDaysISO(forecastStart,-CREDIT_SETTLEMENT_MAX_HOLD_DAYS);
  // A newer charge on the same card must not hide an earlier incomplete cycle.
  // Keep whole cycles (including their known rows) for correct aggregate amounts.
  const selectedCycles=new Set([...settlementRowsForLatestElapsedCycle(finalized,monthlySettlement?addDaysISO(forecastStart,1):forecastStart,monthlySettlement?addDaysISO(forecastStart,1):forecastStart),...finalized.filter(row=>row.date&&row.date<=forecastStart&&(row.date>=recentStart||!row.includedInIlsTotal||row.coverageIncomplete))].map(row=>settlementGroupKey(row,'card')));
  /** @type {import('./kupa-cashflow-contracts.js').ReconciledRow[]} */
  const candidates=finalized.filter(row=>selectedCycles.has(settlementGroupKey(row,'card')));
  // The bank can post before the issuer supplies any finalized transactions.
  // A proven pending cycle is an amountless settlement shell, not a posted
  // amount. Keep it in the global competition, but out of totals and warnings.
  const finalizedCycles=new Set(finalized.filter(row=>row.status!=='coverage_missing').map(row=>settlementGroupKey(row,'card')));
  /** @type {Set<string>} */
  const shellCycles=new Set();
  for(const row of billingRows){
    if(row.status!=='pending'||!row.date||row.date!==forecastStart||!['authoritative','issuer','known_cycle','manual'].includes(row.billingDateConfidence))continue;
    const key=settlementGroupKey(row,'card');if(finalizedCycles.has(key)||shellCycles.has(key))continue;
    shellCycles.add(key);
    candidates.push({...row,creditId:`SETTLEMENT_SHELL:${key}`,settlementShell:true,amount:0,includedInIlsTotal:false});
  }
  if(monthlySettlement){
    // A proven current cycle (including a pending-only shell) supersedes the
    // historical fallback for that card. Keep explicitly incomplete old cycles.
    const currentCards=new Set(candidates.filter(row=>row.date===forecastStart).map(creditCardKey));
    for(let i=candidates.length-1;i>=0;i--)if(requiredAt(candidates,i).date<start&&requiredAt(candidates,i).date<forecastStart&&currentCards.has(creditCardKey(requiredAt(candidates,i)))&&requiredAt(candidates,i).includedInIlsTotal&&!requiredAt(candidates,i).coverageIncomplete)candidates.splice(i,1);
  }
  const feed=bankFeedForAccount(kupa,role),synced=bankObservationDay(feed?.syncedAt),bankRows=synced&&Array.isArray(feed?.transactions)?feed.transactions:[],settlementReference=synced&&synced<forecastStart?synced:forecastStart,unresolved=unresolvedSettlementIndexes(bankRows,candidates,settlementReference,{monthlySettlement}),pendingBankGroups=pendingBankSettlementGroupKeys(kupa,bankRows,billingRows,role,settlementReference);
  /** @type {import('./kupa-cashflow-contracts.js').ReconciledRow[]} */
  const settlementRows=candidates.map((row,index)=>({...row,bankSettlementState:unresolved.has(index)?'awaiting':'settled'}));
  const settlingCredit=pendingCreditSettlementData(kupa,role,settlementRows.filter(row=>!row.settlementShell),start,forecastStart),expiredKeys=new Set(settlingCredit.expiredRows.map(creditRowKey));
  /** @type {Map<string,import('./kupa-cashflow-contracts.js').ReconciledRow['bankSettlementState']>} */
  const states=new Map(settlementRows.map(row=>[creditRowKey(row),expiredKeys.has(creditRowKey(row))?'expired':row.bankSettlementState]));
  const current=settlementRows.filter(row=>row.date===forecastStart),currentSettlement={rows:current.filter(row=>row.bankSettlementState!=='settled'),settledCardKeys:new Set(current.filter(row=>row.bankSettlementState==='settled').map(creditCardKey))};
  const annotated=billingRows.map(row=>{const state=states.get(creditRowKey(row));return state?{...row,bankSettlementState:state}:row});
  const reconciledRows=rollForwardSettledCycleRows(annotated,currentSettlement,forecastStart,{retainSettledCompleted}).filter(row=>(includeHidden||!row.hidden)&&(retainSettledCompleted||(row.bankSettlementState!=='settled'&&row.amountSource!=='issuer_not_billed'))).map(row=>pendingBankGroups.has(settlementGroupKey(row,'card'))&&row.bankSettlementState!=='settled'?{...row,bankPendingSettlementDetected:true}:row);
  const elapsedIncompleteCreditRows=settlingCredit.rows.filter(row=>!row.includedInIlsTotal||row.coverageIncomplete);
  return {role,ref,start,forecastStart,currentSettlement,settlingCredit,settlementRows,elapsedIncompleteCreditRows,rows:reconciledRows,installments:reconciledRows.filter(row=>row.date&&row.includedInIlsTotal&&Math.abs(row.amount)>0.004),unassignedRows:reconciledRows.filter(row=>!row.date)};
}

/** @type {Calculation['kupaReconciledCreditRowsData']} */
export function kupaReconciledCreditRowsData(kupa,account='all',reference=localTodayISO()){
  if(account==='all')return [...reconciledCreditRowsForAccount(kupa,'עסקי',reference).rows,...reconciledCreditRowsForAccount(kupa,'ביתי',reference).rows];
  return reconciledCreditRowsForAccount(kupa,account,reference).rows;
}

/** @type {Calculation['kupaOutstandingCreditRowsData']} */
export function kupaOutstandingCreditRowsData(kupa,account='עסקי',reference=localTodayISO()){
  const result=reconciledCreditRowsForAccount(kupa,account,reference,{monthlySettlement:true});
  return [...outstandingCashflowCreditRows(result,!!bankObservationDay(bankFeedForAccount(kupa,account)?.syncedAt)),...result.unassignedRows];
}

/** @type {Calculation['kupaReconciledCreditDetailRowsData']} */
export function kupaReconciledCreditDetailRowsData(kupa,account='all',reference=localTodayISO()){
  const options={retainSettledCompleted:true,includeHidden:false};
  if(account==='all')return [...reconciledCreditRowsForAccount(kupa,'עסקי',reference,options).rows,...reconciledCreditRowsForAccount(kupa,'ביתי',reference,options).rows];
  return reconciledCreditRowsForAccount(kupa,account,reference,options).rows;
}

/** @type {Calculation['creditDetailRowSort']} */
function creditDetailRowSort(a,b){return Number(b.status==='pending')-Number(a.status==='pending')||String(b.transactionDate||b.date||'').localeCompare(String(a.transactionDate||a.date||''))||String(b.date||'').localeCompare(String(a.date||''))||String(a.card||'').localeCompare(String(b.card||''),'he')||String(a.description||'').localeCompare(String(b.description||''),'he')}
/** @type {Calculation['creditAccountDisplayContext']} */
function creditAccountDisplayContext(kupa,rows){
  /** @type {import('./kupa-cashflow-contracts.js').DisplayContext} */
  const context={datesByCard:new Map(),accountsByCard:new Map()};const {datesByCard,accountsByCard}=context;
  for(const row of rows){if(!row?.date)continue;const key=creditCardKey(row);const dates=datesByCard.get(key)||[];dates.push({date:row.date,source:row.chargeDateSource||'reconciled_cycle',confidence:row.billingDateConfidence||'known_cycle'});datesByCard.set(key,dates)}
  for(const dates of datesByCard.values())dates.sort((a,b)=>a.date.localeCompare(b.date));
  const sync=kupa?.creditSync&&typeof kupa.creditSync==='object'&&!Array.isArray(kupa.creditSync)?kupa.creditSync:{};
  for(const profile of Array.isArray(sync.profiles)?sync.profiles:[])for(const account of Array.isArray(profile?.accounts)?profile.accounts:[])accountsByCard.set(`sync:${String(profile.profileId||'').trim()}:${String(account.accountNumber||'').trim()}`,account);
  return {datesByCard,accountsByCard};
}
/** @type {Calculation['creditUnassignedDisplayTarget']} */
function creditUnassignedDisplayTarget(row,context,reference){
  const afterSettled=row?.chargeDateSource==='unassigned_after_bank_settlement',floor=afterSettled?addDaysISO(reference,1):reference,key=creditCardKey(row),known=(context.datesByCard.get(key)||[]).find(item=>item.date>=floor);
  if(known)return known;const account=context.accountsByCard.get(key);if(!account)return null;const next=creditAccountNextDisplayBillingDateData(account,floor);return next.date&&next.date>=floor?next:null;
}
/** @type {Calculation['kupaReconciledCreditDetailMonthsData']} */
export function kupaReconciledCreditDetailMonthsData(kupa,reference=localTodayISO(),historyMonths=CREDIT_DETAIL_HISTORY_MONTHS){
  const ref=isoDay(reference)||localTodayISO(),history=Math.max(0,Math.trunc(Number(historyMonths)||0));
  return financeDerivation(kupa,'credit-detail',`${ref}:${history}`,()=>calculateCreditDetailMonths(kupa,ref,history));
}
/** @type {Calculation['calculateCreditDetailMonths']} */
function calculateCreditDetailMonths(kupa,reference,historyMonths){
  const ref=isoDay(reference)||localTodayISO(),currentMonth=monthKey(ref),safeHistory=Math.max(0,Math.trunc(Number(historyMonths)||0)),cutoffMonth=monthKey(addMonthsISO(`${currentMonth}-01`,-safeHistory)),rows=kupaReconciledCreditDetailRowsData(kupa,'all',ref),displayContext=creditAccountDisplayContext(kupa,rows),byMonth=/** @type {Map<string,import('./kupa-cashflow-contracts.js').DetailMonth>} */(new Map()),unassigned=[],unplacedUnassigned=[];
  /** @param {string} key @param {import('./kupa-cashflow-contracts.js').ReconciledRow} row */
  const add=(key,row)=>{const month=byMonth.get(key)||{key,total:0,items:[],uncertainCount:0,missingAmountCount:0,coverageGapCount:0,incompleteCount:0,partial:false};month.total+=num(row.amount);month.items.push(row);byMonth.set(key,month)};
  for(const originalRow of rows){
    let row=originalRow;
    if(row?.foreignCurrency===true&&row?.status!=='pending'&&row?.date){
      const account=displayContext.accountsByCard.get(creditCardKey(row)),cycle=account?creditAccountStatementCycleDateData(account,row.date):null;
      if(cycle?.date&&cycle.date!==row.date)row={...row,detailCycleBillingDate:cycle.date,detailCycleNominalDay:cycle.nominalDay,detailCycleAssignmentSource:cycle.source,detailCycleAssignmentConfidence:cycle.confidence};
    }
    const key=monthKey(row.detailCycleBillingDate||row.date);if(key){if(key>=cutoffMonth)add(key,row);continue}
    unassigned.push(row);const target=creditUnassignedDisplayTarget(row,displayContext,ref);if(target?.date){const targetMonth=monthKey(target.date);if(targetMonth){add(targetMonth,{...row,detailCycleUncertain:true,detailDisplayBillingDate:target.date,detailDisplayBillingDateSource:target.source,detailDisplayBillingDateConfidence:target.confidence});continue}}unplacedUnassigned.push({...row,detailCycleUncertain:true})
  }
  for(const month of byMonth.values()){month.total=Math.round(month.total*100)/100;month.items.sort((a,b)=>creditCardConfiguredOrderCompare(a,b,kupa?.creditSync?.cardMappings)||Number(b.detailCycleUncertain===true)-Number(a.detailCycleUncertain===true)||String(a.date||a.detailDisplayBillingDate||'').localeCompare(String(b.date||b.detailDisplayBillingDate||''))||creditCardCompare(a,b,
  kupa?.creditSync?.cardMappings)||creditDetailRowSort(a,b));month.uncertainCount=month.items.filter(row=>row.detailCycleUncertain===true).length;month.missingAmountCount=month.items.filter(row=>row.amountStatus!=='known_ils').length;month.coverageGapCount=month.items.filter(row=>row.coverageIncomplete).length;month.incompleteCount=month.items.filter(row=>!row.includedInIlsTotal||row.coverageIncomplete).length;month.partial=month.incompleteCount>0}
  const months=[...byMonth.values()].sort((a,b)=>a.key.localeCompare(b.key));if(unplacedUnassigned.length){unplacedUnassigned.sort((a,b)=>creditCardCompare(a,b,kupa?.creditSync?.cardMappings)||creditDetailRowSort(a,b));months.push({key:'unassigned',total:0,items:unplacedUnassigned,uncertain:true,uncertainCount:unplacedUnassigned.length,partial:true,incompleteCount:unplacedUnassigned.length,
  missingAmountCount:unplacedUnassigned.filter(row=>row.amountStatus!=='known_ils').length,coverageGapCount:unplacedUnassigned.filter(row=>row.coverageIncomplete).length})}
  return {months,cutoffMonth,historyMonths:safeHistory,currentMonth,unassigned,unplacedUnassigned};
}

/** @type {Calculation['kupaReconciledCreditUpcomingDetailData']} */
export function kupaReconciledCreditUpcomingDetailData(kupa,reference=localTodayISO(),historyMonths=CREDIT_DETAIL_HISTORY_MONTHS){
  const ref=isoDay(reference)||localTodayISO(),detail=kupaReconciledCreditDetailMonthsData(kupa,ref,historyMonths),rows=detail.months.flatMap(month=>month.items);
  /** @type {Map<string,string>} */
  const nextByCard=new Map();
  /** @param {import('./kupa-cashflow-contracts.js').ReconciledRow} row */
  const displayDate=row=>isoDay(row?.detailCycleBillingDate)||isoDay(row?.detailDisplayBillingDate)||isoDay(row?.date);
  /** @param {import('./kupa-cashflow-contracts.js').ReconciledRow} row */
  const eligible=row=>{
    if(row?.bankSettlementState==='settled')return false;
    const date=displayDate(row),actualDate=isoDay(row?.date);
    if(!date)return false;
    // A foreign immediate debit is listed under its statement cycle for
    // browsing only. It has already been charged on its actual debit date;
    // the statement-cycle projection must never resurrect it as future cash.
    if(row.foreignCurrency===true&&row.status!=='pending'&&actualDate&&actualDate<ref)return false;
    // Reconciliation keeps due-but-unverified cycles in the cashflow. Do not
    // silently skip one in favor of next month's cycle on the same card.
    return date>=ref||(actualDate&&actualDate<ref&&row.bankSettlementState==='awaiting');
  };
  for(const row of rows){if(!eligible(row))continue;const date=displayDate(row),key=creditCardKey(row),current=nextByCard.get(key);if(!current||date<current)nextByCard.set(key,date)}
  const items=rows.filter(row=>eligible(row)&&nextByCard.get(creditCardKey(row))===displayDate(row)).sort((a,b)=>creditCardConfiguredOrderCompare(a,b,kupa?.creditSync?.cardMappings)||displayDate(a).localeCompare(displayDate(b))||creditCardCompare(a,b,kupa?.creditSync?.cardMappings)||creditDetailRowSort(a,b));
  return {items,nextByCard,reference:ref};
}

/** @type {Calculation['kupaReconciledCardUpcomingChargeData']} */
export function kupaReconciledCardUpcomingChargeData(kupa,creditAccountKey,reference=localTodayISO()){
  return kupaCardUpcomingChargeFromRowsData(kupaReconciledCreditRowsData(kupa,'all',reference),creditAccountKey,reference);
}

/** @type {Calculation['kupaCardDisplayBillingDateFromRowsData']} */
export function kupaCardDisplayBillingDateFromRowsData(inputRows,creditAccountKey,account={},reference=localTodayISO()){
  const ref=isoDay(reference)||localTodayISO(),rows=(Array.isArray(inputRows)?inputRows:[]).filter(row=>row.creditAccountKey===creditAccountKey),afterSettled=rows.some(row=>!row.date&&row.chargeDateSource==='unassigned_after_bank_settlement'),floor=afterSettled?addDaysISO(ref,1):ref,upcoming=kupaCardUpcomingChargeFromRowsData(rows,creditAccountKey,floor);
  if(upcoming?.date)return {date:upcoming.date,source:'reconciled_upcoming_cycle',confidence:'known_cycle'};
  const known=rows.filter(row=>row.date&&row.date>=floor).sort((a,b)=>a.date.localeCompare(b.date))[0];
  if(known)return {date:known.date,source:String(known.chargeDateSource||'reconciled_upcoming_cycle'),confidence:String(known.billingDateConfidence||'known_cycle')};
  return creditAccountNextDisplayBillingDateData(account,floor);
}

/** @type {Calculation['kupaCardUpcomingChargeFromRowsData']} */
export function kupaCardUpcomingChargeFromRowsData(inputRows,creditAccountKey,reference=localTodayISO()){
  const ref=isoDay(reference)||localTodayISO(),rows=inputRows.filter(row=>row.creditAccountKey===creditAccountKey),unassigned=rows.filter(row=>!row.date),elapsed=rows.filter(row=>row.date<ref&&row.bankSettlementState==='awaiting'&&(!row.includedInIlsTotal||row.coverageIncomplete)),extra=[...unassigned,...elapsed];
  // Same open-cycle policy as the transaction detail: an unproven elapsed
  // debit precedes next month's commitment, but completed immediate FX
  // debits must not be forecast a second time as an upcoming card charge.
  const overdue=rows.filter(row=>row.date&&row.date<ref&&row.bankSettlementState==='awaiting'&&row.status!=='pending'&&row.foreignCurrency!==true),forecast=rows.filter(row=>row.date>=ref||overdue.includes(row)),floor=overdue.reduce((earliest,row)=>!earliest||row.date<earliest?row.date:earliest,'')||ref,cycle=creditCyclesThroughHorizonRowsData(forecast,'all',floor,unassigned).nextCycles[0];
  if(!cycle&&!extra.length)return null;
  const incomplete=[...(cycle?.rows.filter(row=>!row.includedInIlsTotal||row.coverageIncomplete)||[]),...extra],missingAmountCount=incomplete.filter(row=>row.amountStatus!=='known_ils').length;
  return {amount:cycle?.total||0,date:cycle?.billingDate||'',source:'transactions',pendingAmount:cycle?.pendingTotal||0,estimated:!cycle||cycle.status!=='finalized'||extra.length>0,awaitingSettlement:!!cycle&&cycle.billingDate<ref,status:incomplete.length?'incomplete':cycle?.status||'incomplete',incompleteCount:incomplete.length,missingAmountCount,
  coverageGapCount:incomplete.filter(row=>row.coverageIncomplete).length,stalePendingCount:incomplete.filter(row=>row.status==='pending'&&!row.pendingFresh).length,unconvertedCount:incomplete.filter(row=>row.amountStatus==='foreign_unconverted').length,unknownAmountCount:incomplete.filter(row=>row.amountStatus==='unknown_amount').length,unassignedCount:unassigned.length,amountKnown:!!cycle&&missingAmountCount===0,complete:incomplete.length===0};
}

/** @type {Calculation['kupaCreditScheduleData']} */
export function kupaCreditScheduleData(cr){
  if(!cr?.active||!isoDay(cr.firstChargeDate)||num(cr.installments)<1)return[];
  const total=num(cr.totalAmount),count=Math.max(1,Math.round(num(cr.installments))),base=Math.round((total/count)*100)/100;
  /** @type {ReturnType<Calculation['kupaCreditScheduleData']>} */
  let rows=[];let used=0;
  for(let i=0;i<count;i++){const amount=i===count-1?Math.round((total-used)*100)/100:base;used+=amount;rows.push({creditId:cr.id,date:addMonthsISO(cr.firstChargeDate,i),amount,part:i+1,totalParts:count,card:cr.card,account:accountRole(cr.account),ownerLabel:String(cr.ownerLabel||''),hidden:false,description:cr.description,source:'manual'})}
  return rows;
}

/** @type {Calculation['kupaSyncedInstallmentsData']} */
export function kupaSyncedInstallmentsData(kupa){
  return creditBillingRowsData(kupa).filter(row=>row.source!=='manual'&&row.date&&row.includedInIlsTotal&&Math.abs(row.amount)>0.004);
}

/** @type {Calculation['kupaAllInstallmentsData']} */
export function kupaAllInstallmentsData(kupa){return creditBillingRowsData(kupa).filter(row=>row.date&&row.includedInIlsTotal&&Math.abs(row.amount)>0.004)}
/** @type {Calculation['kupaAccountInstallmentsData']} */
export function kupaAccountInstallmentsData(kupa,account='עסקי'){const role=accountRole(account);return kupaAllInstallmentsData(kupa).filter(row=>row.account===role)}

/** @type {Calculation['kupaExpenseOccurrencesForMonthData']} */
export function kupaExpenseOccurrencesForMonthData(kupa,key){
  const match=/^(\d{4})-(\d{2})$/.exec(String(key||''));if(!match)return[];const year=Number(match[1]),month=Number(match[2]);if(month<1||month>12)return[];const last=daysInMonth(year,month);
  return (Array.isArray(kupa?.expenses)?kupa.expenses:[]).filter(row=>row?.active).flatMap(row=>{let due;if(row.recurring!==false){const source=isoDay(row.date)||`${key}-01`,day=Math.max(1,Math.min(Number(source.slice(8,10))||1,last));due=`${year}-${pad2(month)}-${pad2(day)}`}else{if(monthKey(row.date)!==key)return[];due=isoDay(row.date)}return due?[{...row,dueDate:due}]:[]});
}

/** @type {Calculation['kupaExpenseRowsBetweenData']} */
export function kupaExpenseRowsBetweenData(kupa,start,end){if(!isoDay(start)||!isoDay(end))return[];return monthKeysBetween(start,end).flatMap(key=>kupaExpenseOccurrencesForMonthData(kupa,key)).filter(row=>row.dueDate>=start&&row.dueDate<=end)}

/** @type {Calculation['kupaNextAccountCreditCycleData']} */
export function kupaNextAccountCreditCycleData(kupa,account='עסקי',reference=localTodayISO()){
  return creditCyclesThroughHorizonData(kupa,account,reference);
}

/** @type {Calculation['kupaAccountBankBalanceData']} */
export function kupaAccountBankBalanceData(kupa,account='עסקי'){
  const role=accountRole(account),bank=kupa?.bank&&typeof kupa.bank==='object'?kupa.bank:{};
  if(role==='ביתי')return finite(bank.homeFeed?.balance);
  const base=finite(bank.currentBalance);if(base===null)return null;
  return base+(Array.isArray(bank.adjustments)?bank.adjustments:[]).filter(row=>row?.type!=='check_deposit').reduce((sum,row)=>sum+num(row.amount),0);
}

/** @type {Calculation['kupaAccountBankAsOfDateData']} */
export function kupaAccountBankAsOfDateData(kupa,account='עסקי',reference=localTodayISO()){
  const role=accountRole(account),bank=kupa?.bank&&typeof kupa.bank==='object'?kupa.bank:{},ref=isoDay(reference)||localTodayISO();
  if(role==='ביתי')return bankObservationDay(bank.homeFeed?.syncedAt)||ref;
  return bankObservationDay(bank.asOfDate)||bankObservationDay(bank.updatedAt)||ref;
}

/** @type {Calculation['kupaAccountCheckDepositsData']} */
export function kupaAccountCheckDepositsData(kupa,account='עסקי',reference=localTodayISO(),targetMonth=monthKey(reference),horizonDate=''){
  const role=accountRole(account),cutoffDay=cashflowCheckCutoffDayForAccount(kupa?.cashflowSettings,role),configuredCutoff=monthCutoffISO(targetMonth,cutoffDay),horizon=isoDay(horizonDate),cutoffDate=horizon||configuredCutoff;
  const rows=(Array.isArray(kupa?.checks)?kupa.checks:[]).filter(row=>row?.status==='בקופה'&&accountRole(row?.account)===role).map(row=>({...row,dueDate:isoDay(row?.dueDate)})).filter(row=>row.dueDate&&cutoffDate&&row.dueDate<=cutoffDate).sort((a,b)=>a.dueDate.localeCompare(b.dueDate)||String(a.id||'').localeCompare(String(b.id||'')));
  return {rows,total:rows.reduce((sum,row)=>sum+num(row.amount),0),cutoffDay,cutoffDate};
}

// A forecast uses one account-wide monthly window. A card already paid must
// not pull another card's still-open current cycle into the following month.
/** @type {Calculation['monthlyCashflowBoundary']} */
function monthlyCashflowBoundary(key){
  const due=monthCutoffISO(key,15),date=new Date(`${due}T00:00:00Z`);
  return date.getUTCDay()===6?addDaysISO(due,1):due;
}
/** @type {Calculation['automaticCashflowHorizon']} */
function automaticCashflowHorizon(kupa,role,reconciliation,creditRows){
  const {forecastStart,settlementRows}=reconciliation,key=monthKey(forecastStart);
  const monthEnd=monthCutoffISO(key,31),recurring=bankRecurringExpensesData(kupa,role,forecastStart,monthEnd);
  /** @type {Map<string,{cents:number,incomplete:boolean}>} */
  const groups=new Map();
  for(const row of creditRows){const groupKey=settlementGroupKey(row,'card'),group=groups.get(groupKey)||{cents:0,incomplete:false};group.cents+=moneyCents(row.amount);group.incomplete ||= !row.includedInIlsTotal||row.coverageIncomplete;groups.set(groupKey,group)}
  // A fully offset or zero cycle needs no bank debit and cannot hold a month open.
  const obligations=creditRows.filter(row=>{const group=groups.get(settlementGroupKey(row,'card'));if(!group)throw new RangeError('cashflow_internal_group');return group.cents!==0||group.incomplete});
  const outstanding=obligations.filter(row=>row.date&&row.date<=monthEnd);
  const manual=kupaExpenseRowsBetweenData(kupa,reconciliation.start,monthlyCashflowBoundary(key)).filter(row=>expenseBelongsTo(row,role)&&moneyCents(row.amount)!==0);
  const income=bankRecurringIncomeData(kupa,role,forecastStart,monthEnd);
  const pending=outstanding.length>0||recurring.rows.length>0||income.rows.length>0||manual.length>0;
  const settledThisMonth=settlementRows.some(row=>monthKey(row.date)===key&&row.bankSettlementState==='settled')||[...recurring.obligations,...income.obligations].some(row=>monthKey(row.lastDebit?.date||row.lastCredit?.date)===key);
  const nextMonth=monthKey(addMonthsISO(`${key}-01`,1)),hasNextMonthCredit=obligations.some(row=>monthKey(row.date)===nextMonth);
  const targetMonth=pending||(!settledThisMonth&&!hasNextMonthCredit&&forecastStart<=monthlyCashflowBoundary(key))?key:nextMonth;
  const targetIncome=bankRecurringIncomeData(kupa,role,forecastStart,monthCutoffISO(targetMonth,31));
  const dates=[...targetIncome.rows.filter(row=>monthKey(row.dueDate)===targetMonth).map(row=>row.dueDate),monthlyCashflowBoundary(targetMonth),...obligations.filter(row=>monthKey(row.date)===targetMonth).map(row=>row.date)];
  return {targetMonth,targetDate:[forecastStart,...dates].sort().at(-1)||forecastStart,awaitingSettlement:outstanding.some(row=>row.date<forecastStart)||recurring.rows.some(row=>row.dueDate<forecastStart)};
}

/** @type {Calculation['cashflowContributionsThroughDate']} */
function cashflowContributionsThroughDate(kupa,role,reconciliation,remaining,targetDate){
  const {start,forecastStart,unassignedRows}=reconciliation;
  const selected=remaining.filter(row=>row.date<=targetDate),creditRows=selected.filter(row=>row.includedInIlsTotal&&Math.abs(row.amount)>0.004);
  const recurring=bankRecurringExpensesData(kupa,role,forecastStart,targetDate),income=bankRecurringIncomeData(kupa,role,forecastStart,targetDate),incomeRows=income.rows;
  const expenseRows=[...kupaExpenseRowsBetweenData(kupa,start,targetDate).filter(row=>expenseBelongsTo(row,role)),...recurring.rows];
  const checkDeposits=kupaAccountCheckDepositsData(kupa,role,forecastStart,monthKey(targetDate),targetDate);
  const incompleteCreditRows=[...unassignedRows,...selected.filter(row=>!row.includedInIlsTotal||row.coverageIncomplete)];
  return {selected,creditRows,recurring,income,incomeRows,expenseRows,checkDeposits,incompleteCreditRows};
}

// reference is the date of calculation, targetDate is the requested future date.
// Never advance reference to simulate the future: it would expire pending issuer
// data and treat future bank debits as already reflected in today's balance.
/** @type {Calculation['kupaAccountCashflowData']} */
export function kupaAccountCashflowData(kupa,account='עסקי',reference=localTodayISO(),options={}){
  const role=accountRole(account),ref=isoDay(reference)||localTodayISO();
  return financeDerivation(kupa,'cashflow',JSON.stringify([role,ref,options.targetDate||'']),()=>calculateAccountCashflow(kupa,role,ref,options));
}
/** @type {Calculation['calculateAccountCashflow']} */
function calculateAccountCashflow(kupa,account,reference,options){
  const role=accountRole(account),ref=isoDay(reference)||localTodayISO(),balance=kupaAccountBankBalanceData(kupa,role);
  const reconciliation=reconciledCreditRowsForAccount(kupa,role,ref,{monthlySettlement:true});
  const {start,forecastStart,unassignedRows}=reconciliation;
  const remaining=outstandingCashflowCreditRows(reconciliation,!!bankObservationDay(bankFeedForAccount(kupa,role)?.syncedAt));
  const automatic=automaticCashflowHorizon(kupa,role,reconciliation,remaining);
  const requested=options.targetDate?isoDay(options.targetDate):'';
  if(options.targetDate&&(!requested||requested<forecastStart))throw new RangeError('תאריך התחזית חייב להיות תקין ולא מוקדם מתאריך החישוב או יתרת הבסיס');
  const targetDate=requested||automatic.targetDate,targetMonth=monthKey(targetDate);
  const contributions=cashflowContributionsThroughDate(kupa,role,reconciliation,remaining,targetDate);
  const {selected,creditRows,recurring,income,incomeRows,expenseRows,checkDeposits,incompleteCreditRows}=contributions;
  /** @param {Array<{amount?:unknown}>} rows */
  const sum=rows=>rows.reduce((total,row)=>total+moneyCents(row.amount),0)/100;
  const credit=sum(creditRows),expenses=sum(expenseRows),checks=moneyCents(checkDeposits.total)/100,total=(moneyCents(credit)+moneyCents(expenses))/100;
  const incomes=sum(incomeRows);
  const expectedChange=(moneyCents(checks)+moneyCents(incomes)-moneyCents(total))/100;
  /** @type {import('./kupa-cashflow-contracts.js').CashflowProjection} */
  const projection=balance===null?{balance,projected:null}:{balance,projected:(moneyCents(balance)+moneyCents(expectedChange))/100};const {projected}=projection;
  const elapsedIncompleteCreditRows=incompleteCreditRows.filter(row=>row.date&&row.date<forecastStart);
  const nextCreditRows=creditRows.filter(row=>row.date>=forecastStart),targetExpenseRows=expenseRows.filter(row=>row.dueDate>=forecastStart);
  const cycle=creditCyclesThroughHorizonRowsData(selected,role,forecastStart,unassignedRows,targetDate);
  const settlingCreditRows=selected.filter(row=>row.date<forecastStart&&['awaiting','expired'].includes(row.bankSettlementState||''));
  const result={...projection,account:role,credit,expenses,incomes,incomeRows,recurringIncomeObligations:income.obligations,recurringIncomeWarnings:income.warnings,checks,total,expectedChange,creditRows,expenseRows,start,reference:forecastStart,end:targetDate,targetDate,targetMonth,automaticTargetDate:automatic.targetDate,customTarget:!!requested,awaitingSettlement:automatic.awaitingSettlement,
    nextCreditRows,nextCreditCycles:cycle.cycles,nextCreditTotal:sum(nextCreditRows),unassignedCreditRows:unassignedRows,elapsedIncompleteCreditRows,incompleteCreditRows,
    forecastIncomplete:incompleteCreditRows.length>0||recurring.incomplete||income.incomplete,recurringExpenseRows:recurring.rows,recurringObligations:recurring.obligations,recurringExpenseWarnings:recurring.warnings,
    settlingCreditRows,settlingCredit:sum(settlingCreditRows),expiredSettlementCreditRows:reconciliation.settlingCredit.expiredRows,expiredSettlementCredit:reconciliation.settlingCredit.expiredTotal,expiredSettlementWarnings:reconciliation.settlingCredit.warnings,unmatchedCreditRetained:/** @type {const} */(true),
    elapsedCredit:sum(creditRows.filter(row=>row.date>=start&&row.date<forecastStart)),elapsedExpenses:sum(expenseRows.filter(row=>row.dueDate<forecastStart)),targetExpenseRows,targetExpenseTotal:sum(targetExpenseRows),
    checkRows:checkDeposits.rows,checkCutoffDay:checkDeposits.cutoffDay,checkCutoffDate:checkDeposits.cutoffDate,alert:cashflowAlertForAccount(projected,kupa?.cashflowSettings,role)};
  // Keep the displayed forecast unchanged while searching at least the whole
  // current month. A custom date remains an exact, explicitly bounded enquiry.
  const monthEnd=monthCutoffISO(monthKey(forecastStart),31),warningEnd=requested?targetDate:targetDate>monthEnd?targetDate:monthEnd;
  const warning=warningEnd===targetDate?contributions:cashflowContributionsThroughDate(kupa,role,reconciliation,remaining,warningEnd);
  const warningProjection={targetDate:warningEnd,creditRows:warning.creditRows,expenseRows:warning.expenseRows,incomeRows:warning.incomeRows,checkRows:warning.checkDeposits.rows,
    forecastIncomplete:warning.incompleteCreditRows.length>0||warning.recurring.incomplete||warning.income.incomplete};
  const withWarning={...result,warningProjection};
  return {...withWarning,breach:cashflowNotificationData(withWarning,kupa?.cashflowSettings,forecastStart)};
}
