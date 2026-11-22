import {esc} from '../core/values.js';
import {$} from '../state/constants.js';
import {checkTodayISO} from '../core/dates.js';
import {normalizeNoteReminderDate} from '../contracts/note-reminder-date.js';

const HEBREW_WEEKDAYS=['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','שבת'];
const monthFormatter=new Intl.DateTimeFormat('he-IL',{month:'long',year:'numeric'});

function pad(value){return String(value).padStart(2,'0')}
function localIso(date){return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`}
function parseMonthKey(value){const match=/^(\d{4})-(\d{2})$/.exec(String(value||''));if(!match)return null;const year=Number(match[1]),month=Number(match[2]);if(month<1||month>12)return null;return new Date(year,month-1,1)}
function parseIsoDate(value){const normalized=normalizeNoteReminderDate(value);if(!normalized)return null;const [year,month,day]=normalized.split('-').map(Number);return new Date(year,month-1,day,12)}

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

export function shiftNoteReminderFocusDate(value,key,{minDate=checkTodayISO()}={}){
  const base=parseIsoDate(value);if(!base)return '';
  const offsets={ArrowLeft:1,ArrowRight:-1,ArrowUp:-7,ArrowDown:7};
  const offset=offsets[key];if(!offset)return normalizeNoteReminderDate(value);
  base.setDate(base.getDate()+offset);
  const candidate=localIso(base),minimum=normalizeNoteReminderDate(minDate)||checkTodayISO();
  return candidate<minimum?normalizeNoteReminderDate(value):candidate;
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

export function noteReminderCalendarMarkup({monthKey='',selectedDate='',focusedDate='',today=checkTodayISO(),minDate=today}={}){
  const month=noteReminderMonthKey(monthKey,today),monthDate=parseMonthKey(month),selected=normalizeNoteReminderDate(selectedDate),minimum=normalizeNoteReminderDate(minDate)||normalizeNoteReminderDate(today)||checkTodayISO();
  const previous=shiftNoteReminderMonth(month,-1),previousDisabled=previous<minimum.slice(0,7),days=noteReminderCalendarDays(month,{today,minDate:minimum});
  const requestedFocus=normalizeNoteReminderDate(focusedDate)||selected||minimum;
  const focusDate=days.some(day=>day.iso===requestedFocus&&!day.disabled)?requestedFocus:(days.find(day=>!day.disabled&&!day.outside)||days.find(day=>!day.disabled))?.iso||'';
  const dayButtons=days.map(day=>`<button type="button" role="gridcell"
    class="note-reminder-calendar-day${day.outside?' outside':''}${day.today?' today':''}${day.iso===selected?' selected':''}"
    data-action="note-reminder-select-day" data-keydown="note-reminder-calendar-keydown"
    data-click-arg0="${esc(day.iso)}" data-note-reminder-date="${esc(day.iso)}" tabindex="${day.iso===focusDate?'0':'-1'}"
    ${day.disabled?'disabled':''} aria-label="${esc(day.iso)}" ${day.today?'aria-current="date" ':''}aria-selected="${day.iso===selected?'true':'false'}">${day.day}</button>`).join('');
  return `<section class="note-reminder-calendar" data-note-reminder-month="${esc(month)}" aria-label="בחירת תאריך התראה">
    <header class="note-reminder-calendar-head">
      <button class="note-reminder-calendar-nav" type="button" data-action="note-reminder-prev-month" aria-label="החודש הקודם" ${previousDisabled?'disabled':''}>‹</button>
      <strong>${esc(monthFormatter.format(monthDate))}</strong>
      <button class="note-reminder-calendar-nav" type="button" data-action="note-reminder-next-month" aria-label="החודש הבא">›</button>
    </header>
    <div class="note-reminder-calendar-weekdays" aria-hidden="true">${HEBREW_WEEKDAYS.map(day=>`<span>${esc(day)}</span>`).join('')}</div>
    <div class="note-reminder-calendar-grid" role="grid" aria-label="ימים בחודש">${dayButtons}</div>
  </section>`;
}

export function createReminderPicker({dateEditorMarkup,setDateValue,toast}){
  function markup({date='',intro=''}={}){
    const today=checkTodayISO();
    const selected=normalizeNoteReminderDate(date);
    const initial=selected>=today?selected:today;
    const label='תאריך תחילת ההתראה';
    const calendar=noteReminderCalendarMarkup({selectedDate:initial,monthKey:noteReminderMonthKey(initial),today});
    const editor=dateEditorMarkup('noteReminderDate',initial,{label,picker:false,change:'note-reminder-date-change',minDate:today});
    return `<div class="note-reminder-dialog">${intro}<div id="noteReminderCalendar">${calendar}</div><div class="field note-reminder-date-field"><label>${label}</label>${editor}<small>בחר יום בלוח או הקלד תאריך. ההתראה תופיע במרכז האזהרות מהתאריך שנבחר.</small></div></div>`;
  }

  function focus(){
    const host=$('#noteReminderCalendar');
    if(host)requestAnimationFrame(()=>host.querySelector('[data-note-reminder-date][tabindex="0"]')?.focus());
  }

  function renderCalendar({monthKey,focusedDate,restoreFocus=false}={}){
    const host=$('#noteReminderCalendar');
    if(!host)return false;
    const today=checkTodayISO(),selectedDate=normalizeNoteReminderDate($('#noteReminderDate')?.value);
    host.innerHTML=noteReminderCalendarMarkup({monthKey:monthKey||noteReminderMonthKey(selectedDate,today),selectedDate,focusedDate,today});
    if(restoreFocus)focus();
    return true;
  }

  function changeMonth(delta){
    const current=$('#noteReminderCalendar [data-note-reminder-month]')?.dataset.noteReminderMonth;
    if(!current)return false;
    const today=checkTodayISO(),next=shiftNoteReminderMonth(current,delta);
    if(next<today.slice(0,7))return false;
    return renderCalendar({monthKey:next,restoreFocus:true});
  }

  function selectDate(value){
    const input=$('#noteReminderDate'),date=normalizeNoteReminderDate(value);
    if(!input||!date||date<checkTodayISO())return false;
    setDateValue(input,date);
    return renderCalendar({focusedDate:date,restoreFocus:true});
  }

  function handleCalendarKey(event,element){
    const current=normalizeNoteReminderDate(element.dataset.noteReminderDate);
    if(!current)return false;
    if(event.key==='Enter'||event.key===' '){event.preventDefault();return selectDate(current)}
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return false;
    event.preventDefault();
    return selectDate(shiftNoteReminderFocusDate(current,event.key));
  }

  function readDate(){
    const date=normalizeNoteReminderDate($('#noteReminderDate')?.value);
    if(!date){toast('בחר תאריך תקין להתראה');return ''}
    if(date<checkTodayISO()){toast('אפשר לבחור התראה מהיום ואילך');return ''}
    return date;
  }

  return {markup,focus,readDate,changeMonth,selectDate,handleCalendarKey,renderCalendar};
}
