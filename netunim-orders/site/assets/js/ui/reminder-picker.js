import {checkTodayISO} from '../core/dates.js';
import {normalizeNoteReminderDate} from '../contracts/note-reminder-date.js';
import {$} from '../state/constants.js';
import {noteReminderCalendarMarkup,noteReminderMonthKey,shiftNoteReminderFocusDate,shiftNoteReminderMonth} from './reminder-calendar.js';

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

  return {markup,focus,readDate,actions:{
    'note-reminder-prev-month':()=>changeMonth(-1),
    'note-reminder-next-month':()=>changeMonth(1),
    'note-reminder-select-day':element=>selectDate(element.dataset.clickArg0),
    'note-reminder-calendar-keydown':(element,event)=>handleCalendarKey(event,element),
    'note-reminder-date-change':()=>renderCalendar(),
  }};
}
