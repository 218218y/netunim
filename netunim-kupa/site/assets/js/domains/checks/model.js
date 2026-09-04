import {nextSeriesCheckNumber} from '../../shared/check-series.js';
export {nextSeriesCheckNumber};
import {wholeMoney, num} from '../../core/money.js';
import {daysFromToday, addMonthsISO} from '../../core/dates.js';
export {futureCheckMonthsData} from '../../shared/check-forecast.js';

export function normalizeSharedBankEvents(events){return (Array.isArray(events)?events:[]).map(e=>{const seq=Number(e?.seq),delta=wholeMoney(e?.delta);return{seq:Number.isSafeInteger(seq)&&seq>0?seq:null,at:e?.at||null,delta,kind:String(e?.kind||'check_effect_delta'),checkId:String(e?.checkId||'')}}).filter(e=>e.seq&&e.checkId)}

export function checkAccountData(check){return check?.account==='ביתי'?'ביתי':'עסקי'}

export function checkBelongsToAccountData(check,account='עסקי'){return checkAccountData(check)===(account==='ביתי'?'ביתי':'עסקי')}

export function normalizeSharedChecks(checks){return (Array.isArray(checks)?checks:[]).filter(x=>x&&x.id).map(x=>{const seq=Number(x.depositSeq);return {...x,id:String(x.id),name:String(x.name||''),account:checkAccountData(x),amount:wholeMoney(x.amount),dueDate:String(x.dueDate||''),status:String(x.status||'בקופה'),depositDate:x.depositDate||null,depositedAt:x.depositedAt||null,depositSeq:Number.isSafeInteger(seq)&&seq>0?seq:null,clearedDate:x.clearedDate||null,checkNumber:String(x.checkNumber||''),note:String(x.note||''),createdAt:x.createdAt||''}})}

export function checkUrgency(c){if(c.status!=='בקופה')return '';const d=daysFromToday(c.dueDate);if(d<0)return 'overdue';if(d<=7)return 'week';if(d<=30)return 'month';return ''}



export function generatedCheckSeriesRow(first,i){return {date:first.date?addMonthsISO(first.date,i):'',amount:first.amount,number:nextSeriesCheckNumber(first.number,i),manualDate:false,manualAmount:false,manualNumber:false}}

export function activeChecksData(state,account='עסקי'){return state.checks.filter(x=>x.status==='בקופה'&&checkBelongsToAccountData(x,account))}

export function depositedChecksData(state,account='עסקי'){return state.checks.filter(x=>x.status==='הופקד - במעקב'&&checkBelongsToAccountData(x,account))}

export function checksBalanceData(state,account='עסקי'){return activeChecksData(state,account).reduce((a,x)=>a+num(x.amount),0)}

export function depositedBalanceData(state,account='עסקי'){return depositedChecksData(state,account).reduce((a,x)=>a+num(x.amount),0)}
