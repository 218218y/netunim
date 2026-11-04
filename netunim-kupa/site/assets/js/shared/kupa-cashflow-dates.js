/** @typedef {import('./kupa-cashflow-contracts.js').CashflowCalculation} Calculation */
import {creditBillingISODate} from './credit-billing-cycles.js';
import {evidenceDate,observationTimeMs} from './observation-time.js';

/** @type {Calculation['pad2']} */
export function pad2(value){return String(value).padStart(2,'0')}
/** @type {Calculation['isoDay']} */
export function isoDay(value){return creditBillingISODate(value)}
/** @type {Calculation['monthKey']} */
export function monthKey(value){const day=isoDay(value);return day?day.slice(0,7):''}
/** @type {Calculation['daysInMonth']} */
export function daysInMonth(year,month){return new Date(Date.UTC(year,month,0)).getUTCDate()}
export function localTodayISO(){const d=new Date();return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`}
// Retained observations may use the historical date-only format. Validate these
// clocks against today, never against a requested future billing/forecast date.
/** @type {Calculation['bankObservationDay']} */
export function bankObservationDay(value){
  if(evidenceDate(value))return value<=localTodayISO()?value:'';
  return observationTimeMs(value)===null?'':isoDay(value);
}
/** @type {Calculation['addMonthsISO']} */
export function addMonthsISO(value,delta){const raw=isoDay(value);if(!raw)return '';const year=Number(raw.slice(0,4)),month=Number(raw.slice(5,7)),day=Number(raw.slice(8,10)),index=year*12+(month-1)+Number(delta||0),targetYear=Math.floor(index/12),targetMonth=index-targetYear*12+1,targetDay=Math.min(day,daysInMonth(targetYear,targetMonth));return `${targetYear}-${pad2(targetMonth)}-${pad2(targetDay)}`}
/** @type {Calculation['addDaysISO']} */
export function addDaysISO(value,delta){const raw=isoDay(value);if(!raw)return '';const year=Number(raw.slice(0,4)),month=Number(raw.slice(5,7)),day=Number(raw.slice(8,10)),date=new Date(Date.UTC(year,month-1,day+Number(delta||0)));return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth()+1)}-${pad2(date.getUTCDate())}`}
/** @type {Calculation['monthCutoffISO']} */
export function monthCutoffISO(key,day){const match=/^(\d{4})-(\d{2})$/.exec(String(key||''));if(!match)return '';const year=Number(match[1]),month=Number(match[2]);if(month<1||month>12)return '';const bounded=Math.max(1,Math.min(Math.trunc(Number(day)||1),daysInMonth(year,month)));return `${year}-${pad2(month)}-${pad2(bounded)}`}
/** @type {Calculation['monthKeysBetween']} */
export function monthKeysBetween(start,end){const a=monthKey(start),b=monthKey(end);if(!a||!b||a>b)return[];let year=Number(a.slice(0,4)),month=Number(a.slice(5,7));const lastYear=Number(b.slice(0,4)),lastMonth=Number(b.slice(5,7)),rows=[];while(year<lastYear||(year===lastYear&&month<=lastMonth)){rows.push(`${year}-${pad2(month)}`);month++;if(month>12){month=1;year++}}return rows}
