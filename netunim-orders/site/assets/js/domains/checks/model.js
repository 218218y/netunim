import {nextSeriesCheckNumber} from '../../shared/check-series.js';
import {checkDaysFromToday, checkAddMonthsISO} from '../../core/dates.js';

export {normalizeSharedBankEvents,checkAccountData,checkBelongsToAccountData,checkIsClosedStatus,normalizeSharedChecks} from '../../shared/shared-checks-contract.js';
export {nextSeriesCheckNumber};
export {futureCheckMonthsData} from '../../shared/check-forecast.js';

export function checkUrgency(c){if(c.status!=='בקופה')return '';const d=checkDaysFromToday(c.dueDate);if(d<0)return 'overdue';if(d<=7)return 'week';if(d<=30)return 'month';return ''}



export function generatedCheckSeriesRow(first,i){return {date:first.date?checkAddMonthsISO(first.date,i):'',amount:first.amount,number:nextSeriesCheckNumber(first.number,i),manualDate:false,manualAmount:false,manualNumber:false}}
