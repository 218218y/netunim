const PROVIDER_LABELS={visaCal:'כאל',max:'MAX',isracard:'ישראכרט',amex:'American Express'};

function finite(value){if(value===null||value===undefined||value==='')return null;const number=Number(value);return Number.isFinite(number)?number:null}
function roundMoney(value){return Math.round(Number(value||0)*100)/100}
function pad2(value){return String(value).padStart(2,'0')}
export function creditBillingISODate(value){const raw=String(value||'').slice(0,10),match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);if(!match)return '';const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);return month>=1&&month<=12&&day>=1&&day<=daysInMonth(year,month)?raw:''}
export function creditBillingMonthKey(value){const date=creditBillingISODate(value);return date?date.slice(0,7):''}
function localTodayISO(){const date=new Date();return `${date.getFullYear()}-${pad2(date.getMonth()+1)}-${pad2(date.getDate())}`}
function daysInMonth(year,month){return new Date(Date.UTC(year,month,0)).getUTCDate()}
function addMonthsISO(value,delta){const raw=creditBillingISODate(value);if(!raw)return '';const [year,month,day]=raw.split('-').map(Number),index=year*12+month-1+Number(delta||0),targetYear=Math.floor(index/12),targetMonth=index-targetYear*12+1;return `${targetYear}-${pad2(targetMonth)}-${pad2(Math.min(day,daysInMonth(targetYear,targetMonth)))}`}
function transactionTime(value){const match=/^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(value??'').trim());if(!match)return '';const hour=Number(match[1]),minute=Number(match[2]);return hour>=0&&hour<=23&&minute>=0&&minute<=59?`${pad2(hour)}:${pad2(minute)}`:''}
function normalizedCurrency(value){return String(value||'').trim().toUpperCase().replace(/\s+/g,'')}
export function creditBillingIsShekelCurrency(value){const currency=normalizedCurrency(value);return !currency||['ILS','NIS','₪','ש״ח','שח'].includes(currency)}
function transactionOriginDate(tx){return creditBillingISODate(tx?.transactionDate)||creditBillingISODate(tx?.date)||creditBillingISODate(tx?.processedDate)}
function transactionBillingDate(tx){return creditBillingISODate(tx?.processedDate)}
function transactionBillingLowerBound(tx){const origin=transactionOriginDate(tx),scheduled=creditBillingISODate(tx?.date);return scheduled>origin?scheduled:origin}
function transactionPart(tx){return Math.max(1,Math.trunc(Number(tx?.installments?.number)||1))}
function transactionTotalParts(tx){return Math.max(1,Math.trunc(Number(tx?.installments?.total)||1))}
function cardMappingKey(profile,account){return `${String(profile?.profileId||'').trim()}:${String(account?.accountNumber||'').trim()}`}
function synchronizedCardKey(profile,account){return `sync:${String(profile?.profileId||'').trim()}:${String(account?.accountNumber||'').trim()}`}
function accountRole(value){return value==='ביתי'||value==='home'?'ביתי':'עסקי'}

export function creditTransactionAmountData(tx={}){
  const charged=finite(tx.chargedAmount),original=finite(tx.originalAmount),chargedCurrency=normalizedCurrency(tx.chargedCurrency),originalCurrency=normalizedCurrency(tx.originalCurrency),chargedShekel=creditBillingIsShekelCurrency(chargedCurrency||originalCurrency),originalShekel=creditBillingIsShekelCurrency(originalCurrency||chargedCurrency);
  if(charged!==null&&Math.abs(charged)>0.0001){
    if(chargedShekel)return {amount:roundMoney(-charged),rawAmount:charged,currency:'ILS',included:true,estimated:false,source:'charged_amount'};
    return {amount:0,rawAmount:charged,currency:chargedCurrency||originalCurrency,included:false,estimated:false,source:'foreign_only'};
  }
  if(original!==null&&Math.abs(original)>0.0001){
    if(originalShekel)return {amount:roundMoney(-original),rawAmount:original,currency:'ILS',included:true,estimated:true,source:'original_ils_estimate'};
    return {amount:0,rawAmount:original,currency:originalCurrency||chargedCurrency,included:false,estimated:true,source:'foreign_only'};
  }
  return {amount:0,rawAmount:null,currency:chargedCurrency||originalCurrency||'ILS',included:false,estimated:true,source:'unknown'};
}

// Day-based forecast: a successful snapshot is usable on its fetch day and the
// next two calendar days. Missing/invalid/future timestamps never prove freshness.
export function creditPendingFreshData(account={},asOf=localTodayISO()){
  const fetched=creditBillingISODate(account.pendingFetchedAt),reference=creditBillingISODate(asOf);
  if(account.pendingStatus!=='success'||!fetched||!reference||!Number.isFinite(Date.parse(account.pendingFetchedAt)))return false;
  const age=(Date.parse(reference)-Date.parse(fetched))/86400000;
  return age>=0&&age<=2;
}

export function creditPendingAuthorizationTotalData(account={},asOf=localTodayISO()){
  if(!creditPendingFreshData(account,asOf))return 0;
  const entries=accountTransactionEntries(account),matched=matchedPendingIndexes(entries);
  let total=0;
  for(const [index,{tx}] of entries.entries()){if(tx?.status!=='pending'||matched.has(index))continue;const amount=creditTransactionAmountData(tx);if(amount.included)total+=amount.amount}
  return roundMoney(total);
}

function accountTransactionEntries(account={}){
  const months=Array.isArray(account.months)?account.months:[];
  if(months.length){
    const rows=[];
    for(const slice of months){const hint=String(slice?.providerSchemaVersion||'')==='legacy-credit-feed'?'':creditBillingMonthKey(`${String(slice?.month||'')}-01`),transactions=Array.isArray(slice?.transactions)?slice.transactions:[],coverageIncomplete=slice?.status==='missing'||(!!slice?.fetchStatus&&slice.fetchStatus!=='success');for(const tx of transactions)rows.push({tx,billingMonthHint:hint,coverageIncomplete,coverageStatus:String(slice?.status||slice?.fetchStatus||'')});if(coverageIncomplete&&!transactions.length)rows.push({tx:null,billingMonthHint:hint,coverageIncomplete:true,coverageStatus:String(slice?.status||slice?.fetchStatus||''),coveragePlaceholder:true})}
    for(const tx of Array.isArray(account.pendingTransactions)?account.pendingTransactions:[])rows.push({tx,billingMonthHint:'',coverageIncomplete:false});
    for(const tx of Array.isArray(account.unassignedTransactions)?account.unassignedTransactions:[])rows.push({tx,billingMonthHint:'',coverageIncomplete:false});
    return rows;
  }
  return (Array.isArray(account.txns)?account.txns:[]).map(tx=>({tx,billingMonthHint:'',coverageIncomplete:false}));
}
function accountTransactions(account={}){return accountTransactionEntries(account).map(entry=>entry.tx)}

function canonicalBillingDates(account){
  const groups=new Map(),months=Array.isArray(account?.months)?account.months:[];
  if(months.length){for(const slice of months){const key=String(slice?.month||'');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(...(Array.isArray(slice?.transactions)?slice.transactions:[]))}}
  else for(const tx of accountTransactions(account)){const key=creditBillingMonthKey(transactionBillingDate(tx));if(!groups.has(key))groups.set(key,[]);groups.get(key).push(tx)}
  const dates=[],preferredDay=Number(creditBillingISODate(account?.balanceDate).slice(8,10));
  for(const transactions of groups.values()){
    const counts=new Map();for(const tx of transactions){if(tx?.status==='pending')continue;const date=creditBillingISODate(tx?.processedDate);if(date)counts.set(date,(counts.get(date)||0)+1)}
    const ranked=[...counts.entries()].sort((a,b)=>b[1]-a[1]||(Number(b[0].slice(8,10))===preferredDay?1:0)-(Number(a[0].slice(8,10))===preferredDay?1:0)||a[0].localeCompare(b[0]));
    if(ranked.length&&(!ranked[1]||ranked[0][1]>ranked[1][1]||Number(ranked[0][0].slice(8,10))===preferredDay))dates.push(ranked[0][0]);
  }
  return [...new Set(dates)].sort();
}

function knownBillingDates(account,reference,transactionDate){return canonicalBillingDates(account).filter(date=>date>=reference&&(!transactionDate||date>=transactionDate))}

function inferredBillingDay(account){
  const dates=canonicalBillingDates(account),counts=new Map();
  for(const date of dates){const day=Number(date.slice(8,10));counts.set(day,(counts.get(day)||0)+1)}
  const ranked=[...counts.entries()].sort((a,b)=>b[1]-a[1]||a[0]-b[0]);
  if(!ranked.length||ranked[0][1]<2||ranked[1]?.[1]===ranked[0][1]||ranked[0][1]/dates.size<0.6)return null;
  return ranked[0][0];
}

function nextDateForBillingDay(day,reference,transactionDate){
  let candidate=`${reference.slice(0,7)}-${pad2(Math.min(day,daysInMonth(Number(reference.slice(0,4)),Number(reference.slice(5,7)))))}`;
  if(candidate<reference||(transactionDate&&candidate<transactionDate))candidate=addMonthsISO(candidate,1);
  return candidate;
}

function dateForBillingMonth(day,key){const match=/^(\d{4})-(\d{2})$/.exec(String(key||''));if(!match)return '';const year=Number(match[1]),month=Number(match[2]);return `${key}-${pad2(Math.min(day,daysInMonth(year,month)))}`}

export function creditFinalizedBillingDateData(account={},tx={},billingMonthHint=''){
  const issuerDate=transactionBillingDate(tx);if(issuerDate)return {date:issuerDate,source:'issuer_processed_date',confidence:'authoritative'};
  const lowerBound=transactionBillingLowerBound(tx),known=canonicalBillingDates(account),hint=creditBillingMonthKey(`${String(billingMonthHint||'')}-01`),hinted=hint?known.filter(date=>creditBillingMonthKey(date)===hint):[];
  if(hinted.length)return {date:hinted[0],source:'known_billing_cycle',confidence:'known_cycle'};
  const nextKnown=lowerBound?known.find(date=>date>=lowerBound):'';if(nextKnown)return {date:nextKnown,source:'known_billing_cycle',confidence:'known_cycle'};
  const historyDay=inferredBillingDay(account),issuerNext=creditBillingISODate(account?.balanceDate),inferredDay=historyDay??(hint&&issuerNext?Number(issuerNext.slice(8,10)):null);if(inferredDay!==null){const date=hint?dateForBillingMonth(inferredDay,hint):lowerBound?nextDateForBillingDay(inferredDay,lowerBound,lowerBound):'';if(date)return {date,source:historyDay!==null?'inferred_billing_day':'issuer_next_charge_day',confidence:'inferred'}}
  return {date:'',source:'unassigned',confidence:'unassigned'};
}

export function creditPendingBillingDateData(account={},tx={},asOf=localTodayISO()){
  const reference=creditBillingISODate(asOf)||localTodayISO(),transactionDate=transactionOriginDate(tx),issuerDate=creditBillingISODate(account.balanceDate);
  if(issuerDate&&issuerDate>=reference&&(!transactionDate||issuerDate>=transactionDate))return {date:issuerDate,source:'issuer_next_charge',confidence:'issuer'};
  const known=knownBillingDates(account,reference,transactionDate);if(known.length)return {date:known[0],source:'known_future_cycle',confidence:'known_cycle'};
  return {date:'',source:'unassigned',confidence:'unassigned'};
}

function transactionDisplayAmount(tx,amountData){
  const original=finite(tx?.originalAmount),charged=finite(tx?.chargedAmount);
  if(original!==null&&Math.abs(original)>0.0001)return Math.abs(original);
  if(charged!==null&&Math.abs(charged)>0.0001)return Math.abs(charged);
  return Math.abs(amountData.amount);
}

function transactionTotalAmount(tx,amountData){
  const original=finite(tx?.originalAmount),charged=finite(tx?.chargedAmount),originalCurrency=normalizedCurrency(tx?.originalCurrency),chargedCurrency=normalizedCurrency(tx?.chargedCurrency);
  if(amountData.included&&originalCurrency&&!creditBillingIsShekelCurrency(originalCurrency))return charged!==null&&Math.abs(charged)>0.0001&&creditBillingIsShekelCurrency(chargedCurrency)?Math.abs(charged):Math.abs(amountData.amount);
  if(original!==null&&Math.abs(original)>0.0001&&creditBillingIsShekelCurrency(originalCurrency||chargedCurrency))return Math.abs(original);
  return transactionDisplayAmount(tx,amountData);
}

function transactionIdentity(profile,account,tx,index,date,amountData){
  const id=String(tx?.id||tx?.identifier||'').trim(),part=transactionPart(tx),stable=id?`${id}|${date}|${part}`:`idless-${index}|${transactionOriginDate(tx)}|${date}|${amountData.rawAmount}|${String(tx?.description||'')}`;
  return `${String(profile?.profileId||'')}|${String(account?.accountNumber||'')}|${stable}`;
}

function correlationKey(tx){
  // Account/provider scope is supplied by the caller. Require a precise purchase
  // minute, merchant, signed original amount and explicit currency. Date-only
  // and installment matches are intentionally left visible rather than guessed.
  if(!tx||transactionTotalParts(tx)>1)return '';
  const date=creditBillingISODate(tx.transactionDate)||creditBillingISODate(tx.date),time=transactionTime(tx.transactionTime),merchant=String(tx.description||'').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase(),amount=finite(tx.originalAmount),currency=normalizedCurrency(tx.originalCurrency);
  if(!date||!time||!merchant||amount===null||!amount||!currency)return '';
  return JSON.stringify([date,time,merchant,roundMoney(amount),creditBillingIsShekelCurrency(currency)?'ILS':currency]);
}

function matchedPendingIndexes(entries){
  const ids=new Set(entries.filter(entry=>entry.tx&&entry.tx.status!=='pending').flatMap(({tx})=>[tx.id,tx.identifier].map(value=>String(value||'').trim()).filter(Boolean))),groups=new Map(),matched=new Set();
  for(const [index,{tx}] of entries.entries()){
    if(!tx)continue;
    if(tx.status==='pending'&&[tx.id,tx.identifier].some(value=>value&&ids.has(String(value).trim())))matched.add(index);
    const key=correlationKey(tx);if(!key)continue;
    if(!groups.has(key))groups.set(key,{pending:[],final:[]});groups.get(key)[tx.status==='pending'?'pending':'final'].push(index);
  }
  for(const group of groups.values())if(group.pending.length===1&&group.final.length===1)matched.add(group.pending[0]);
  return matched;
}

function synchronizedRows(state,asOf,includeHidden){
  const sync=state?.creditSync&&typeof state.creditSync==='object'&&!Array.isArray(state.creditSync)?state.creditSync:{},mappings=sync.cardMappings&&typeof sync.cardMappings==='object'&&!Array.isArray(sync.cardMappings)?sync.cardMappings:{},rows=[];
  for(const profile of Array.isArray(sync.profiles)?sync.profiles:[])for(const account of Array.isArray(profile?.accounts)?profile.accounts:[]){
    const mapping=mappings[cardMappingKey(profile,account)]||{};if(mapping.included!==true)continue;
    const hidden=mapping.hidden===true;if(hidden&&!includeHidden)continue;
    const transactions=accountTransactionEntries(account),matchedPending=matchedPendingIndexes(transactions),seen=new Set(),role=accountRole(mapping.account||profile.defaultAccount),cardName=mapping.cardName||[PROVIDER_LABELS[profile.provider]||profile.label||profile.provider||'כרטיס אשראי',account.accountNumber?`••${String(account.accountNumber).slice(-4)}`:''].filter(Boolean).join(' '),pendingFresh=creditPendingFreshData(account,asOf);
    for(const [index,entry] of transactions.entries()){
      const tx=entry.tx;
      if(entry.coveragePlaceholder){const projection=creditFinalizedBillingDateData(account,{},entry.billingMonthHint),date=projection.date,identity=`coverage|${String(profile.profileId||'')}|${String(account.accountNumber||'')}|${entry.billingMonthHint||index}`;rows.push({source:'credit_unknown',creditId:`SYNC:${identity}`,profileId:String(profile.profileId||''),provider:String(profile.provider||''),accountNumber:String(account.accountNumber||''),creditAccountKey:synchronizedCardKey(profile,account),date,billingDate:date,billingMonth:creditBillingMonthKey(date),transactionDate:'',transactionTime:'',amount:0,displayAmount:0,transactionAmount:0,displayCurrency:'ILS',isShekel:true,foreignCurrency:false,originalAmount:null,originalCurrency:'',part:1,totalParts:1,card:hidden?'כרטיסים מוסתרים':cardName,account:role,ownerLabel:String(profile.ownerLabel||''),hidden,description:'כיסוי נתוני האשראי לחודש אינו מלא',memo:'',status:'coverage_missing',pendingFresh:false,chargeDateSource:projection.source,billingDateConfidence:projection.confidence,includedInIlsTotal:false,amountEstimated:true,amountSource:'coverage_missing',amountStatus:'unknown_amount',unconverted:false,unknownAmount:true,uncertainBillingDate:!date,coverageIncomplete:true,coverageStatus:entry.coverageStatus,totalAmount:0});continue}
      const pending=tx?.status==='pending';if(matchedPending.has(index))continue;
      const projection=pending?creditPendingBillingDateData(account,tx,asOf):creditFinalizedBillingDateData(account,tx,entry.billingMonthHint),date=projection.date,amountData=creditTransactionAmountData(tx),freshEnough=!pending||pendingFresh,includedInIlsTotal=!!date&&amountData.included&&freshEnough,amount=includedInIlsTotal?amountData.amount:0,identity=transactionIdentity(profile,account,tx,index,date,amountData),coverageIncomplete=entry.coverageIncomplete===true||(pending&&!pendingFresh),coverageStatus=entry.coverageStatus||(pending&&!pendingFresh?String(account.pendingStatus||'missing'):'');
      if(seen.has(identity))continue;seen.add(identity);
      const original=finite(tx?.originalAmount),foreignCurrency=(!!normalizedCurrency(tx?.originalCurrency)&&!creditBillingIsShekelCurrency(tx.originalCurrency))|| (!!normalizedCurrency(tx?.chargedCurrency)&&!creditBillingIsShekelCurrency(tx.chargedCurrency)),part=pending?1:transactionPart(tx),totalParts=pending?1:transactionTotalParts(tx),source=pending?'credit_pending':amountData.included?'credit_sync':amountData.source==='foreign_only'?'credit_foreign':'credit_unknown',amountStatus=amountData.included?'known_ils':amountData.source==='foreign_only'?'foreign_unconverted':'unknown_amount';
      rows.push({source,creditId:`${pending?'PENDING':'SYNC'}:${identity}`,profileId:String(profile.profileId||''),provider:String(profile.provider||''),accountNumber:String(account.accountNumber||''),creditAccountKey:synchronizedCardKey(profile,account),date,billingDate:date,billingMonth:creditBillingMonthKey(date),transactionDate:transactionOriginDate(tx),transactionTime:transactionTime(tx?.transactionTime),amount,displayAmount:transactionDisplayAmount(tx,amountData),transactionAmount:transactionDisplayAmount(tx,amountData),displayCurrency:amountData.included?'ILS':amountData.currency,isShekel:amountData.included,foreignCurrency,originalAmount:original===null?null:Math.abs(original),originalCurrency:String(tx?.originalCurrency||'').trim(),part,totalParts,card:hidden?'כרטיסים מוסתרים':cardName,account:role,ownerLabel:String(profile.ownerLabel||''),hidden,description:String(tx?.description||''),memo:String(tx?.memo||''),status:pending?'pending':String(tx?.status||'completed'),pendingFresh,chargeDateSource:projection.source,billingDateConfidence:projection.confidence,includedInIlsTotal,amountEstimated:amountData.estimated||pending,amountSource:amountData.source,amountStatus,unconverted:amountStatus==='foreign_unconverted',unknownAmount:amountStatus==='unknown_amount',uncertainBillingDate:!date,coverageIncomplete,coverageStatus,totalAmount:transactionTotalAmount(tx,amountData)});
    }
  }
  return rows;
}

function manualRows(state,asOf){
  const rows=[];
  for(const record of Array.isArray(state?.credits)?state.credits:[]){
    const first=creditBillingISODate(record?.firstChargeDate),count=Math.max(0,Math.trunc(Number(record?.installments)||0));if(!first||!count)continue;
    const total=finite(record.totalAmount)||0,base=roundMoney(total/count);let used=0;
    for(let index=0;index<count;index++){
      const amount=index===count-1?roundMoney(total-used):base;used=roundMoney(used+amount);const date=addMonthsISO(first,index);if(record.active===false&&date>=asOf)continue;
      const creditId=String(record.id||`manual-${index}`);rows.push({source:'manual',creditId,profileId:'',provider:'manual',accountNumber:'',creditAccountKey:`manual:${String(record.card||record.id||index)}`,date,billingDate:date,billingMonth:creditBillingMonthKey(date),transactionDate:creditBillingISODate(record.transactionDate),transactionTime:'',amount,displayAmount:total,transactionAmount:total,displayCurrency:'ILS',isShekel:true,foreignCurrency:false,originalAmount:total,originalCurrency:'ILS',part:index+1,totalParts:count,card:String(record.card||'תוספת ידנית'),account:accountRole(record.account),ownerLabel:String(record.ownerLabel||''),hidden:false,description:String(record.description||record.note||''),memo:'',status:'completed',pendingFresh:true,chargeDateSource:'manual_schedule',billingDateConfidence:'manual',includedInIlsTotal:true,amountEstimated:false,amountSource:'manual',amountStatus:'known_ils',unconverted:false,unknownAmount:false,uncertainBillingDate:false,coverageIncomplete:false,coverageStatus:'',totalAmount:total,record});
    }
  }
  return rows;
}

function seriesKey(row){
  if(row.source!=='credit_sync'||row.totalParts<=1)return row.creditId;
  const raw=String(row.creditId||'').replace(/\|[^|]*\|\d+$/,'').replace(/_\d+$/,'');
  return `${raw}|${row.totalParts}|${row.transactionDate}|${row.description}`;
}

function enrichSeries(rows){
  const groups=new Map();
  for(const row of rows.filter(item=>item.source==='credit_sync')){const key=seriesKey(row);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row)}
  for(const [key,items] of groups){const parts=new Set(items.map(row=>row.part)),totalParts=Math.max(...items.map(row=>row.totalParts)),explicitTotal=items.map(row=>row.totalAmount).find(value=>Number.isFinite(Number(value))&&Number(value)>0),series={id:key,totalAmount:explicitTotal??roundMoney(items.reduce((sum,row)=>sum+row.amount,0)),partial:parts.size<totalParts,transactionDate:items[0]?.transactionDate||'',transactionTime:items[0]?.transactionTime||''};for(const row of items){row.series=series;row.charge={date:row.date,amount:row.amount,part:row.part,totalParts:row.totalParts}}}
  for(const row of rows){if(row.source==='credit_pending')row.pending={id:row.creditId,isShekel:row.isShekel};if(row.source==='credit_foreign')row.foreign={id:row.creditId}}
  return rows;
}

function cycleRows(rows){
  const groups=new Map();
  for(const row of rows){if(!row.date)continue;const key=`${row.creditAccountKey}|${row.date}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row)}
  return [...groups.entries()].map(([id,items])=>{const finalized=items.filter(row=>row.status!=='pending'&&row.includedInIlsTotal),pending=items.filter(row=>row.status==='pending'&&row.includedInIlsTotal),unconverted=items.filter(row=>row.amountStatus==='foreign_unconverted'),unknownAmount=items.filter(row=>row.amountStatus==='unknown_amount'),stalePending=items.filter(row=>row.status==='pending'&&!row.pendingFresh),missingAmount=items.filter(row=>row.amountStatus!=='known_ils'),coverageGap=items.filter(row=>row.coverageIncomplete),incomplete=items.filter(row=>!row.includedInIlsTotal||row.coverageIncomplete);return {id,creditAccountKey:items[0].creditAccountKey,billingDate:items[0].date,date:items[0].date,billingMonth:items[0].billingMonth,card:items[0].card,account:items[0].account,provider:items[0].provider,profileId:items[0].profileId,accountNumber:items[0].accountNumber,hidden:items[0].hidden,rows:items,finalizedTotal:roundMoney(finalized.reduce((sum,row)=>sum+row.amount,0)),pendingTotal:roundMoney(pending.reduce((sum,row)=>sum+row.amount,0)),total:roundMoney(items.reduce((sum,row)=>sum+row.amount,0)),pendingCount:pending.length,unconvertedCount:unconverted.length,unknownAmountCount:unknownAmount.length,stalePendingCount:stalePending.length,missingAmountCount:missingAmount.length,coverageGapCount:coverageGap.length,incompleteCount:incomplete.length,status:incomplete.length?'incomplete':pending.length||items.some(row=>row.amountEstimated||row.billingDateConfidence==='inferred')?'estimated':'finalized'} }).sort((a,b)=>a.billingDate.localeCompare(b.billingDate)||String(a.card).localeCompare(String(b.card),'he'));
}

export function creditBillingModelData(state={},options={}){
  const asOf=creditBillingISODate(options.asOf)||localTodayISO(),includeHidden=options.includeHidden!==false,rows=enrichSeries([...synchronizedRows(state,asOf,includeHidden),...manualRows(state,asOf)]).sort((a,b)=>String(a.date||'9999').localeCompare(String(b.date||'9999'))||String(a.card).localeCompare(String(b.card),'he')||String(a.description).localeCompare(String(b.description),'he')),unassignedRows=rows.filter(row=>!row.date);
  return {asOf,rows,cycles:cycleRows(rows),unassignedRows};
}

export function creditBillingRowsData(state={},options={}){return creditBillingModelData(state,options).rows}
export function creditBillingCyclesData(state={},options={}){return creditBillingModelData(state,options).cycles}
export function creditForecastRowsData(state={},options={}){const model=creditBillingModelData(state,options);return model.rows.filter(row=>row.date&&row.date>=model.asOf)}

export function creditCyclesThroughHorizonRowsData(inputRows=[],account='עסקי',reference=localTodayISO(),unassignedRows=[]){
  const asOf=creditBillingISODate(reference)||localTodayISO(),allAccounts=account==='all',role=accountRole(account),rows=Array.isArray(inputRows)?inputRows:[],future=cycleRows(rows).filter(cycle=>(allAccounts||cycle.account===role)&&cycle.billingDate>=asOf&&(Math.abs(cycle.total)>0.004||cycle.status==='incomplete')),nextByCard=new Map();
  for(const cycle of future){const current=nextByCard.get(cycle.creditAccountKey);if(!current||cycle.billingDate<current)nextByCard.set(cycle.creditAccountKey,cycle.billingDate)}
  const nextCycles=future.filter(cycle=>nextByCard.get(cycle.creditAccountKey)===cycle.billingDate),targetDate=nextCycles.length?nextCycles.reduce((latest,cycle)=>cycle.billingDate>latest?cycle.billingDate:latest,nextCycles[0].billingDate):asOf,cycles=future.filter(cycle=>cycle.billingDate<=targetDate),horizonRows=cycles.flatMap(cycle=>cycle.rows.filter(row=>row.includedInIlsTotal&&Math.abs(row.amount)>0.004)),uncertain=(Array.isArray(unassignedRows)?unassignedRows:[]).filter(row=>allAccounts||row.account===role),incompleteRows=[...uncertain,...cycles.flatMap(cycle=>cycle.rows.filter(row=>!row.includedInIlsTotal||row.coverageIncomplete))];
  return {rows:horizonRows,cycles,nextCycles,total:roundMoney(horizonRows.reduce((sum,row)=>sum+row.amount,0)),targetDate,targetMonth:creditBillingMonthKey(targetDate),targetEnd:targetDate,unassignedRows:uncertain,incompleteRows};
}

export function creditCyclesThroughHorizonData(state={},account='עסקי',reference=localTodayISO()){
  const asOf=creditBillingISODate(reference)||localTodayISO(),model=creditBillingModelData(state,{asOf});
  return creditCyclesThroughHorizonRowsData(model.rows,account,asOf,model.unassignedRows);
}

export function creditAccountKnownFutureCommitmentData(account={},asOf=localTodayISO()){
  const state={creditSync:{profiles:[{profileId:'account',provider:'',defaultAccount:'עסקי',accounts:[account]}],cardMappings:{[`account:${String(account.accountNumber||'')}`]:{included:true,hidden:false,account:'עסקי'}}}},model=creditBillingModelData(state,{asOf});
  return roundMoney(model.rows.filter(row=>row.status!=='pending'&&row.date>=model.asOf&&row.includedInIlsTotal).reduce((sum,row)=>sum+row.amount,0));
}

export function creditAccountUpcomingChargeData(account={},provider='',asOf=localTodayISO()){
  const state={creditSync:{profiles:[{profileId:'account',provider,defaultAccount:'עסקי',accounts:[account]}],cardMappings:{[`account:${String(account.accountNumber||'')}`]:{included:true,hidden:false,account:'עסקי'}}}},model=creditBillingModelData(state,{asOf}),cycle=model.cycles.find(item=>item.billingDate>=model.asOf&&(Math.abs(item.total)>0.004||item.status==='incomplete'));
  if(cycle)return {amount:cycle.total,date:cycle.billingDate,source:'transactions',pendingAmount:cycle.pendingTotal,estimated:cycle.status!=='finalized',status:cycle.status,incompleteCount:cycle.incompleteCount,missingAmountCount:cycle.missingAmountCount,coverageGapCount:cycle.coverageGapCount,stalePendingCount:cycle.stalePendingCount,unconvertedCount:cycle.unconvertedCount,unknownAmountCount:cycle.unknownAmountCount,amountKnown:cycle.missingAmountCount===0,complete:cycle.incompleteCount===0};
  if(provider==='visaCal'){const amount=finite(account.balance),date=creditBillingISODate(account.balanceDate);if(amount!==null)return {amount:roundMoney(Math.abs(amount)),date,source:'issuer_balance',pendingAmount:0,estimated:false}}
  return null;
}
