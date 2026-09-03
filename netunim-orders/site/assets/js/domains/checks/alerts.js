import {checkTodayISO} from '../../core/dates.js';

const ISO_DAY=/^\d{4}-\d{2}-\d{2}$/;

export function dueCheckWarningItems(checks,today=checkTodayISO()){
  const day=String(today||'');
  if(!ISO_DAY.test(day))return [];
  return (Array.isArray(checks)?checks:[])
    .filter(check=>check&&check.status==='בקופה'&&ISO_DAY.test(String(check.dueDate||''))&&check.dueDate<=day)
    .sort((a,b)=>String(a.dueDate).localeCompare(String(b.dueDate))||String(a.name||'').localeCompare(String(b.name||''),'he'))
    .map(check=>({
      id:`check:${String(check.id||'')}`,
      kind:'check_due',
      checkId:String(check.id||''),
      name:String(check.name||''),
      amount:Number(check.amount)||0,
      dueDate:String(check.dueDate||''),
      checkNumber:String(check.checkNumber||''),
      note:String(check.note||''),
      isToday:String(check.dueDate||'')===day,
    }));
}
