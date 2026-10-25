// @ts-check
/** @typedef {Partial<import('./kupa-cashflow-contracts.js').ReconciledRow>} DetailRow */
/** @typedef {{key:string,items:DetailRow[]}} DetailMonth */

/** @param {DetailRow|null|undefined} row */
export function creditDetailDisplayDate(row){return String(row?.date||row?.detailDisplayBillingDate||'').slice(0,10)}
/** @param {DetailRow|null|undefined} row */
export function creditDetailCycleDisplayDate(row){return String(row?.detailCycleBillingDate||row?.detailDisplayBillingDate||row?.date||'').slice(0,10)}

/** @param {DetailMonth} month @param {string} reference */
export function creditDetailMonthIsPast(month,reference){
  return month.key!=='unassigned'&&month.items.length>0&&month.items.every(row=>{
    const date=creditDetailCycleDisplayDate(row),statementAssigned=!!row?.detailCycleBillingDate;
    return !!date&&(date<reference||(!statementAssigned&&row.bankSettlementState==='settled'));
  });
}

/** @param {DetailRow} row @param {string} [from] @param {string} [to] */
export function creditDetailRangeMatch(row,from='',to=''){
  const date=creditDetailDisplayDate(row);
  return !!date&&(!from||date>=from)&&(!to||date<=to);
}

/** @param {string} reference */
export function creditDetailRecentThreeRange(reference){
  const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(reference||''));
  if(!match)return {from:'',to:''};
  const year=Number(match[1]),month=Number(match[2]),start=new Date(Date.UTC(year,month-3,1));
  return {from:`${start.getUTCFullYear()}-${String(start.getUTCMonth()+1).padStart(2,'0')}-01`,to:String(reference)};
}

/** @param {DetailRow} row @param {string} period @param {string} reference */
export function creditDetailQuickPeriodMatch(row,period,reference){
  if(period==='all')return true;
  if(period!=='recent3')return false;
  const {from,to}=creditDetailRecentThreeRange(reference);
  return !!from&&creditDetailRangeMatch(row,from,to);
}

/** @param {string} monthValue @param {string} view @param {string} currentMonth */
export function creditViewAllowsMonth(monthValue,view,currentMonth){
  const key=String(monthValue||''),current=String(currentMonth||'');
  if(!/^\d{4}-\d{2}$/.test(key)||!/^\d{4}-\d{2}$/.test(current)||key<current)return false;
  const selected=String(view||'rolling12');
  if(selected==='all')return true;
  if(/^\d{4}$/.test(selected))return key.startsWith(`${selected}-`);
  const [year=NaN,month=NaN]=key.split('-').map(Number),[currentYear=NaN,currentMonthNumber=NaN]=current.split('-').map(Number);
  return year*12+month<=currentYear*12+currentMonthNumber+11;
}

/** @param {DetailRow|null|undefined} row */
export function creditDetailChargeDay(row){
  const date=creditDetailCycleDisplayDate(row),day=Number(date.slice(8,10));
  if(!Number.isInteger(day))return '';
  if(day>=7&&day<=12)return '10';
  if(day>=13&&day<=18)return '15';
  return '';
}

/** @param {DetailRow|null|undefined} row */
export function creditDetailNominalChargeDay(row){
  const nominal=Number(row?.detailCycleNominalDay);
  if(Number.isInteger(nominal)&&nominal>=1&&nominal<=31)return String(nominal);
  const date=creditDetailCycleDisplayDate(row),match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(date);if(!match)return '';
  const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
  if(day===10||day===15)return String(day);
  if(day===11&&new Date(Date.UTC(year,month-1,10)).getUTCDay()===6)return '10';
  if(day===16&&new Date(Date.UTC(year,month-1,15)).getUTCDay()===6)return '15';
  return '';
}

// The same nominal debit day can represent different calendar months. Always
// expose the full actual cycle date in upcoming-section headers.
/** @param {DetailRow} row @param {(date:string)=>string} formatDate */
export function creditUpcomingCycleHeadingData(row,formatDate){
  const date=creditDetailCycleDisplayDate(row),nominal=creditDetailNominalChargeDay(row);
  if(!date)return 'מועד חיוב לא ידוע';
  return nominal?`חיוב ${nominal} בחודש · מועד ${formatDate(date)}`:`חיוב במועד ${formatDate(date)}`;
}

/** @param {DetailRow} row */
export function creditDetailChargeCycleKey(row){
  const date=creditDetailCycleDisplayDate(row),nominal=creditDetailNominalChargeDay(row);
  return date&&nominal?`${date.slice(0,7)}:${nominal}`:date;
}

/** @param {DetailRow} row @param {string} day */
export function creditDetailDayMatch(row,day){return day!=='10'&&day!=='15'||creditDetailChargeDay(row)===day}

/** @param {DetailRow} row @param {string} day */
export function creditDetailMonthDayMatch(row,day){
  return (row?.status!=='pending'&&row?.foreignCurrency===true)||creditDetailDayMatch(row,day);
}

/** @template {DetailRow} R @param {R[]} [items] @returns {{foreign:R[],uncertain:R[],regular:R[],ordered:R[]}} */
export function creditDetailMonthlySections(items=[]){
  const foreign=[],uncertain=[],regular=[];
  for(const row of Array.isArray(items)?items:[]){
    if(row?.detailCycleUncertain===true)uncertain.push(row);
    else if(row?.foreignCurrency===true)foreign.push(row);
    else regular.push(row);
  }
  return {foreign,uncertain,regular,ordered:[...foreign,...uncertain,...regular]};
}

/** @param {DetailRow} row */
function creditDetailCycleOwnerKey(row){
  if(row?.creditAccountKey)return String(row.creditAccountKey);
  if(row?.profileId&&row?.accountNumber)return `sync:${String(row.profileId)}:${String(row.accountNumber)}`;
  if(row?.source==='manual'||row?.card)return `manual:${String(row?.card||'')}:${String(row?.account||'')}:${String(row?.ownerLabel||'')}`;
  return '';
}

/** @param {DetailRow} row */
function creditDetailUpcomingCycleKey(row){
  const owner=creditDetailCycleOwnerKey(row),date=creditDetailCycleDisplayDate(row);
  return owner&&date?`${owner}\u0000${date}`:'';
}

/** @template {DetailMonth} M @param {M[]} [months] @param {DetailRow[]} [upcomingItems] @param {string} [selectedKey] @returns {M[]} */
export function creditDetailFutureMonths(months=[],upcomingItems=[],selectedKey=''){
  const upcomingCycles=new Set((Array.isArray(upcomingItems)?upcomingItems:[]).map(creditDetailUpcomingCycleKey).filter(Boolean));
  return (Array.isArray(months)?months:[]).filter(month=>{
    if(!month||month.key==='unassigned'||month.key===selectedKey||!Array.isArray(month.items)||!month.items.length)return true;
    // A calendar month is redundant only when every visible card-cycle in it is
    // already represented by the per-card nearest-charge view.  If the month
    // contains even one later cycle, keep it in "future charges" so the user
    // can still reach data that is not present in the nearest-charge view.
    return month.items.some(row=>{const key=creditDetailUpcomingCycleKey(row);return !key||!upcomingCycles.has(key)});
  });
}

/** @param {DetailRow[]} [items] */
export function creditDetailSelectionTotal(items=[]){
  let total=0,excluded=0;
  for(const item of items){
    const amount=Number(item?.amount),included=item?.includedInIlsTotal===true;
    if(included&&Number.isFinite(amount))total+=amount;
    else excluded++;
    if(item?.coverageIncomplete===true&&included)excluded++;
  }
  return {total:Math.round(total*100)/100,partial:excluded>0,excluded};
}

