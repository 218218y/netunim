import {checkBelongsToAccountData} from '../../shared/shared-checks-contract.js';
import {nextSeriesCheckNumber} from '../../shared/check-series.js';
import {num} from '../../core/money.js';
import {daysFromToday, addMonthsISO} from '../../core/dates.js';

export {normalizeSharedBankEvents,checkAccountData,checkBelongsToAccountData,checkIsClosedStatus,normalizeSharedChecks} from '../../shared/shared-checks-contract.js';
export {nextSeriesCheckNumber};
export {futureCheckMonthsData} from '../../shared/check-forecast.js';

export function checkUrgency(c){if(c.status!=='בקופה')return '';const d=daysFromToday(c.dueDate);if(d<0)return 'overdue';if(d<=7)return 'week';if(d<=30)return 'month';return ''}



export function generatedCheckSeriesRow(first,i){return {date:first.date?addMonthsISO(first.date,i):'',amount:first.amount,number:nextSeriesCheckNumber(first.number,i),manualDate:false,manualAmount:false,manualNumber:false}}

export function activeChecksData(state,account='עסקי'){return state.checks.filter(x=>x.status==='בקופה'&&checkBelongsToAccountData(x,account))}

export function depositedChecksData(state,account='עסקי'){return state.checks.filter(x=>x.status==='הופקד - במעקב'&&checkBelongsToAccountData(x,account))}

export function checksBalanceData(state,account='עסקי'){return activeChecksData(state,account).reduce((a,x)=>a+num(x.amount),0)}

export function depositedBalanceData(state,account='עסקי'){return depositedChecksData(state,account).reduce((a,x)=>a+num(x.amount),0)}
