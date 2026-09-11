import {cashflowAlertForAccount,cashflowCheckCutoffDayForAccount} from './cashflow.js';
import {creditBillingISODate,creditBillingRowsData,creditCyclesThroughHorizonData,creditCyclesThroughHorizonRowsData} from './credit-billing-cycles.js';

function finite(value){if(value===null||value===undefined||value==='')return null;const n=Number(value);return Number.isFinite(n)?n:null}
function num(value){const n=Number(value);return Number.isFinite(n)?n:0}
function accountRole(value){return value==='ביתי'||value==='home'?'ביתי':'עסקי'}
function expenseBelongsTo(row,account){return accountRole(row?.account)===accountRole(account)}
export function kupaExpenseBelongsToAccountData(row,account='עסקי'){return expenseBelongsTo(row,account)}
function pad2(value){return String(value).padStart(2,'0')}
function isoDay(value){return creditBillingISODate(value)}
function monthKey(value){const day=isoDay(value);return day?day.slice(0,7):''}
function daysInMonth(year,month){return new Date(Date.UTC(year,month,0)).getUTCDate()}
function localTodayISO(){const d=new Date();return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`}
function addMonthsISO(value,delta){const raw=isoDay(value);if(!raw)return '';const [year,month,day]=raw.split('-').map(Number),index=year*12+(month-1)+Number(delta||0),targetYear=Math.floor(index/12),targetMonth=index-targetYear*12+1,targetDay=Math.min(day,daysInMonth(targetYear,targetMonth));return `${targetYear}-${pad2(targetMonth)}-${pad2(targetDay)}`}
function addDaysISO(value,delta){const raw=isoDay(value);if(!raw)return '';const [year,month,day]=raw.split('-').map(Number),date=new Date(Date.UTC(year,month-1,day+Number(delta||0)));return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth()+1)}-${pad2(date.getUTCDate())}`}
function monthCutoffISO(key,day){const match=/^(\d{4})-(\d{2})$/.exec(String(key||''));if(!match)return '';const year=Number(match[1]),month=Number(match[2]);if(month<1||month>12)return '';const bounded=Math.max(1,Math.min(Math.trunc(Number(day)||1),daysInMonth(year,month)));return `${year}-${pad2(month)}-${pad2(bounded)}`}
function monthKeysBetween(start,end){const a=monthKey(start),b=monthKey(end);if(!a||!b||a>b)return[];let [year,month]=a.split('-').map(Number),[lastYear,lastMonth]=b.split('-').map(Number),rows=[];while(year<lastYear||(year===lastYear&&month<=lastMonth)){rows.push(`${year}-${pad2(month)}`);month++;if(month>12){month=1;year++}}return rows}
function creditCardKey(row){return row?.creditAccountKey||`manual:${row?.card||''}`}
function creditRowKey(row){return `${String(row?.creditId||'')}|${Number(row?.part||1)}`}
function bankFeedForAccount(kupa,account){
  const role=accountRole(account),bank=kupa?.bank&&typeof kupa.bank==='object'?kupa.bank:{};
  if(role==='ביתי')return bank.homeFeed&&typeof bank.homeFeed==='object'?bank.homeFeed:null;
  if(bank.source==='manual')return null;
  return bank.feed&&typeof bank.feed==='object'?bank.feed:null;
}
function bankTransactionDay(row){return isoDay(row?.date)||isoDay(row?.processedDate)}
function bankTransactionSearchText(row){return [row?.description,row?.memo,row?.partyName,row?.partyHeadline,row?.messageHeadline,row?.messageDetail].map(value=>String(value||'').toLowerCase()).join(' ')}
const CREDIT_SETTLEMENT_MAX_HOLD_DAYS=2;
const CREDIT_SETTLEMENT_MARKERS={
  // Bank feeds usually identify the clearing institution, not the individual card.
  // Last-4 is bonus evidence only; provider/legal-name aliases are the strong signal
  // when the posted amount differs from the issuer-derived cycle estimate.
  visaCal:['כאל','כרטיסי אשראי לישראל','כרטיסי אשראי ל'],
  max:['מקס איט פיננסי','מקס איט פיננסים','מקס','max'],
  isracard:['ישראכרט בע״מ','ישראכרט בע"מ','ישראכרט בעמ','ישראכרט','isracard'],
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
  const explicit=Object.keys(CREDIT_SETTLEMENT_MARKERS).filter(provider=>bankRowExplicitlyMatchesProvider(row,provider));
  if(explicit.length&&providers.some(provider=>CREDIT_SETTLEMENT_MARKERS[provider])&&!explicit.some(provider=>providers.includes(provider)))return false;
  if(text.includes('אשראי')||text.includes('credit card'))return true;
  return providers.some(provider=>(CREDIT_SETTLEMENT_MARKERS[provider]||[]).some(marker=>text.includes(String(marker).toLowerCase())));
}
function bankRowExplicitlyMatchesProvider(row,provider){
  if(!provider||row?.status==='pending'||row?.presenceState==='missing')return false;
  const text=bankTransactionSearchText(row);if(!text)return false;
  return (CREDIT_SETTLEMENT_MARKERS[provider]||[]).some(marker=>text.includes(String(marker).toLowerCase()));
}
function moneyCents(value){return Math.round(num(value)*100)}
function cardSuffixForRows(rows){const suffixes=new Set(rows.map(row=>String(row?.accountNumber||'').replace(/\D/g,'').slice(-4)).filter(value=>value.length===4));return suffixes.size===1?[...suffixes][0]:''}
function bankTextHasCardSuffix(row,suffix){return !!suffix&&new RegExp(`(?:^|\\D)${suffix}(?:\\D|$)`).test(bankTransactionSearchText(row))}
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
// Build all admissible claims before consuming any bank evidence. A claim can
// cover one card, an exact aggregate, or an exact split debit. Only cycles present
// in EVERY optimal disjoint explanation are settled. Ties never pick a card.
function unresolvedSettlementIndexes(bankRows,candidates,reference){
  const unresolved=new Set(candidates.map((_,index)=>index)),groupMap=new Map();
  for(const [index,row] of candidates.entries()){
    const key=settlementGroupKey(row,'card');
    if(!groupMap.has(key))groupMap.set(key,{key,rows:[],indexes:[]});
    groupMap.get(key).rows.push(row);groupMap.get(key).indexes.push(index);
  }
  const groups=[...groupMap.values()].sort((a,b)=>a.key.localeCompare(b.key));
  for(const group of groups){
    group.due=group.rows[0].date;group.card=creditCardKey(group.rows[0]);
    group.providers=providerHintsForRows(group.rows);group.suffix=cardSuffixForRows(group.rows);
    group.known=group.rows.every(row=>row.includedInIlsTotal);
    group.expected=-group.rows.reduce((sum,row)=>sum+moneyCents(row.amount),0);
    group.proven=group.rows.some(row=>row.status!=='coverage_missing'&&['authoritative','issuer','known_cycle','manual'].includes(row.billingDateConfidence));
    group.next=groups.filter(other=>creditCardKey(other.rows[0])===group.card&&other.rows[0].date>group.due).map(other=>other.rows[0].date).sort()[0]||'';
  }
  const banks=[];
  for(const row of bankRows){
    const day=bankTransactionDay(row),value=moneyCents(row.amount);
    if(!day||day>reference||!value)continue;
    let eligible=groups.flatMap((group,index)=>day>=group.due&&(!group.next||day<group.next)&&bankRowLooksLikeCreditSettlement(row,group.providers)?[index]:[]);
    const suffixMatches=eligible.filter(index=>bankTextHasCardSuffix(row,groups[index].suffix));
    if(suffixMatches.length)eligible=suffixMatches;
    if(eligible.length)banks.push({row,value,eligible,suffixMatches});
  }
  // Disjoint evidence components can be proved independently. The guard applies
  // only to a complex connected ambiguity, not to the user's total card count.
  const remainingBanks=new Set(banks.map((_,index)=>index));
  while(remainingBanks.size){
    const bankIndexes=new Set([remainingBanks.values().next().value]),cardIndexes=new Set();
    for(const bankIndex of bankIndexes){
      remainingBanks.delete(bankIndex);
      for(const cardIndex of banks[bankIndex].eligible){
        if(cardIndexes.has(cardIndex))continue;cardIndexes.add(cardIndex);
        for(const other of remainingBanks)if(banks[other].eligible.includes(cardIndex))bankIndexes.add(other);
      }
    }
    const cards=[...cardIndexes],localGroups=cards.map(index=>groups[index]),localBanks=[...bankIndexes].map(index=>({...banks[index],eligible:banks[index].eligible.map(card=>cards.indexOf(card)),suffixMatches:banks[index].suffixMatches.map(card=>cards.indexOf(card))}));
    for(const localIndex of provenSettlementGroupIndexes(localGroups,localBanks))for(const rowIndex of localGroups[localIndex].indexes)unresolved.delete(rowIndex);
  }
  return unresolved;
}

function provenSettlementGroupIndexes(groups,banks){
  // Bounded exhaustive search; excess/complex evidence is unresolved, never guessed.
  if(!banks.length||banks.length>12||groups.length>12)return [];
  const claims=[],mask=indexes=>indexes.reduce((bits,index)=>bits|(1<<index),0);
  const add=(bankIndexes,cardIndexes,rank)=>claims.push({banks:mask(bankIndexes),cards:mask(cardIndexes),score:[rank===0?bankIndexes.length:0,rank===1?bankIndexes.length:0,rank===2?bankIndexes.length:0]});
  function subsets(indexes,visit){
    if(indexes.length>12)return;
    for(let bits=1;bits<(1<<indexes.length);bits++)visit(indexes.filter((_,i)=>bits&(1<<i)));
  }
  for(const [bankIndex,bank] of banks.entries()){
    const strong=bank.eligible.filter(index=>groups[index].proven&&bank.value<0);
    // Last-4 is optional bonus evidence only; an explicit provider with exactly
    // one eligible cycle is also proof even if the issuer amount is unknown.
    if(bank.suffixMatches.length===1&&strong.includes(bank.suffixMatches[0])){add([bankIndex],bank.suffixMatches,0);continue}
    if(bank.eligible.length===1&&strong.length===1&&groups[strong[0]].providers.some(provider=>bankRowExplicitlyMatchesProvider(bank.row,provider))){add([bankIndex],strong,1);continue}
    // Unknown amounts can equal any debit. They prevent uniqueness by amount.
    if(bank.eligible.some(index=>!groups[index].known))continue;
    subsets(bank.eligible,cardIndexes=>{
      if(cardIndexes.some(index=>groups[index].due!==groups[cardIndexes[0]].due))return;
      if(cardIndexes.reduce((sum,index)=>sum+groups[index].expected,0)===bank.value)add([bankIndex],cardIndexes,2);
    });
  }
  for(const [cardIndex,group] of groups.entries()){
    if(!group.known||!group.expected)continue;
    const bankIndexes=banks.flatMap((bank,index)=>bank.eligible.includes(cardIndex)&&bank.eligible.every(i=>groups[i].known)&&Math.sign(bank.value)===Math.sign(group.expected)?[index]:[]);
    subsets(bankIndexes,indexes=>{if(indexes.length>1&&indexes.reduce((sum,index)=>sum+banks[index].value,0)===group.expected)add(indexes,[cardIndex],2)});
  }
  const byBank=banks.map((_,index)=>claims.filter(claim=>claim.banks&(1<<index)));
  let visits=0,overflow=false,best=null,guaranteed=0;
  const compare=(a,b)=>{for(let i=0;i<3;i++)if(a[i]!==b[i])return a[i]-b[i];return 0};
  function search(remaining,cards,score){
    if(++visits>50000){overflow=true;return}
    if(!remaining){const comparison=best?compare(score,best):1;if(comparison>0){best=score;guaranteed=cards}else if(comparison===0)guaranteed&=cards;return}
    const bit=remaining&-remaining,index=31-Math.clz32(bit);
    search(remaining^bit,cards,score);
    for(const claim of byBank[index]){
      if(overflow)return;
      if((remaining&claim.banks)!==claim.banks||(cards&claim.cards))continue;
      search(remaining^claim.banks,cards|claim.cards,score.map((value,i)=>value+claim.score[i]));
    }
  }
  search((1<<banks.length)-1,0,[0,0,0]);
  return overflow?[]:groups.flatMap((_,index)=>guaranteed&(1<<index)?[index]:[]);
}
function settlementWarningId(account,rows){
  const first=rows[0]||{},due=String(first.date||''),cardKey=creditCardKey(first),provider=String(first.provider||'manual');
  return `credit_settlement_unmatched:${accountRole(account)}:${due}:${provider}:${cardKey}`;
}
function expiredSettlementWarnings(account,rows){
  const groups=new Map();
  for(const row of rows){const key=settlementGroupKey(row,'card');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row)}
  return [...groups.values()].map(group=>{const first=group[0],due=String(first?.date||''),releaseDate=addDaysISO(due,CREDIT_SETTLEMENT_MAX_HOLD_DAYS);return {id:settlementWarningId(account,group),kind:'credit_settlement_unmatched',account:accountRole(account),dueDate:due,releaseDate,provider:String(first?.provider||''),profileId:String(first?.profileId||''),accountNumber:String(first?.accountNumber||''),card:String(first?.card||'כרטיס אשראי'),amount:group.reduce((sum,row)=>sum+num(row.amount),0),rowCount:group.length,amountKnown:group.every(row=>row.includedInIlsTotal),missingAmountCount:group.filter(row=>!row.includedInIlsTotal).length}}).sort((a,b)=>a.dueDate.localeCompare(b.dueDate)||String(a.card).localeCompare(String(b.card),'he'));
}
function pendingCreditSettlementData(kupa,account,settlementRows,start,reference){
  const feed=bankFeedForAccount(kupa,account),hasFeed=!!isoDay(feed?.syncedAt);
  const unresolvedRows=settlementRows.filter(row=>row.date<reference&&row.bankSettlementState!=='settled'&&((hasFeed&&row.date<start)||!row.includedInIlsTotal||row.coverageIncomplete));
  const expiredRows=[],rows=[];
  for(const row of unresolvedRows){const releaseDate=addDaysISO(row.date,CREDIT_SETTLEMENT_MAX_HOLD_DAYS);if(releaseDate&&reference>=releaseDate)expiredRows.push(row);else rows.push(row)}
  return {rows,total:rows.reduce((sum,row)=>sum+num(row.amount),0),expiredRows,expiredTotal:expiredRows.reduce((sum,row)=>sum+num(row.amount),0),warnings:expiredSettlementWarnings(account,expiredRows)};
}

function rollForwardSettledCycleRows(rows,settlement,reference,{retainSettledCompleted=false}={}){
  if(!settlement?.settledCardKeys?.size)return rows;
  const unresolvedKeys=new Set(settlement.rows.map(creditRowKey)),futureByCard=new Map();
  for(const row of rows){const key=creditCardKey(row);if(!row?.date||row.date<=reference||!['authoritative','issuer','known_cycle','manual'].includes(row.billingDateConfidence)||!settlement.settledCardKeys.has(key))continue;if(!futureByCard.has(key))futureByCard.set(key,[]);futureByCard.get(key).push({date:row.date,confidence:row.billingDateConfidence})}
  for(const candidates of futureByCard.values())candidates.sort((a,b)=>a.date.localeCompare(b.date));
  return rows.flatMap(row=>{
    const key=creditCardKey(row);if(row.date!==reference||!settlement.settledCardKeys.has(key))return [row];
    if(row.status!=='pending')return retainSettledCompleted||unresolvedKeys.has(creditRowKey(row))?[row]:[];
    const transactionDate=isoDay(row.transactionDate),known=(futureByCard.get(key)||[]).find(candidate=>!transactionDate||candidate.date>=transactionDate);
    return known?[{...row,date:known.date,billingDate:known.date,billingMonth:monthKey(known.date),chargeDateSource:'bank_settlement_next_known_cycle',billingDateConfidence:'known_cycle'}]:[{...row,date:'',billingDate:'',billingMonth:'',chargeDateSource:'unassigned_after_bank_settlement',billingDateConfidence:'unassigned',uncertainBillingDate:true,includedInIlsTotal:false,amount:0}];
  });
}

function reconciledCreditRowsForAccount(kupa,account,reference,{retainSettledCompleted=false,includeHidden=true}={}){
  // Visibility is a presentation choice, never evidence that another card paid.
  const role=accountRole(account),ref=isoDay(reference)||localTodayISO(),start=kupaAccountBankAsOfDateData(kupa,role,ref),forecastStart=start>ref?start:ref,billingRows=creditBillingRowsData(kupa,{asOf:forecastStart,includeHidden:true}).filter(row=>row.account===role);
  const finalized=billingRows.filter(row=>row.status!=='pending'),recentStart=addDaysISO(forecastStart,-CREDIT_SETTLEMENT_MAX_HOLD_DAYS);
  // A newer charge on the same card must not hide an earlier incomplete cycle.
  // Keep whole cycles (including their known rows) for correct aggregate amounts.
  const selectedCycles=new Set([...settlementRowsForLatestElapsedCycle(finalized,forecastStart,forecastStart),...finalized.filter(row=>row.date&&row.date<=forecastStart&&(row.date>=recentStart||!row.includedInIlsTotal||row.coverageIncomplete))].map(row=>settlementGroupKey(row,'card')));
  const candidates=finalized.filter(row=>selectedCycles.has(settlementGroupKey(row,'card')));
  const feed=bankFeedForAccount(kupa,role),bankRows=isoDay(feed?.syncedAt)&&Array.isArray(feed.transactions)?feed.transactions:[],unresolved=unresolvedSettlementIndexes(bankRows,candidates,forecastStart);
  const settlementRows=candidates.map((row,index)=>({...row,bankSettlementState:unresolved.has(index)?'awaiting':'settled'}));
  const settlingCredit=pendingCreditSettlementData(kupa,role,settlementRows,start,forecastStart),expiredKeys=new Set(settlingCredit.expiredRows.map(creditRowKey));
  const states=new Map(settlementRows.map(row=>[creditRowKey(row),expiredKeys.has(creditRowKey(row))?'expired':row.bankSettlementState]));
  const current=settlementRows.filter(row=>row.date===forecastStart),currentSettlement={rows:current.filter(row=>row.bankSettlementState!=='settled'),settledCardKeys:new Set(current.filter(row=>row.bankSettlementState==='settled').map(creditCardKey))};
  const annotated=billingRows.map(row=>states.has(creditRowKey(row))?{...row,bankSettlementState:states.get(creditRowKey(row))}:row);
  const reconciledRows=rollForwardSettledCycleRows(annotated,currentSettlement,forecastStart,{retainSettledCompleted}).filter(row=>(includeHidden||!row.hidden)&&(retainSettledCompleted||row.bankSettlementState!=='settled'));
  const elapsedIncompleteCreditRows=settlingCredit.rows.filter(row=>!row.includedInIlsTotal||row.coverageIncomplete);
  return {role,ref,start,forecastStart,currentSettlement,settlingCredit,elapsedIncompleteCreditRows,rows:reconciledRows,installments:reconciledRows.filter(row=>row.date&&row.includedInIlsTotal&&Math.abs(row.amount)>0.004),unassignedRows:reconciledRows.filter(row=>!row.date)};
}

export function kupaReconciledCreditRowsData(kupa,account='all',reference=localTodayISO()){
  if(account==='all')return [...reconciledCreditRowsForAccount(kupa,'עסקי',reference).rows,...reconciledCreditRowsForAccount(kupa,'ביתי',reference).rows];
  return reconciledCreditRowsForAccount(kupa,account,reference).rows;
}

export function kupaReconciledCreditDetailRowsData(kupa,account='all',reference=localTodayISO()){
  const options={retainSettledCompleted:true,includeHidden:false};
  if(account==='all')return [...reconciledCreditRowsForAccount(kupa,'עסקי',reference,options).rows,...reconciledCreditRowsForAccount(kupa,'ביתי',reference,options).rows];
  return reconciledCreditRowsForAccount(kupa,account,reference,options).rows;
}

export function kupaReconciledCardUpcomingChargeData(kupa,creditAccountKey,reference=localTodayISO()){
  return kupaCardUpcomingChargeFromRowsData(kupaReconciledCreditRowsData(kupa,'all',reference),creditAccountKey,reference);
}

export function kupaCardUpcomingChargeFromRowsData(inputRows,creditAccountKey,reference=localTodayISO()){
  const ref=isoDay(reference)||localTodayISO(),rows=inputRows.filter(row=>row.creditAccountKey===creditAccountKey),unassigned=rows.filter(row=>!row.date),elapsed=rows.filter(row=>row.date<ref&&row.bankSettlementState==='awaiting'&&(!row.includedInIlsTotal||row.coverageIncomplete)),extra=[...unassigned,...elapsed],cycle=creditCyclesThroughHorizonRowsData(rows,'all',ref,unassigned).nextCycles[0];
  if(!cycle&&!extra.length)return null;
  const incomplete=[...(cycle?.rows.filter(row=>!row.includedInIlsTotal||row.coverageIncomplete)||[]),...extra],missingAmountCount=incomplete.filter(row=>row.amountStatus!=='known_ils').length;
  return {amount:cycle?.total||0,date:cycle?.billingDate||'',source:'transactions',pendingAmount:cycle?.pendingTotal||0,estimated:!cycle||cycle.status!=='finalized'||extra.length>0,status:incomplete.length?'incomplete':cycle.status,incompleteCount:incomplete.length,missingAmountCount,coverageGapCount:incomplete.filter(row=>row.coverageIncomplete).length,stalePendingCount:incomplete.filter(row=>row.status==='pending'&&!row.pendingFresh).length,unconvertedCount:incomplete.filter(row=>row.amountStatus==='foreign_unconverted').length,unknownAmountCount:incomplete.filter(row=>row.amountStatus==='unknown_amount').length,unassignedCount:unassigned.length,amountKnown:!!cycle&&missingAmountCount===0,complete:incomplete.length===0};
}

export function kupaCreditScheduleData(cr){
  if(!cr?.active||!isoDay(cr.firstChargeDate)||num(cr.installments)<1)return[];
  const total=num(cr.totalAmount),count=Math.max(1,Math.round(num(cr.installments))),base=Math.round((total/count)*100)/100;let rows=[],used=0;
  for(let i=0;i<count;i++){const amount=i===count-1?Math.round((total-used)*100)/100:base;used+=amount;rows.push({creditId:cr.id,date:addMonthsISO(cr.firstChargeDate,i),amount,part:i+1,totalParts:count,card:cr.card,account:accountRole(cr.account),ownerLabel:String(cr.ownerLabel||''),hidden:false,description:cr.description,source:'manual'})}
  return rows;
}

export function kupaSyncedInstallmentsData(kupa){
  return creditBillingRowsData(kupa).filter(row=>row.source!=='manual'&&row.date&&row.includedInIlsTotal&&Math.abs(row.amount)>0.004);
}

export function kupaAllInstallmentsData(kupa){return creditBillingRowsData(kupa).filter(row=>row.date&&row.includedInIlsTotal&&Math.abs(row.amount)>0.004)}
export function kupaAccountInstallmentsData(kupa,account='עסקי'){const role=accountRole(account);return kupaAllInstallmentsData(kupa).filter(row=>row.account===role)}

export function kupaExpenseOccurrencesForMonthData(kupa,key){
  const match=/^(\d{4})-(\d{2})$/.exec(String(key||''));if(!match)return[];const year=Number(match[1]),month=Number(match[2]);if(month<1||month>12)return[];const last=daysInMonth(year,month);
  return (Array.isArray(kupa?.expenses)?kupa.expenses:[]).filter(row=>row?.active).flatMap(row=>{let due;if(row.recurring!==false){const source=isoDay(row.date)||`${key}-01`,day=Math.max(1,Math.min(Number(source.slice(8,10))||1,last));due=`${year}-${pad2(month)}-${pad2(day)}`}else{if(monthKey(row.date)!==key)return[];due=isoDay(row.date)}return due?[{...row,dueDate:due}]:[]});
}

export function kupaExpenseRowsBetweenData(kupa,start,end){if(!isoDay(start)||!isoDay(end))return[];return monthKeysBetween(start,end).flatMap(key=>kupaExpenseOccurrencesForMonthData(kupa,key)).filter(row=>row.dueDate>=start&&row.dueDate<=end)}

export function kupaNextAccountCreditCycleData(kupa,account='עסקי',reference=localTodayISO()){
  return creditCyclesThroughHorizonData(kupa,account,reference);
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

export function kupaAccountCheckDepositsData(kupa,account='עסקי',reference=localTodayISO(),targetMonth=monthKey(reference),horizonDate=''){
  const role=accountRole(account),cutoffDay=cashflowCheckCutoffDayForAccount(kupa?.cashflowSettings,role),configuredCutoff=monthCutoffISO(targetMonth,cutoffDay),horizon=isoDay(horizonDate),cutoffDate=horizon&&configuredCutoff?horizon<configuredCutoff?horizon:configuredCutoff:configuredCutoff;
  const rows=(Array.isArray(kupa?.checks)?kupa.checks:[]).filter(row=>row?.status==='בקופה'&&accountRole(row?.account)===role).map(row=>({...row,dueDate:isoDay(row?.dueDate)})).filter(row=>row.dueDate&&cutoffDate&&row.dueDate<=cutoffDate).sort((a,b)=>a.dueDate.localeCompare(b.dueDate)||String(a.id||'').localeCompare(String(b.id||'')));
  return {rows,total:rows.reduce((sum,row)=>sum+num(row.amount),0),cutoffDay,cutoffDate};
}

export function kupaAccountCashflowData(kupa,account='עסקי',reference=localTodayISO()){
  const role=accountRole(account),ref=isoDay(reference)||localTodayISO(),balance=kupaAccountBankBalanceData(kupa,role),reconciliation=reconciledCreditRowsForAccount(kupa,role,ref),{start,forecastStart,rows:reconciledBillingRows,installments:reconciledInstallments,unassignedRows}=reconciliation;let cycle=creditCyclesThroughHorizonRowsData(reconciledBillingRows,role,forecastStart,unassignedRows);
  if(!cycle.nextCycles.length){const cutoffDay=cashflowCheckCutoffDayForAccount(kupa?.cashflowSettings,role),currentCutoff=monthCutoffISO(monthKey(forecastStart),cutoffDay),fallbackDate=currentCutoff>=forecastStart?currentCutoff:monthCutoffISO(monthKey(addMonthsISO(forecastStart,1)),cutoffDay);cycle={...cycle,targetDate:fallbackDate,targetEnd:fallbackDate,targetMonth:monthKey(fallbackDate)}}
  const elapsedCreditRows=reconciledInstallments.filter(row=>row.date>=start&&row.date<ref),settlingCredit=reconciliation.settlingCredit,elapsedExpenseRows=kupaExpenseRowsBetweenData(kupa,start,ref).filter(row=>row.dueDate<ref&&expenseBelongsTo(row,role)),targetExpenseRows=kupaExpenseRowsBetweenData(kupa,forecastStart,cycle.targetDate).filter(row=>expenseBelongsTo(row,role)),checkDeposits=kupaAccountCheckDepositsData(kupa,role,forecastStart,cycle.targetMonth,cycle.targetDate);
  const creditRows=[...elapsedCreditRows,...settlingCredit.rows.filter(row=>row.includedInIlsTotal),...cycle.rows].filter((row,index,all)=>all.findIndex(candidate=>candidate.creditId===row.creditId&&candidate.part===row.part)===index),expenseRows=[...elapsedExpenseRows,...targetExpenseRows].filter((row,index,all)=>all.findIndex(candidate=>candidate.id===row.id&&candidate.dueDate===row.dueDate)===index),credit=creditRows.reduce((sum,row)=>sum+moneyCents(row.amount),0)/100,expenses=expenseRows.reduce((sum,row)=>sum+moneyCents(row.amount),0)/100,checks=moneyCents(checkDeposits.total)/100,targetExpenseTotal=targetExpenseRows.reduce((sum,row)=>sum+num(row.amount),0),total=(moneyCents(credit)+moneyCents(expenses))/100,expectedChange=(moneyCents(checks)-moneyCents(total))/100,projected=balance===null?null:(moneyCents(balance)+moneyCents(expectedChange))/100;
  const elapsedIncompleteCreditRows=reconciliation.elapsedIncompleteCreditRows,incompleteCreditRows=[...cycle.incompleteRows,...elapsedIncompleteCreditRows];
  return {account:role,balance,credit,expenses,checks,total,expectedChange,creditRows,expenseRows,start,end:cycle.targetDate,targetDate:cycle.targetDate,targetMonth:cycle.targetMonth,nextCreditRows:cycle.rows,nextCreditCycles:cycle.cycles,nextCreditTotal:cycle.total,unassignedCreditRows:cycle.unassignedRows,elapsedIncompleteCreditRows,incompleteCreditRows,forecastIncomplete:incompleteCreditRows.length>0,settlingCreditRows:settlingCredit.rows,settlingCredit:settlingCredit.total,expiredSettlementCreditRows:settlingCredit.expiredRows,expiredSettlementCredit:settlingCredit.expiredTotal,expiredSettlementWarnings:settlingCredit.warnings,elapsedCredit:elapsedCreditRows.reduce((sum,row)=>sum+row.amount,0),elapsedExpenses:elapsedExpenseRows.reduce((sum,row)=>sum+num(row.amount),0),targetExpenseRows,targetExpenseTotal,checkRows:checkDeposits.rows,checkCutoffDay:checkDeposits.cutoffDay,checkCutoffDate:checkDeposits.cutoffDate,projected,alert:cashflowAlertForAccount(projected,kupa?.cashflowSettings,role)};
}
