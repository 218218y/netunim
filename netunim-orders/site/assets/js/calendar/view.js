// @ts-check
export const CALENDAR_VIEW_MODES=Object.freeze(['month','week','day']);

/** @param {number} value */
function pad(value){return String(value).padStart(2,'0')}

/** @param {Date} date */
export function localDateKey(date){return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`}

/** @param {unknown} value */
export function parseDateKey(value){
  const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value||''));
  if(!match)return null;
  const year=Number(match[1]),month=Number(match[2])-1,day=Number(match[3]);
  const date=new Date(year,month,day);
  if(date.getFullYear()!==year||date.getMonth()!==month||date.getDate()!==day)return null;
  return date;
}

/** @param {unknown} value */
export function normalizeViewMode(value){return CALENDAR_VIEW_MODES.includes(String(value||''))?String(value):'week'}

/** @param {string} startDate @param {string} endDate @param {{endWasManual?:boolean,source?:string}} [options] */
export function reconcileCalendarEndDate(startDate,endDate,{endWasManual=false,source='start'}={}){
  const start=parseDateKey(startDate),end=parseDateKey(endDate);
  if(!start)return{endDate:String(endDate||''),endManual:!!endWasManual};
  const startKey=localDateKey(start);
  if(source==='end'){
    if(!end||localDateKey(end)<startKey)return{endDate:startKey,endManual:false};
    const endKey=localDateKey(end);
    return{endDate:endKey,endManual:endKey>startKey};
  }
  if(!endWasManual||!end||localDateKey(end)<startKey)return{endDate:startKey,endManual:false};
  return{endDate:localDateKey(end),endManual:true};
}

/** @param {unknown} value @param {Date} [now] */
export function normalizeFocusDate(value,now=new Date()){
  const parsed=parseDateKey(value);
  return parsed?localDateKey(parsed):localDateKey(now);
}

/** @param {unknown} value @param {number} days */
export function addDaysKey(value,days){
  const date=parseDateKey(value)||new Date();
  date.setDate(date.getDate()+Number(days||0));
  return localDateKey(date);
}

/** @param {unknown} value @param {unknown} mode @param {number} delta */
export function moveFocusDate(value,mode,delta){
  const date=parseDateKey(normalizeFocusDate(value))||new Date(),step=Number(delta||0),normalized=normalizeViewMode(mode);
  if(normalized==='month'){
    const wantedDay=date.getDate();
    date.setDate(1);
    date.setMonth(date.getMonth()+step);
    const lastDay=new Date(date.getFullYear(),date.getMonth()+1,0).getDate();
    date.setDate(Math.min(wantedDay,lastDay));
  }else date.setDate(date.getDate()+step*(normalized==='week'?7:1));
  return localDateKey(date);
}

/** @param {unknown} value @param {unknown} mode */
export function calendarRangeFor(value,mode){
  const focusDate=normalizeFocusDate(value),focus=/** @type {Date} */(parseDateKey(focusDate)),normalized=normalizeViewMode(mode);
  let start,days,month;
  if(normalized==='month'){
    month=new Date(focus.getFullYear(),focus.getMonth(),1);
    start=new Date(month);
    start.setDate(start.getDate()-start.getDay());
    days=42;
  }else if(normalized==='week'){
    start=new Date(focus);
    start.setDate(start.getDate()-start.getDay());
    days=7;
    month=new Date(focus.getFullYear(),focus.getMonth(),1);
  }else{
    start=new Date(focus);
    days=1;
    month=new Date(focus.getFullYear(),focus.getMonth(),1);
  }
  const end=new Date(start);end.setDate(end.getDate()+days);
  const startKey=localDateKey(start),endKey=localDateKey(end);
  return{
    mode:normalized,
    focusDate,
    month,
    gridStart:start,
    gridEnd:end,
    days,
    startKey,
    endKey,
    key:`${startKey}__${endKey}`,
    timeMin:start.toISOString(),
    timeMax:end.toISOString(),
  };
}

/** @typedef {{startKey?:string,endKey?:string,rangeStart?:string,rangeEnd?:string}} RangeKeys */
/** @param {RangeKeys|null|undefined} range */
function rangeStartKey(range){return String(range?.startKey||range?.rangeStart||'')}
/** @param {RangeKeys|null|undefined} range */
function rangeEndKey(range){return String(range?.endKey||range?.rangeEnd||'')}

/** @param {RangeKeys|null|undefined} outer @param {RangeKeys|null|undefined} inner */
export function calendarRangeContains(outer,inner){
  const outerStart=rangeStartKey(outer),outerEnd=rangeEndKey(outer),innerStart=rangeStartKey(inner),innerEnd=rangeEndKey(inner);
  return !!outerStart&&!!outerEnd&&!!innerStart&&!!innerEnd&&outerStart<=innerStart&&outerEnd>=innerEnd;
}

/** @param {unknown} value */
export function calendarPrefetchRangeFor(value){
  const focusDate=normalizeFocusDate(value),previousFocus=moveFocusDate(focusDate,'month',-1),nextFocus=moveFocusDate(focusDate,'month',1);
  const previous=calendarRangeFor(previousFocus,'month'),next=calendarRangeFor(nextFocus,'month');
  const start=/** @type {Date} */(parseDateKey(previous.startKey)),end=/** @type {Date} */(parseDateKey(next.endKey)),startKey=previous.startKey,endKey=next.endKey;
  return{
    focusDate,
    startKey,
    endKey,
    key:`${startKey}__${endKey}`,
    timeMin:start.toISOString(),
    timeMax:end.toISOString(),
  };
}
