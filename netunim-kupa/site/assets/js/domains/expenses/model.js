import {todayISO, localISO, dObj, monthKey, monthKeysBetween} from '../../core/dates.js';
import {num} from '../../core/money.js';

export function expenseOccurrencesForMonthData(state,key,pendingOnly=false){const [yy,mm]=key.split('-').map(Number),end=new Date(yy,mm,0);return state.expenses.filter(x=>x.active).flatMap(x=>{let due;if(x.recurring!==false){const base=dObj(x.date||`${key}-01`);const day=Math.max(1,Math.min(base.getDate()||1,end.getDate()));due=localISO(new Date(yy,mm-1,day))}else{if(monthKey(x.date)!==key)return[];due=x.date}if(pendingOnly&&due<todayISO())return[];return [{...x,dueDate:due}]})}

export function monthSumExpensesData(state,key,pendingOnly=false){return expenseOccurrencesForMonthData(state,key,pendingOnly).reduce((a,x)=>a+num(x.amount),0)}

export function expenseRowsBetweenData(state,start,end){if(!start||!end)return[];return monthKeysBetween(start,end).flatMap(k=>expenseOccurrencesForMonthData(state,k,false)).filter(x=>x.dueDate>=start&&x.dueDate<=end)}
