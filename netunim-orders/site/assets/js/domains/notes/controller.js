import {uid, esc} from '../../core/values.js';
import {$} from '../../state/constants.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsNotesController({model, notesUi, scheduleSave, toast, mountViewLayout, confirmDialog}){
function noteDisplayDate(note){const raw=note?.updatedAt||note?.createdAt;if(!raw)return 'נשמר';const d=new Date(raw);if(Number.isNaN(d.getTime()))return 'נשמר';return 'עודכן '+new Intl.DateTimeFormat('he-IL',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(d)}

function noteSortRows(){return [...(model.state.notes||[])].sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')))}

function resizeStickyNoteTextarea(el){if(!el)return;el.style.height='auto';el.style.height=Math.max(132,el.scrollHeight)+'px'}

function resizeAllStickyNotes(){document.querySelectorAll('.sticky-note textarea').forEach(resizeStickyNoteTextarea)}

function addStickyNote(){const now=new Date().toISOString(),note={id:uid('NOTE'),content:'',createdAt:now,updatedAt:now};model.state.notes.unshift(note);notesUi.notesBulkSelected.clear();scheduleSave('פתק חדש נוסף');renderNotes();requestAnimationFrame(()=>{const el=document.querySelector(`[data-note-id="${CSS.escape(String(note.id))}"] textarea`);if(el){resizeStickyNoteTextarea(el);el.focus()}})}

function updateStickyNote(id,el){const note=model.state.notes.find(x=>x.id===id);if(!note)return;note.content=el.value;note.updatedAt=new Date().toISOString();resizeStickyNoteTextarea(el);const date=el.closest('.sticky-note')?.querySelector('[data-note-date]');if(date)date.textContent=noteDisplayDate(note);scheduleSave('הפתק עודכן')}

async function deleteStickyNote(id){const note=model.state.notes.find(x=>x.id===id);if(!note)return;if(!await confirmDialog('מחיקת פתק','למחוק את הפתק הזה?',{confirmText:'מחק פתק'}))return;model.state.notes=model.state.notes.filter(x=>x.id!==id);notesUi.notesBulkSelected.delete(id);scheduleSave('הפתק נמחק');renderNotes()}

function toggleNotesBulkMode(){notesUi.notesBulkMode=!notesUi.notesBulkMode;notesUi.notesBulkSelected.clear();renderNotes()}

function toggleNotesBulkRow(id,checked){if(!notesUi.notesBulkMode||!model.state.notes.some(x=>x.id===id))return;if(checked)notesUi.notesBulkSelected.add(id);else notesUi.notesBulkSelected.delete(id);syncNotesBulkUi()}

function toggleNotesBulkVisible(){if(!notesUi.notesBulkMode)return;const ids=noteSortRows().map(x=>x.id),all=ids.length>0&&ids.every(id=>notesUi.notesBulkSelected.has(id));ids.forEach(id=>all?notesUi.notesBulkSelected.delete(id):notesUi.notesBulkSelected.add(id));syncNotesBulkUi()}

function notesBulkControls(){return `<div class="notes-bulk-controls"><button class="btn small bulk-select-toggle ${esc(notesUi.notesBulkMode?'active':'')}" data-action="toggle-notes-bulk-mode">${notesUi.notesBulkMode?'סיום בחירה':'בחירה'}</button>${notesUi.notesBulkMode?`<button id="notesBulkAll" class="btn small bulk-select-all-btn" data-action="toggle-notes-bulk-visible">בחר הכל</button><button id="notesBulkDelete" class="btn danger small bulk-delete-btn" data-action="delete-selected-sticky-notes" disabled>מחק נבחרים</button>`:''}</div>`}

function syncNotesBulkUi(){if(!notesUi.notesBulkMode)return;const valid=new Set(model.state.notes.map(x=>x.id));[...notesUi.notesBulkSelected].forEach(id=>{if(!valid.has(id))notesUi.notesBulkSelected.delete(id)});const del=$('#notesBulkDelete');if(del){del.disabled=!notesUi.notesBulkSelected.size;del.textContent=notesUi.notesBulkSelected.size?`מחק ${notesUi.notesBulkSelected.size}`:'מחק נבחרים'}const ids=noteSortRows().map(x=>x.id),all=ids.length>0&&ids.every(id=>notesUi.notesBulkSelected.has(id)),allBtn=$('#notesBulkAll');if(allBtn)allBtn.textContent=all?'בטל הכל':'בחר הכל';document.querySelectorAll('[data-note-id]').forEach(card=>{const selected=notesUi.notesBulkSelected.has(card.dataset.noteId);card.classList.toggle('bulk-selected-card',selected);const cb=card.querySelector('[data-note-bulk-check]');if(cb)cb.checked=selected})}

async function deleteSelectedStickyNotes(){const valid=new Set(model.state.notes.map(x=>x.id)),ids=[...notesUi.notesBulkSelected].filter(id=>valid.has(id));if(!ids.length)return toast('לא נבחרו פתקים למחיקה');if(!await confirmDialog('מחיקת פתקים',`למחוק ${ids.length} פתקים שנבחרו?`,{confirmText:'מחק פתקים'}))return;const set=new Set(ids);model.state.notes=model.state.notes.filter(x=>!set.has(x.id));notesUi.notesBulkSelected.clear();scheduleSave(`${ids.length} פתקים נמחקו`);renderNotes()}

function stickyNoteCard(note){const selected=notesUi.notesBulkSelected.has(note.id);return `<article class="sticky-note ${esc(selected?'bulk-selected-card':'')}" data-note-id="${esc(note.id)}">${notesUi.notesBulkMode?`<label class="sticky-note-select" title="בחר פתק"><input type="checkbox" data-note-bulk-check ${selected?'checked':''} data-change="toggle-notes-bulk-row" data-change-arg0="${esc(note.id)}"></label>`:''}<div class="sticky-note-paper"><textarea aria-label="תוכן הפתק" placeholder="כתוב כאן הערה או תזכורת…" data-input="update-sticky-note" data-input-arg0="${esc(note.id)}">${esc(note.content)}</textarea></div><footer class="sticky-note-footer"><span class="sticky-note-date" data-note-date>${esc(noteDisplayDate(note))}</span><button class="btn danger small" data-action="delete-sticky-note" data-click-arg0="${esc(note.id)}">מחק</button></footer></article>`}

function renderNotes(){const rows=noteSortRows();$('#main').innerHTML=`<div class="notes-view"><section class="hero notes-hero"><div><h1>הערות</h1></div><div class="notes-actions"><button class="btn primary" data-action="add-sticky-note">+ פתק חדש</button>${notesBulkControls()}</div></section><div class="notes-grid">${rows.map(stickyNoteCard).join('')||`<div class="notes-empty"><b>אין עדיין פתקים</b>לחץ על „פתק חדש” כדי לרשום תזכורת ראשונה.</div>`}</div></div>`;mountViewLayout({sourceSelector:'.notes-view',headCount:1,className:'notes-view',scrollKey:'notes'});requestAnimationFrame(()=>{resizeAllStickyNotes();syncNotesBulkUi()})}

return { noteDisplayDate, noteSortRows, resizeStickyNoteTextarea, resizeAllStickyNotes, addStickyNote, updateStickyNote, deleteStickyNote, toggleNotesBulkMode, toggleNotesBulkRow, toggleNotesBulkVisible, notesBulkControls, syncNotesBulkUi, deleteSelectedStickyNotes, stickyNoteCard, renderNotes };
}
