import {createNotesWorkbook} from '../../shared/notes-workbook.js';
import {uid, esc} from '../../core/values.js';
import {checkDateFmt,checkTodayISO} from '../../core/dates.js';
import {normalizeNoteReminderDate} from './alerts.js';
import {noteReminderCalendarMarkup,noteReminderMonthKey,shiftNoteReminderFocusDate,shiftNoteReminderMonth} from './reminder-calendar.js';
import {layoutStickyNoteCard,layoutStickyNoteGrid} from './layout.js';
import {$} from '../../state/constants.js';
import {applyBulkRangeSelection} from '../../ui/bulk-selection.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsNotesController({workspace=null,model, notesUi, scheduleSave, toast=()=>{}, mountViewLayout, confirmDialog, modal=()=>{}, closeModal=()=>{}, refreshAlertCenter=()=>{}, currentView=()=>'', dateEditorMarkup=()=>'', setDateValue=()=>{}}){
const workbook=createNotesWorkbook({model:workspace?.model||model,ui:notesUi,saveState:workspace?.saveWorkbook||scheduleSave,cellChanged:workspace?.cellChanged,editScope:()=>workspace?.sync.ownerKey,canEdit:()=>!workspace||workspace.ready&&!workspace.readOnly,confirmDialog,renderNotes,uid,esc,searchMatch:(q,values)=>values.some(value=>String(value).toLocaleLowerCase().includes(q.toLocaleLowerCase())),site:'orders'});
let reminderPickerMonth='',reminderPickerFocusDate='',notesGridObserver=null,notesLayoutFrame=0;
function noteDisplayDate(note){const raw=note?.updatedAt||note?.createdAt;if(!raw)return 'נשמר';const d=new Date(raw);if(Number.isNaN(d.getTime()))return 'נשמר';return 'עודכן '+new Intl.DateTimeFormat('he-IL',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(d)}

function noteSortRows(){return [...(model.state.notes||[])].sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')))}

function resizeStickyNoteTextarea(el){if(!el)return;el.style.height='auto';el.style.height=Math.max(132,el.scrollHeight)+'px'}

function resizeAllStickyNotes(){document.querySelectorAll('.sticky-note textarea').forEach(resizeStickyNoteTextarea)}

function scheduleNotesLayout({resizeTextareas=false}={}){
  if(notesLayoutFrame)cancelAnimationFrame(notesLayoutFrame);
  notesLayoutFrame=requestAnimationFrame(()=>{notesLayoutFrame=0;if(resizeTextareas)resizeAllStickyNotes();layoutStickyNoteGrid()});
}

function mountNotesLayout(){
  notesGridObserver?.disconnect();notesGridObserver=null;
  const grid=document.querySelector('.notes-grid');if(!grid)return;
  if(typeof ResizeObserver==='function'){notesGridObserver=new ResizeObserver(()=>scheduleNotesLayout({resizeTextareas:true}));notesGridObserver.observe(grid)}
  resizeAllStickyNotes();layoutStickyNoteGrid(grid);
}

function addStickyNote(){const now=new Date().toISOString(),note={id:uid('NOTE'),content:'',createdAt:now,updatedAt:now};model.state.notes.unshift(note);notesUi.notesBulkSelected.clear();notesUi.notesBulkAnchorId=null;scheduleSave('פתק חדש נוסף',{operations:[{type:'put',collection:'notes',id:note.id,mode:'insert',index:0,record:note}]});renderNotes();requestAnimationFrame(()=>{const el=document.querySelector(`[data-note-id="${CSS.escape(String(note.id))}"] textarea`);if(el){resizeStickyNoteTextarea(el);el.focus()}})}

function updateStickyNote(id,el){const note=model.state.notes.find(x=>x.id===id);if(!note)return;note.content=el.value;note.updatedAt=new Date().toISOString();resizeStickyNoteTextarea(el);layoutStickyNoteCard(el.closest('.sticky-note'));const date=el.closest('.sticky-note')?.querySelector('[data-note-date]');if(date)date.textContent=noteDisplayDate(note);scheduleSave('הפתק עודכן',{operations:[{type:'put',collection:'notes',id,mode:'replace',record:note}]})}

async function deleteStickyNote(id){const note=model.state.notes.find(x=>x.id===id);if(!note)return;if(!await confirmDialog('מחיקת פתק','למחוק את הפתק הזה?',{confirmText:'מחק פתק'}))return;model.state.notes=model.state.notes.filter(x=>x.id!==id);notesUi.notesBulkSelected.delete(id);scheduleSave('הפתק נמחק',{deleteIntents:{notes:[id]},mutationType:'delete',surface:'orders.delete.notes'});refreshAlertCenter();renderNotes()}

function reminderButtonLabel(note){const date=normalizeNoteReminderDate(note?.reminderDate);return date?`התראה · ${checkDateFmt(date)}`:'התראה'}

function focusStickyNoteReminderDate(value){
  const selected=normalizeNoteReminderDate(value);if(!selected)return;
  requestAnimationFrame(()=>$('#noteReminderCalendar')?.querySelector(`[data-note-reminder-date="${CSS.escape(selected)}"]`)?.focus());
}

function renderStickyNoteReminderCalendar({restoreFocus=false}={}){
  const host=$('#noteReminderCalendar'),today=checkTodayISO(),selected=normalizeNoteReminderDate($('#noteReminderDate')?.value)||today;if(!host)return false;
  const focused=normalizeNoteReminderDate(reminderPickerFocusDate)||selected;
  host.innerHTML=noteReminderCalendarMarkup({monthKey:reminderPickerMonth||noteReminderMonthKey(selected,today),selectedDate:selected,focusedDate:focused,today,minDate:today});
  if(restoreFocus)focusStickyNoteReminderDate(focused);
  return true;
}

function changeStickyNoteReminderMonth(delta){
  const today=checkTodayISO(),current=reminderPickerMonth||noteReminderMonthKey($('#noteReminderDate')?.value,today),next=shiftNoteReminderMonth(current,delta);
  if(Number(delta)<0&&next<today.slice(0,7))return false;
  const selected=normalizeNoteReminderDate($('#noteReminderDate')?.value),first=`${next}-01`;
  reminderPickerMonth=next;reminderPickerFocusDate=selected?.slice(0,7)===next?selected:(first<today?today:first);
  return renderStickyNoteReminderCalendar({restoreFocus:true});
}

function selectStickyNoteReminderDate(value){
  const selected=normalizeNoteReminderDate(value),today=checkTodayISO();if(!selected||selected<today)return false;
  reminderPickerMonth=noteReminderMonthKey(selected,today);reminderPickerFocusDate=selected;setDateValue($('#noteReminderDate'),selected,true);focusStickyNoteReminderDate(selected);return true;
}

function handleStickyNoteReminderCalendarKeydown(event,element){
  const current=normalizeNoteReminderDate(element?.dataset?.noteReminderDate),today=checkTodayISO();if(!current)return false;
  if(event.key==='Enter'||event.key===' '){event.preventDefault();return selectStickyNoteReminderDate(current)}
  if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return false;
  event.preventDefault();const next=shiftNoteReminderFocusDate(current,event.key,{minDate:today});if(!next)return false;
  reminderPickerFocusDate=next;reminderPickerMonth=noteReminderMonthKey(next,today);setDateValue($('#noteReminderDate'),next,true);focusStickyNoteReminderDate(next);return true;
}

function syncStickyNoteReminderCalendar(input){
  const selected=normalizeNoteReminderDate(input?.value||$('#noteReminderDate')?.value),today=checkTodayISO();if(!selected||selected<today)return false;
  reminderPickerMonth=noteReminderMonthKey(selected,today);reminderPickerFocusDate=selected;return renderStickyNoteReminderCalendar();
}

async function openStickyNoteReminder(id){
  const note=model.state.notes.find(x=>x.id===id);if(!note)return false;
  if(normalizeNoteReminderDate(note.reminderDate))return removeStickyNoteReminder(id);
  const today=checkTodayISO(),preview=String(note.content||'').trim().slice(0,180);reminderPickerMonth=noteReminderMonthKey(today,today);reminderPickerFocusDate=today;
  modal('התראה להערה',`<div class="note-reminder-dialog">${preview?`<div class="notice"><b>הערה:</b> ${esc(preview)}${String(note.content||'').trim().length>180?'…':''}</div>`:''}<div id="noteReminderCalendar">${noteReminderCalendarMarkup({monthKey:reminderPickerMonth,selectedDate:today,today,minDate:today})}</div><div class="field note-reminder-date-field"><label>תאריך תחילת ההתראה</label>${dateEditorMarkup('noteReminderDate',today,{label:'תאריך תחילת ההתראה',picker:false,change:'note-reminder-date-change',minDate:today})}<small>בחר יום בלוח או הקלד תאריך. מהתאריך שנבחר ואילך ההערה תופיע במרכז האזהרות עד לביטול ההתראה.</small></div></div>`,`<button class="btn primary" type="button" data-action="save-sticky-note-reminder" data-click-arg0="${esc(note.id)}">שמור התראה</button><button class="btn" type="button" data-action="close-modal">ביטול</button>`);
  focusStickyNoteReminderDate(today);
  return true;
}

function saveStickyNoteReminder(id){
  const note=model.state.notes.find(x=>x.id===id);if(!note)return false;
  const reminderDate=normalizeNoteReminderDate($('#noteReminderDate')?.value);
  if(!reminderDate){toast('בחר תאריך תקין להתראה');return false}
  if(reminderDate<checkTodayISO()){toast('אפשר לבחור התראה מהיום ואילך');return false}
  note.reminderDate=reminderDate;note.updatedAt=new Date().toISOString();
  scheduleSave('התראה להערה נוספה');closeModal();
  if(currentView()==='notes')renderNotes();
  refreshAlertCenter();toast(`ההתראה נקבעה ל־${checkDateFmt(reminderDate)}`);return true;
}

async function removeStickyNoteReminder(id){
  const note=model.state.notes.find(x=>x.id===id),reminderDate=normalizeNoteReminderDate(note?.reminderDate);if(!note||!reminderDate)return false;
  if(!await confirmDialog('ביטול התראה',`לבטל את ההתראה להערה שנקבעה ל־${checkDateFmt(reminderDate)}?`,{confirmText:'בטל התראה'}))return false;
  delete note.reminderDate;note.updatedAt=new Date().toISOString();scheduleSave('התראה להערה בוטלה');
  if(currentView()==='notes')renderNotes();
  refreshAlertCenter();toast('ההתראה בוטלה');return true;
}

function toggleNotesBulkMode(){notesUi.notesBulkMode=!notesUi.notesBulkMode;notesUi.notesBulkSelected.clear();notesUi.notesBulkAnchorId=null;renderNotes()}

function toggleNotesBulkRow(id,checked,shiftKey=false){if(!notesUi.notesBulkMode||!model.state.notes.some(x=>x.id===id))return;notesUi.notesBulkAnchorId=applyBulkRangeSelection({selected:notesUi.notesBulkSelected,orderedIds:noteSortRows().map(x=>x.id),id,checked,shiftKey,anchorId:notesUi.notesBulkAnchorId});syncNotesBulkUi()}

function toggleNotesBulkVisible(){if(!notesUi.notesBulkMode)return;const ids=noteSortRows().map(x=>x.id),all=ids.length>0&&ids.every(id=>notesUi.notesBulkSelected.has(id));ids.forEach(id=>all?notesUi.notesBulkSelected.delete(id):notesUi.notesBulkSelected.add(id));syncNotesBulkUi()}

function notesBulkControls(){return `<div class="notes-bulk-controls"><button class="btn small bulk-select-toggle ${esc(notesUi.notesBulkMode?'active':'')}" data-action="toggle-notes-bulk-mode">${notesUi.notesBulkMode?'סיום בחירה':'בחירה'}</button>${notesUi.notesBulkMode?`<button id="notesBulkAll" class="btn small bulk-select-all-btn" data-action="toggle-notes-bulk-visible">בחר הכל</button><button id="notesBulkDelete" class="btn danger small bulk-delete-btn" data-action="delete-selected-sticky-notes" disabled>מחק נבחרים</button>`:''}</div>`}

function syncNotesBulkUi(){if(!notesUi.notesBulkMode)return;const valid=new Set(model.state.notes.map(x=>x.id));[...notesUi.notesBulkSelected].forEach(id=>{if(!valid.has(id))notesUi.notesBulkSelected.delete(id)});const del=$('#notesBulkDelete');if(del){del.disabled=!notesUi.notesBulkSelected.size;del.textContent=notesUi.notesBulkSelected.size?`מחק ${notesUi.notesBulkSelected.size}`:'מחק נבחרים'}const ids=noteSortRows().map(x=>x.id),all=ids.length>0&&ids.every(id=>notesUi.notesBulkSelected.has(id)),allBtn=$('#notesBulkAll');if(allBtn)allBtn.textContent=all?'בטל הכל':'בחר הכל';document.querySelectorAll('[data-note-id]').forEach(card=>{const selected=notesUi.notesBulkSelected.has(card.dataset.noteId);card.classList.toggle('bulk-selected-card',selected);const cb=card.querySelector('[data-note-bulk-check]');if(cb)cb.checked=selected})}

async function deleteSelectedStickyNotes(){const valid=new Set(model.state.notes.map(x=>x.id)),ids=[...notesUi.notesBulkSelected].filter(id=>valid.has(id));if(!ids.length)return toast('לא נבחרו פתקים למחיקה');if(!await confirmDialog('מחיקת פתקים',`למחוק ${ids.length} פתקים שנבחרו?`,{confirmText:'מחק פתקים'}))return;const set=new Set(ids);model.state.notes=model.state.notes.filter(x=>!set.has(x.id));notesUi.notesBulkSelected.clear();notesUi.notesBulkAnchorId=null;scheduleSave(`${ids.length} פתקים נמחקו`,{deleteIntents:{notes:ids},mutationType:'bulk-delete',surface:'orders.bulk.notes'});refreshAlertCenter();renderNotes()}

function stickyNoteCard(note){const selected=notesUi.notesBulkSelected.has(note.id),reminderDate=normalizeNoteReminderDate(note.reminderDate);return `<article class="sticky-note ${esc(selected?'bulk-selected-card':'')} ${reminderDate?'has-reminder':''}" data-note-id="${esc(note.id)}">${notesUi.notesBulkMode?`<label class="sticky-note-select" title="בחר פתק"><input type="checkbox" data-note-bulk-check ${selected?'checked':''} data-action="toggle-notes-bulk-row" data-change="toggle-notes-bulk-row" data-click-arg0="${esc(note.id)}"></label>`:''}<div class="sticky-note-paper"><textarea aria-label="תוכן הפתק" placeholder="כתוב כאן הערה או תזכורת…" data-input="update-sticky-note" data-input-arg0="${esc(note.id)}">${esc(note.content)}</textarea></div><footer class="sticky-note-footer"><span class="sticky-note-date" data-note-date>${esc(noteDisplayDate(note))}</span><div class="sticky-note-footer-actions"><button class="btn small sticky-note-reminder ${reminderDate?'active':''}" type="button" data-action="open-sticky-note-reminder" data-click-arg0="${esc(note.id)}" title="${esc(reminderDate?'לחץ לביטול ההתראה':'הוסף התראה להערה')}">${esc(reminderButtonLabel(note))}</button><button class="btn danger small" type="button" data-action="delete-sticky-note" data-click-arg0="${esc(note.id)}">מחק</button></div></footer></article>`}

function renderNotes(){if(notesUi.notesTab==='sheet')return renderSheet();const rows=noteSortRows();$('#main').innerHTML=`<div class="notes-view"><section class="hero notes-hero"><div>${workbook.sheetTabs()}</div><div class="notes-actions"><button class="btn primary" data-action="add-sticky-note">+ פתק חדש</button>${notesBulkControls()}</div></section><div class="notes-grid">${rows.map(stickyNoteCard).join('')||`<div class="notes-empty"><b>אין עדיין פתקים</b>לחץ על „פתק חדש” כדי לרשום תזכורת ראשונה.</div>`}</div></div>`;mountViewLayout({sourceSelector:'.notes-view',headCount:1,className:'notes-view',scrollKey:'notes'});requestAnimationFrame(()=>{mountNotesLayout();syncNotesBulkUi()})}

function sheetContent(){return workspace&&!workspace.ready?workspace.loadingMarkup():`${workspace?.toolbarMarkup()||''}<fieldset class="spreadsheet-editor" ${workspace?.readOnly?'disabled':''}>${workbook.sheetMarkup()}</fieldset>`}
function renderSheet(){
  const interaction=workbook.captureSheetInteraction();
  notesGridObserver?.disconnect();notesGridObserver=null;
  $('#main').innerHTML=`<div class="notes-view notes-workbook-view"><section class="hero notes-hero"><div class="notes-workbook-heading">${workbook.sheetTabs()}<input type="search" class="notes-workbook-search" aria-label="חיפוש בגליון הפעיל" placeholder="חיפוש בגליון הפעיל…" value="${esc(notesUi.notesSheetSearchValue||'')}" data-input="orders-notes-sheet-search"></div><div class="notes-actions"><button class="btn" data-action="add-notes-sheet-column">+ עמודה</button><button class="btn primary" data-action="add-notes-sheet-row">+ שורה</button></div></section><div id="ordersNotesSheetResults">${sheetContent()}</div></div>`;
  mountViewLayout({sourceSelector:'.notes-view',headCount:1,className:'notes-view notes-workbook-view',scrollKey:'notes-sheet'});
  workbook.bindSheetColumnResizeHandles();workbook.restoreSheetInteraction(interaction);
}

workbook.sheetActions['orders-notes-sheet-search']=element=>{notesUi.notesSheetSearchValue=element.value;const region=document.getElementById('ordersNotesSheetResults');if(region){region.innerHTML=sheetContent();workbook.bindSheetColumnResizeHandles()}};

return { ...workbook, sheetActions:{...workbook.sheetActions,...workspace?.actions}, noteDisplayDate, noteSortRows, resizeStickyNoteTextarea, resizeAllStickyNotes, addStickyNote, updateStickyNote, deleteStickyNote, openStickyNoteReminder, changeStickyNoteReminderMonth, selectStickyNoteReminderDate, handleStickyNoteReminderCalendarKeydown, syncStickyNoteReminderCalendar, saveStickyNoteReminder, removeStickyNoteReminder, toggleNotesBulkMode, toggleNotesBulkRow, toggleNotesBulkVisible, notesBulkControls, syncNotesBulkUi, deleteSelectedStickyNotes, stickyNoteCard, renderNotes };
}
