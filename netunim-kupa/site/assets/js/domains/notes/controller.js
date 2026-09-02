import {uid, esc} from '../../core/values.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsNotesController({model, saveState, confirmDialog}){
let saveTimer=null;
let pendingMessage='הפתק עודכן';

function noteDisplayDate(note){
  const raw=note?.updatedAt||note?.createdAt;
  if(!raw)return 'נשמר';
  const d=new Date(raw);
  if(Number.isNaN(d.getTime()))return 'נשמר';
  return 'עודכן '+new Intl.DateTimeFormat('he-IL',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(d);
}

function noteSortRows(){return [...(model.state.notes||[])].sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')))}
function resizeStickyNoteTextarea(el){if(!el)return;el.style.height='auto';el.style.height=Math.max(132,el.scrollHeight)+'px'}
function resizeAllStickyNotes(){document.querySelectorAll('.sticky-note textarea').forEach(resizeStickyNoteTextarea)}

function scheduleNoteSave(message='הפתק עודכן'){
  pendingMessage=message;
  clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>{saveTimer=null;saveState(pendingMessage)},220);
}

function cancelScheduledNoteSave(){if(!saveTimer)return;clearTimeout(saveTimer);saveTimer=null}

function flushNoteSave(){
  if(!saveTimer)return;
  clearTimeout(saveTimer);saveTimer=null;saveState(pendingMessage);
}

function addStickyNote(){
  cancelScheduledNoteSave();
  const now=new Date().toISOString(),note={id:uid('NOTE'),content:'',createdAt:now,updatedAt:now};
  model.state.notes.unshift(note);
  saveState('פתק חדש נוסף');
  renderNotes();
  requestAnimationFrame(()=>{const el=document.querySelector('.sticky-note textarea');if(el){resizeStickyNoteTextarea(el);el.focus()}});
}

function updateStickyNote(id,el){
  const note=model.state.notes.find(x=>x.id===id);if(!note)return;
  note.content=el.value;note.updatedAt=new Date().toISOString();
  resizeStickyNoteTextarea(el);
  const date=el.closest('.sticky-note')?.querySelector('[data-note-date]');if(date)date.textContent=noteDisplayDate(note);
  scheduleNoteSave('הפתק עודכן');
}

function blurStickyNote(){flushNoteSave()}

async function deleteStickyNote(id){
  const note=model.state.notes.find(x=>x.id===id);if(!note)return;
  if(!await confirmDialog('מחיקת פתק','למחוק את הפתק הזה?',{confirmText:'מחק פתק'}))return;
  cancelScheduledNoteSave();
  model.state.notes=model.state.notes.filter(x=>x.id!==id);
  saveState('הפתק נמחק');renderNotes();
}

function stickyNoteCard(note){return `<article class="sticky-note" data-note-id="${esc(note.id)}"><div class="sticky-note-paper"><textarea aria-label="תוכן הפתק" placeholder="כתוב כאן הערה או תזכורת…" data-input="update-kupa-sticky-note" data-input-arg0="${esc(note.id)}" data-blur="blur-kupa-sticky-note">${esc(note.content)}</textarea></div><footer class="sticky-note-footer"><span class="sticky-note-date" data-note-date>${esc(noteDisplayDate(note))}</span><button class="btn danger small" data-action="delete-kupa-sticky-note" data-click-arg0="${esc(note.id)}">מחק</button></footer></article>`}

function renderNotes(){
  const rows=noteSortRows();
  document.getElementById('content').innerHTML=`<div class="notes-view"><section class="notes-hero"><div><h1>הערות</h1><p>פתקים מהירים שנשמרים ומסתנכרנים יחד עם נתוני הקופה.</p></div><div class="notes-actions"><button class="btn primary" data-action="add-kupa-sticky-note">+ פתק חדש</button></div></section><div class="notes-grid">${rows.map(stickyNoteCard).join('')||`<div class="notes-empty"><b>אין עדיין פתקים</b>לחץ על „פתק חדש” כדי לרשום תזכורת ראשונה.</div>`}</div></div>`;
  requestAnimationFrame(resizeAllStickyNotes);
}

return { noteDisplayDate, noteSortRows, resizeStickyNoteTextarea, resizeAllStickyNotes, addStickyNote, updateStickyNote, blurStickyNote, deleteStickyNote, stickyNoteCard, renderNotes, flushNoteSave };
}
