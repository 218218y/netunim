import {nextSeriesCheckNumber} from '../../shared/check-series.js';
export {nextSeriesCheckNumber};
import {checkDaysFromToday, checkAddMonthsISO} from '../../core/dates.js';
import {kupaWholeMoney} from '../../core/money.js';

export function normalizeSharedBankEvents(events){return (Array.isArray(events)?events:[]).map(e=>{const seq=Number(e?.seq),delta=Math.round(Number(e?.delta||0));return{seq:Number.isSafeInteger(seq)&&seq>0?seq:null,at:e?.at||null,delta,kind:String(e?.kind||'check_effect_delta'),checkId:String(e?.checkId||'')}}).filter(e=>e.seq&&e.checkId)}

export function normalizeSharedChecks(list){return (Array.isArray(list)?list:[]).filter(x=>x&&x.id).map(x=>{const seq=Number(x.depositSeq);return {...x,id:String(x.id),amount:Math.round(Number(x.amount||0)),name:String(x.name||''),dueDate:String(x.dueDate||''),status:String(x.status||'בקופה'),depositDate:x.depositDate||null,depositedAt:x.depositedAt||null,depositSeq:Number.isSafeInteger(seq)&&seq>0?seq:null,clearedDate:x.clearedDate||null,checkNumber:String(x.checkNumber||''),note:String(x.note||''),createdAt:x.createdAt||''}})}

export function checkUrgency(c){if(c.status!=='בקופה')return '';const d=checkDaysFromToday(c.dueDate);if(d<0)return 'overdue';if(d<=7)return 'week';if(d<=30)return 'month';return ''}



export function generatedCheckSeriesRow(first,i){return {date:first.date?checkAddMonthsISO(first.date,i):'',amount:first.amount,number:nextSeriesCheckNumber(first.number,i),manualDate:false,manualAmount:false,manualNumber:false}}

export function checkBankEffectAmount(c){return c&&['הופקד - במעקב','נפרע'].includes(c.status)?kupaWholeMoney(c.amount):0}
