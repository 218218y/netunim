import {esc} from '../../core/values.js';
import {checkTodayISO} from '../../core/dates.js';
import {normalizeNoteReminderDate} from './alerts.js';

const HEBREW_WEEKDAYS=['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','שבת'];
const monthFormatter=new Intl.DateTimeFormat('he-IL',{month:'long',year:'numeric'});

function pad(value){return String(value).padStart(2,'0')}
function localIso(date){return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`}
function parseMonthKey(value){const match=/^(\d{4})-(\d{2})$/.exec(String(value||''));if(!match)return null;const year=Number(match[1]),month=Number(match[2]);if(month<1||month>12)return null;return new Date(year,month-1,1)}

export function noteReminderMonthKey(value,fallback=checkTodayISO()){
  const raw=String(value||'').trim();if(parseMonthKey(raw))return raw;
  const date=normalizeNoteReminderDate(raw)||normalizeNoteReminderDate(fallback)||checkTodayISO();
  return date.slice(0,7);
}

export function shiftNoteReminderMonth(monthKey,delta){
  const base=parseMonthKey(monthKey)||parseMonthKey(noteReminderMonthKey(''));
  const shifted=new Date(base.getFullYear(),base.getMonth()+Number(delta||0),1);
  return `${shifted.getFullYear()}-${pad(shifted.getMonth()+1)}`;
}

export function noteReminderCalendarDays(monthKey,{today=checkTodayISO(),minDate=today}={}){
  const month=parseMonthKey(monthKey)||parseMonthKey(noteReminderMonthKey(today,today));
  const first=new Date(month.getFullYear(),month.getMonth(),1),gridStart=new Date(first);
  gridStart.setDate(gridStart.getDate()-gridStart.getDay());
  const min=normalizeNoteReminderDate(minDate)||normalizeNoteReminderDate(today)||checkTodayISO();
  return Array.from({length:42},(_,index)=>{
    const date=new Date(gridStart);date.setDate(gridStart.getDate()+index);
    const iso=localIso(date);
    return {iso,day:date.getDate(),outside:date.getMonth()!==month.getMonth(),today:iso===(normalizeNoteReminderDate(today)||checkTodayISO()),disabled:iso<min};
  });
}

export function noteReminderCalendarMarkup({monthKey='',selectedDate='',today=checkTodayISO(),minDate=today}={}){
  const month=noteReminderMonthKey(monthKey,today),monthDate=parseMonthKey(month),selected=normalizeNoteReminderDate(selectedDate),minimum=normalizeNoteReminderDate(minDate)||normalizeNoteReminderDate(today)||checkTodayISO();
  const previous=shiftNoteReminderMonth(month,-1),previousDisabled=previous<minimum.slice(0,7);
  const days=noteReminderCalendarDays(month,{today,minDate:minimum});
  return `<section class="note-reminder-calendar" data-note-reminder-month="${esc(month)}"><header class="note-reminder-calendar-head"><button class="note-reminder-calendar-nav" type="button" data-action="note-reminder-prev-month" aria-label="החודש הקודם" ${previousDisabled?'disabled':''}>‹</button><strong>${esc(monthFormatter.format(monthDate))}</strong><button class="note-reminder-calendar-nav" type="button" data-action="note-reminder-next-month" aria-label="החודש הבא">›</button></header><div class="note-reminder-calendar-weekdays">${HEBREW_WEEKDAYS.map(day=>`<span>${esc(day)}</span>`).join('')}</div><div class="note-reminder-calendar-grid">${days.map(day=>`<button type="button" class="note-reminder-calendar-day${day.outside?' outside':''}${day.today?' today':''}${day.iso===selected?' selected':''}" data-action="note-reminder-select-day" data-click-arg0="${esc(day.iso)}" ${day.disabled?'disabled':''} aria-label="${esc(day.iso)}" aria-pressed="${day.iso===selected?'true':'false'}">${day.day}</button>`).join('')}</div></section>`;
}
