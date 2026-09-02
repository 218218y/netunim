function validMonthKey(value){return /^\d{4}-\d{2}$/.test(String(value||''))}

function dueMonthKey(value){return String(value||'').slice(0,7)}

function monthKeysBetween(startKey,endKey){
  const out=[];
  let year=Number(startKey.slice(0,4)),month=Number(startKey.slice(5,7));
  const endYear=Number(endKey.slice(0,4)),endMonth=Number(endKey.slice(5,7));
  while(year<endYear||(year===endYear&&month<=endMonth)){
    out.push(`${year}-${String(month).padStart(2,'0')}`);
    month+=1;
    if(month>12){month=1;year+=1}
  }
  return out;
}

export function futureCheckMonthsData(state,{fromMonth,year='all'}={}){
  const startKey=String(fromMonth||'');
  if(!validMonthKey(startKey))return [];
  const currentYear=Number(startKey.slice(0,4)),selectedYear=year==='all'?null:Number(year);
  if(year!=='all'&&(!/^\d{4}$/.test(String(year))||!Number.isFinite(selectedYear)||selectedYear<currentYear))return [];
  const rangeStart=year==='all'||selectedYear===currentYear?startKey:`${selectedYear}-01`;
  const futureRows=(Array.isArray(state?.checks)?state.checks:[]).filter(row=>{
    if(row?.status!=='בקופה')return false;
    const key=dueMonthKey(row?.dueDate);
    if(!validMonthKey(key)||key<rangeStart)return false;
    return year==='all'||key.startsWith(`${selectedYear}-`);
  });
  if(!futureRows.length)return [];
  const totals=new Map();
  let lastKey=rangeStart;
  for(const row of futureRows){
    const key=dueMonthKey(row.dueDate);
    const amount=Number(row.amount);
    totals.set(key,(totals.get(key)||0)+(Number.isFinite(amount)?amount:0));
    if(key>lastKey)lastKey=key;
  }
  return monthKeysBetween(rangeStart,lastKey).map(key=>({key,total:totals.get(key)||0}));
}
