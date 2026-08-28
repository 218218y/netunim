export const CALENDAR_VIEW_MODES=Object.freeze(['month','week','day']);

function pad(value){return String(value).padStart(2,'0')}

export function localDateKey(date){return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`}

export function parseDateKey(value){
  const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value||''));
  if(!match)return null;
  const year=Number(match[1]),month=Number(match[2])-1,day=Number(match[3]);
  const date=new Date(year,month,day);
  if(date.getFullYear()!==year||date.getMonth()!==month||date.getDate()!==day)return null;
  return date;
}

export function normalizeViewMode(value){return CALENDAR_VIEW_MODES.includes(String(value||''))?String(value):'month'}

export function normalizeFocusDate(value,now=new Date()){
  const parsed=parseDateKey(value);
  return parsed?localDateKey(parsed):localDateKey(now);
}

export function addDaysKey(value,days){
  const date=parseDateKey(value)||new Date();
  date.setDate(date.getDate()+Number(days||0));
  return localDateKey(date);
}

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

export function calendarRangeFor(value,mode){
  const focusDate=normalizeFocusDate(value),focus=parseDateKey(focusDate),normalized=normalizeViewMode(mode);
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
