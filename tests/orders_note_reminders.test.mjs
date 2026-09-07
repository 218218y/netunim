import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeNoteReminderDate,noteReminderWarningItems} from '../netunim-orders/site/assets/js/domains/notes/alerts.js';
import {createDomainsNotesController} from '../netunim-orders/site/assets/js/domains/notes/controller.js';
import {createStateNormalization} from '../netunim-orders/site/assets/js/state/normalization.js';
import {createUiAlertCenter} from '../netunim-orders/site/assets/js/ui/alert-center.js';

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
