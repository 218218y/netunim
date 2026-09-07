import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeNoteReminderDate,noteReminderWarningItems} from '../netunim-orders/site/assets/js/domains/notes/alerts.js';
import {createDomainsNotesController} from '../netunim-orders/site/assets/js/domains/notes/controller.js';
import {createStateNormalization} from '../netunim-orders/site/assets/js/state/normalization.js';
import {createUiAlertCenter} from '../netunim-orders/site/assets/js/ui/alert-center.js';
import {noteReminderCalendarDays,noteReminderCalendarMarkup,noteReminderMonthKey,shiftNoteReminderFocusDate,shiftNoteReminderMonth} from '../netunim-orders/site/assets/js/domains/notes/reminder-calendar.js';
import {createUiDateEditor,shiftDateEditorIso} from '../netunim-orders/site/assets/js/ui/date-editor.js';

test('note reminder model accepts real ISO dates and activates reminders from their date onward',()=>{
  assert.equal(normalizeNoteReminderDate('2026-09-07'),'2026-09-07');
  assert.equal(normalizeNoteReminderDate('2026-02-30'),'');
  assert.equal(normalizeNoteReminderDate('07/09/2026'),'');
  const notes=[
    {id:'PAST',content:'עבר',reminderDate:'2026-09-01',createdAt:'2026-09-01T08:00:00Z'},
    {id:'TODAY',content:'היום',reminderDate:'2026-09-07',createdAt:'2026-09-02T08:00:00Z'},
    {id:'FUTURE',content:'עתיד',reminderDate:'2026-09-08'},
    {id:'NONE',content:'ללא התראה'},
    {id:'BAD',content:'תאריך שגוי',reminderDate:'2026-99-99'},
  ];
  assert.deepEqual(noteReminderWarningItems(notes,'2026-09-07').map(row=>row.noteId),['PAST','TODAY']);
  assert.deepEqual(noteReminderWarningItems(notes,'2026-09-08').map(row=>row.noteId),['PAST','TODAY','FUTURE']);
});

test('Orders normalization preserves valid reminder dates without changing legacy notes that have no reminder',()=>{
  const {normalizeState}=createStateNormalization({});
  const state=normalizeState({notes:[
    {id:'A',content:'ישן',createdAt:'2026-09-01T00:00:00Z'},
    {id:'B',content:'תקין',createdAt:'2026-09-01T00:00:00Z',reminderDate:'2026-09-10'},
    {id:'C',content:'שגוי',createdAt:'2026-09-01T00:00:00Z',reminderDate:'2026-02-30'},
  ]});
  assert.equal(Object.hasOwn(state.notes[0],'reminderDate'),false);
  assert.equal(state.notes[1].reminderDate,'2026-09-10');
  assert.equal(Object.hasOwn(state.notes[2],'reminderDate'),false);
});


test('inline note reminder calendar highlights today, blocks past days, navigates months and keeps the compact date row reusable',()=>{
  const today='2026-09-07';
  assert.equal(noteReminderMonthKey('2026-09',today),'2026-09');
  assert.equal(noteReminderMonthKey('2026-10-15',today),'2026-10');
  assert.equal(shiftNoteReminderMonth('2026-09',1),'2026-10');
  assert.equal(shiftNoteReminderMonth('2026-01',-1),'2025-12');
  const days=noteReminderCalendarDays('2026-09',{today,minDate:today});
  assert.equal(days.length,42);
  assert.equal(days.find(day=>day.iso==='2026-09-06')?.disabled,true);
  assert.equal(days.find(day=>day.iso===today)?.today,true);
  assert.equal(days.find(day=>day.iso===today)?.disabled,false);
  assert.equal(shiftNoteReminderFocusDate('2026-09-10','ArrowLeft',{minDate:today}),'2026-09-11');
  assert.equal(shiftNoteReminderFocusDate('2026-09-10','ArrowRight',{minDate:today}),'2026-09-09');
  assert.equal(shiftNoteReminderFocusDate('2026-09-10','ArrowUp',{minDate:today}),'2026-09-10','blocked keyboard moves keep the current focused day');
  assert.equal(shiftNoteReminderFocusDate(today,'ArrowRight',{minDate:today}),today,'keyboard navigation must not enter blocked past dates');
  const markup=noteReminderCalendarMarkup({monthKey:'2026-09',selectedDate:'2026-09-10',focusedDate:'2026-09-10',today,minDate:today});
  assert.match(markup,/data-action="note-reminder-prev-month"/);
  assert.match(markup,/data-action="note-reminder-next-month"/);
  assert.match(markup,/data-action="note-reminder-select-day"/);
  assert.match(markup,/data-click-arg0="2026-09-10"[^>]*tabindex="0"[^>]*aria-selected="true"/);
  assert.match(markup,/data-keydown="note-reminder-calendar-keydown"/);
  assert.match(markup,/data-note-reminder-date="2026-09-10"/);
  assert.match(markup,/aria-current="date"/);
  assert.match(markup,/data-click-arg0="2026-09-06"[^>]*disabled/);
  const editor=createUiDateEditor({markCheckSeriesManual:()=>{},syncCheckSeriesFromFirst:()=>{},toast:()=>{}});
  assert.equal(shiftDateEditorIso('2026-09-10','day',1),'2026-09-11');
  assert.equal(shiftDateEditorIso('2026-01-31','month',1),'2026-02-28');
  assert.equal(shiftDateEditorIso('2028-02-29','year',1),'2029-02-28');
  assert.equal(shiftDateEditorIso('2026-09-07','day',-1,{minDate:today}),today);
  const row=editor.dateEditorMarkup('noteReminderDate','2026-09-10',{label:'תאריך תחילת ההתראה',picker:false,change:'note-reminder-date-change',minDate:today});
  assert.match(row,/id="noteReminderDate"/);
  assert.match(row,/data-change="note-reminder-date-change"/);
  assert.match(row,/data-date-min="2026-09-07"/);
  assert.match(row,/data-keydown="handle-check-date-part-keydown"/);
  assert.match(row,/date-editor-no-picker/);
  assert.doesNotMatch(row,/data-action="open-check-date-picker"/);
});

test('note card exposes one reminder button and cancellation removes only the reminder after confirmation',async()=>{
  const model={state:{notes:[{id:'N1',content:'להתקשר ללקוח',createdAt:'2026-09-01T00:00:00Z',updatedAt:'2026-09-01T00:00:00Z',reminderDate:'2026-09-07'}]}};
  const notesUi={notesBulkMode:false,notesBulkSelected:new Set()};
  const saved=[];let allow=false,refreshes=0;
  const notes=createDomainsNotesController({model,notesUi,scheduleSave:msg=>saved.push(msg),mountViewLayout:()=>{},toast:()=>{},confirmDialog:async()=>allow,refreshAlertCenter:()=>{refreshes++},currentView:()=>''});
  const html=notes.stickyNoteCard(model.state.notes[0]);
  assert.match(html,/data-action="open-sticky-note-reminder"/);
  assert.match(html,/התראה ·/);
  assert.match(html,/data-action="delete-sticky-note"/);
  assert.equal(await notes.removeStickyNoteReminder('N1'),false);
  assert.equal(model.state.notes[0].reminderDate,'2026-09-07');
  allow=true;
  assert.equal(await notes.removeStickyNoteReminder('N1'),true);
  assert.equal(Object.hasOwn(model.state.notes[0],'reminderDate'),false);
  assert.deepEqual(saved,['התראה להערה בוטלה']);
  assert.equal(refreshes,1);
  assert.equal(model.state.notes.length,1,'cancelling an alert must not delete the note');
});

test('alert center includes due note reminders, opens the note, and can cancel the reminder in place',async()=>{
  const classState=new Set(),button={classList:{toggle:(name,on)=>on?classState.add(name):classState.delete(name)},attrs:{},setAttribute(name,value){this.attrs[name]=value},title:'',hidden:true},slot={hidden:true},count={textContent:'',hidden:true};
  const model={state:{checks:[],notes:[{id:'N1',content:'תזכורת בדיקה',createdAt:'2000-01-01T00:00:00Z',reminderDate:'2000-01-01'}]}};
  const previousDocument=globalThis.document;let captured=null,closed=0,noteTarget='',dismissed='';
  globalThis.document={getElementById:id=>id==='alertCenterButton'?button:id==='alertCenterSlot'?slot:id==='alertCenterCount'?count:null};
  try{
    const center=createUiAlertCenter({model,financeSnapshot:()=>({kupa:{bank:{currentBalance:1000,adjustments:[]},credits:[],expenses:[],cashflowSettings:{}}}),modal:(title,body,foot)=>{captured={title,body,foot}},closeModal:()=>{closed++},navigateToNote:id=>{noteTarget=id},dismissNoteReminder:async id=>{dismissed=id;delete model.state.notes[0].reminderDate;return true}});
    assert.equal(center.refreshIndicator().length,1);assert.equal(count.textContent,'1');assert.equal(button.hidden,false);assert.equal(slot.hidden,false);
    assert.equal(center.showStartupAlerts(),true);assert.match(captured.body,/תזכורת מהערות/);assert.match(captured.body,/תזכורת בדיקה/);assert.match(captured.body,/data-action="dismiss-note-reminder"/);assert.match(captured.body,/>בטל התראה<\/button>/);
    assert.equal(center.openAlertTarget('note:N1'),true);assert.equal(noteTarget,'N1');assert.equal(closed,1);
    center.openAlertCenter();
    assert.equal(await center.dismissNoteAlert('note:N1'),true);assert.equal(dismissed,'N1');assert.equal(count.textContent,'0');assert.equal(button.hidden,true);assert.ok(closed>=2);
  }finally{if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument}
});
