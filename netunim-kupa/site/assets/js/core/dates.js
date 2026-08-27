import {HEB_MONTHS, dateFmt, todayISO, localISO, dObj, daysFromToday, monthKey, monthLabel, checkDateParts} from '../shared/calendar.js';
export {HEB_MONTHS, dateFmt, todayISO, localISO, dObj, daysFromToday, monthKey, monthLabel, checkDateParts};


















export function addMonthsISO(dateStr,n){const d=dObj(dateStr);const day=d.getDate();const x=new Date(d.getFullYear(),d.getMonth()+n,1);const last=new Date(x.getFullYear(),x.getMonth()+1,0).getDate();x.setDate(Math.min(day,last));return localISO(x)}

export function monthKeysBetween(startISO,endISO){const a=dObj(startISO),b=dObj(endISO),out=[];let y=a.getFullYear(),m=a.getMonth();while(y<b.getFullYear()||(y===b.getFullYear()&&m<=b.getMonth())){out.push(`${y}-${String(m+1).padStart(2,'0')}`);m++;if(m>11){m=0;y++}}return out}

export function formatCloudSyncTime(value){const d=value?new Date(value):null;if(!d||Number.isNaN(d.getTime()))return '—';return `${d.getDate()}.${d.getMonth()+1} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`}

export function latestCloudUpdatedAt(...values){let latest=null;for(const value of values){if(!value)continue;const d=new Date(value);if(Number.isNaN(d.getTime()))continue;if(!latest||d>latest)latest=d}return latest?latest.toISOString():null}
