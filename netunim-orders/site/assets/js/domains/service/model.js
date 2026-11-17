import {checkTodayISO, checkDateFmt} from '../../core/dates.js';

// Lifecycle and attention are separate: sending a message never closes a call.
export function serviceStatus(c){return c.closed?{key:'closed',text:'סגורה',cls:'green'}:{key:'open',text:'בטיפול',cls:'yellow'}}
export function serviceFollowUpDate(c){
  const date=String(c.nextFollowUp||'');
  if(c.closed||!/^\d{4}-\d{2}-\d{2}$/.test(date))return '';
  const parsed=new Date(date+'T12:00:00Z');
  return !Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===date?date:'';
}
export function serviceDateLabel(value){
  const text=String(value??'').trim(),date=serviceFollowUpDate({nextFollowUp:text.slice(0,10)});
  return date?checkDateFmt(date):text||'ללא תאריך';
}
export function serviceFollowUp(c,today=checkTodayISO()){
  const date=serviceFollowUpDate(c);if(!date)return null;
  return {date,due:date<=today,overdue:date<today,text:date===today?'מעקב היום':`${date<today?'מעקב באיחור':'מעקב'} · ${checkDateFmt(date)}`};
}
export function compareServiceCalls(a,b){
  if(!!a.closed!==!!b.closed)return a.closed?1:-1;
  if(a.closed&&b.closed)return String(b.closedAt||b.openedAt||'').localeCompare(String(a.closedAt||a.openedAt||''));
  return Number(!!b.escalated)-Number(!!a.escalated)||String(serviceFollowUpDate(a)||'9999').localeCompare(String(serviceFollowUpDate(b)||'9999'))||String(a.openedAt||'').localeCompare(String(b.openedAt||''))||String(a.id).localeCompare(String(b.id));
}
export function serviceEmailValue(value){const text=String(value??'').trim();return text||'—'}
