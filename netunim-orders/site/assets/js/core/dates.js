import {HEB_MONTHS as CHECK_MONTHS, dateFmt as checkDateFmt, todayISO as checkTodayISO, localISO as checkLocalISO, dObj as checkDateObj, daysFromToday as checkDaysFromToday, monthKey as checkMonthKey, monthLabel as checkMonthLabel, checkDateParts} from '../shared/calendar.js';
export {CHECK_MONTHS, checkDateFmt, checkTodayISO, checkLocalISO, checkDateObj, checkDaysFromToday, checkMonthKey, checkMonthLabel, checkDateParts};


















export function checkAddMonthsISO(dateStr,n){const d=checkDateObj(dateStr);if(!d)return '';const day=d.getDate(),x=new Date(d.getFullYear(),d.getMonth()+n,1),last=new Date(x.getFullYear(),x.getMonth()+1,0).getDate();x.setDate(Math.min(day,last));return checkLocalISO(x)}



export function stamp(){return new Date().toISOString().replace(/[:.]/g,'-').slice(0,19)}
