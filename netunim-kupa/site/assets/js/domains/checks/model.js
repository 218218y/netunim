import {nextSeriesCheckNumber} from '../../shared/check-series.js';
export {nextSeriesCheckNumber};
import {wholeMoney, num} from '../../core/money.js';
import {daysFromToday, addMonthsISO, monthKey, monthKeysBetween} from '../../core/dates.js';

export function normalizeSharedBankEvents(events){return (Array.isArray(events)?events:[]).map(e=>{const seq=Number(e?.seq),delta=wholeMoney(e?.delta);return{seq:Number.isSafeInteger(seq)&&seq>0?seq:null,at:e?.at||null,delta,kind:String(e?.kind||'check_effect_delta'),checkId:String(e?.checkId||'')}}).filter(e=>e.seq&&e.checkId)}

export function normalizeSharedChecks(checks){return (Array.isArray(checks)?checks:[]).filter(x=>x&&x.id).map(x=>{const seq=Number(x.depositSeq);return {...x,id:String(x.id),name:String(x.name||''),amount:wholeMoney(x.amount),dueDate:String(x.dueDate||''),status:String(x.status||'בקופה'),depositDate:x.depositDate||null,depositedAt:x.depositedAt||null,depositSeq:Number.isSafeInteger(seq)&&seq>0?seq:null,clearedDate:x.clearedDate||null,checkNumber:String(x.checkNumber||''),note:String(x.note||''),createdAt:x.createdAt||''}})}

export function checkUrgency(c){if(c.status!=='בקופה')return '';const d=daysFromToday(c.dueDate);if(d<0)return 'overdue';if(d<=7)return 'week';if(d<=30)return 'month';return ''}



export function generatedCheckSeriesRow(first,i){return {date:first.date?addMonthsISO(first.date,i):'',amount:first.amount,number:nextSeriesCheckNumber(first.number,i),manualDate:false,manualAmount:false,manualNumber:false}}

export function activeChecksData(state){return state.checks.filter(x=>x.status==='בקופה')}

export function depositedChecksData(state){return state.checks.filter(x=>x.status==='הופקד - במעקב')}

export function checksBalanceData(state){return activeChecksData(state).reduce((a,x)=>a+num(x.amount),0)}

export function depositedBalanceData(state){return depositedChecksData(state).reduce((a,x)=>a+num(x.amount),0)}


export function futureCheckMonthsData(state,{fromMonth,year='all'}={}){
  const startKey=String(fromMonth||'');
  if(!/^\d{4}-\d{2}$/.test(startKey))return [];
  const currentYear=Number(startKey.slice(0,4)),selectedYear=year==='all'?null:Number(year);
  if(year!=='all'&&(!/^\d{4}$/.test(String(year))||!Number.isFinite(selectedYear)||selectedYear<currentYear))return [];
  const rangeStart=year==='all'||selectedYear===currentYear?startKey:`${selectedYear}-01`;
  const futureRows=(Array.isArray(state?.checks)?state.checks:[]).filter(row=>{
    if(row?.status!=='בקופה')return false;
    const key=monthKey(row?.dueDate);
    if(!/^\d{4}-\d{2}$/.test(key)||key<rangeStart)return false;
    return year==='all'||key.startsWith(`${selectedYear}-`);
  });
  if(!futureRows.length)return [];
  const lastKey=futureRows.reduce((last,row)=>{const key=monthKey(row.dueDate);return key>last?key:last},rangeStart);
  const totals=new Map();
  for(const row of futureRows){const key=monthKey(row.dueDate);totals.set(key,(totals.get(key)||0)+num(row.amount))}
  return monthKeysBetween(`${rangeStart}-01`,`${lastKey}-01`).map(key=>({key,total:totals.get(key)||0}));
}
