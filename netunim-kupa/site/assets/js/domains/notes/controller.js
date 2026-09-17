import {uid, esc} from '../../core/values.js';
import {NOTES_SHEET_DEFAULT_WIDTH,clampNotesSheetWidth,formatSheetNumber,normalizeNotesSheet,sheetColumnTotal} from './sheet-model.js';
import {searchMatch} from '../../core/search.js';
import {localSearchMarkup} from '../../ui/search.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsNotesController({model, ui={}, saveState, confirmDialog}){
let saveTimer=null;
let pendingMessage='הפתק עודכן';
const dirtySheetCells=new Set();
const sheetTitleDrafts=new Map();

function noteDisplayDate(note){
  const raw=note?.updatedAt||note?.createdAt;
  if(!raw)return 'נשמר';
  const d=new Date(raw);
  if(Number.isNaN(d.getTime()))return 'נשמר';
  return 'עודכן '+new Intl.DateTimeFormat('he-IL',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(d);
}

function noteSortRows(){return [...(model.state.notes||[])].sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')))}
function visibleNoteRows(){const q=String(ui.notesSearchValue||'').trim(),rows=noteSortRows();return q?rows.filter(note=>searchMatch(q,[note.content],[note.createdAt,note.updatedAt])):rows}
function visibleSheetRows(sheet){const q=String(ui.notesSheetSearchValue||'').trim(),rows=sheet.rows||[];if(!q)return rows;return rows.filter(row=>searchMatch(q,(sheet.columns||[]).map(c=>row.cells?.[c.id]??''),[row.createdAt,row.updatedAt]))}
function resizeStickyNoteTextarea(el){if(!el)return;el.style.height='auto';el.style.height=Math.max(132,el.scrollHeight)+'px'}
function resizeAllStickyNotes(){document.querySelectorAll('.sticky-note textarea').forEach(resizeStickyNoteTextarea)}

function scheduleNoteSave(message='הפתק עודכן'){
  pendingMessage=message;
  clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>{saveTimer=null;saveState(pendingMessage)},220);
}

function cancelScheduledNoteSave(){if(!saveTimer)return;clearTimeout(saveTimer);saveTimer=null}
function flushNoteSave(){if(!saveTimer)return;clearTimeout(saveTimer);saveTimer=null;saveState(pendingMessage)}

function addStickyNote(){
  cancelScheduledNoteSave();
  const now=new Date().toISOString(),note={id:uid('NOTE'),content:'',createdAt:now,updatedAt:now};
  model.state.notes.unshift(note);
  saveState('פתק חדש נוסף');renderNotes();
  requestAnimationFrame(()=>{const el=document.querySelector('.sticky-note textarea');if(el){resizeStickyNoteTextarea(el);el.focus()}});
}

function updateStickyNote(id,el){
  const note=model.state.notes.find(x=>x.id===id);if(!note)return;
  note.content=el.value;note.updatedAt=new Date().toISOString();resizeStickyNoteTextarea(el);
  const date=el.closest('.sticky-note')?.querySelector('[data-note-date]');if(date)date.textContent=noteDisplayDate(note);
  scheduleNoteSave('הפתק עודכן');
}
function blurStickyNote(){flushNoteSave()}

async function deleteStickyNote(id){
  const note=model.state.notes.find(x=>x.id===id);if(!note)return;
  if(!await confirmDialog('מחיקת פתק','למחוק את הפתק הזה?',{confirmText:'מחק פתק'}))return;
  cancelScheduledNoteSave();model.state.notes=model.state.notes.filter(x=>x.id!==id);saveState('הפתק נמחק',{deleteIntents:{notes:[id]},mutationType:'delete',surface:'kupa.delete.notes'});renderNotes();
}

function stickyNoteCard(note){return `<article class="sticky-note" data-note-id="${esc(note.id)}"><div class="sticky-note-paper"><textarea aria-label="תוכן הפתק" placeholder="כתוב כאן הערה או תזכורת…" data-input="update-kupa-sticky-note" data-input-arg0="${esc(note.id)}" data-blur="blur-kupa-sticky-note">${esc(note.content)}</textarea></div><footer class="sticky-note-footer"><span class="sticky-note-date" data-note-date>${esc(noteDisplayDate(note))}</span><button class="btn danger small" data-action="delete-kupa-sticky-note" data-click-arg0="${esc(note.id)}">מחק</button></footer></article>`}

function ensureWorkbook(){model.state.notesSheet=normalizeNotesSheet(model.state.notesSheet);return model.state.notesSheet}
function activeSheetData(){
  const book=ensureWorkbook();let meta=book.sheets.find(sheet=>sheet.id===ui.notesSheetId)||book.sheets[0];
  ui.notesSheetId=meta.id;
  return {book,meta,sheetId:meta.id,columns:book.columns.filter(column=>column.sheetId===meta.id),rows:book.rows.filter(row=>row.sheetId===meta.id)};
}
function setNotesWorkspaceTab(tab){ui.notesTab=tab==='sheet'?'sheet':'notes';renderNotes()}
function setActiveNotesSheet(id){const book=ensureWorkbook(),target=book.sheets.find(sheet=>sheet.id===id);if(!target)return;ui.notesSheetId=target.id;ui.notesSheetSearchValue='';renderNotes()}
function nextSheetName(book){let n=book.sheets.length+1,names=new Set(book.sheets.map(sheet=>sheet.name));while(names.has(`גיליון ${n}`))n++;return `גיליון ${n}`}
function addNotesSheet(){
  const book=ensureWorkbook(),id=uid('SHEET'),name=nextSheetName(book);book.sheets.push({id,name});
  for(let i=0;i<5;i++)book.columns.push({id:uid('SHEETCOL'),sheetId:id,title:`עמודה ${i+1}`,type:'text',width:NOTES_SHEET_DEFAULT_WIDTH});
  ui.notesSheetId=id;ui.notesSheetSearchValue='';saveState('גיליון חדש נוסף');renderNotes();
  requestAnimationFrame(()=>{const input=document.querySelector('.notes-sheet-name-input');input?.focus();input?.select?.()});
}
function renameNotesSheet(el){
  const {meta}=activeSheetData(),name=String(el?.value||'').trim()||meta.name;if(meta.name===name){if(el)el.value=name;return}meta.name=name;if(el)el.value=name;saveState('שם הגיליון עודכן');renderNotes();
}

function sheetCellKey(rowId,columnId){return `${rowId}\u0000${columnId}`}
function findSheetCell(rowId,columnId){return [...(document.querySelectorAll?.('[data-sheet-cell]')||[])].find(el=>el.dataset?.sheetRowId===rowId&&el.dataset?.sheetColumnId===columnId)||null}
function findSheetTitle(columnId){return [...(document.querySelectorAll?.('.notes-sheet-title-input')||[])].find(el=>el.dataset?.sheetColumnId===columnId)||null}

function captureSheetInteraction(){
  const scroll=document.querySelector?.('.notes-sheet-scroll');if(!scroll)return null;
  const active=document.activeElement;let focus=null;
  if(active?.matches?.('[data-sheet-cell]')){
    const rowId=active.dataset.sheetRowId||'',columnId=active.dataset.sheetColumnId||'';
    focus={kind:'cell',rowId,columnId,preserveValue:dirtySheetCells.has(sheetCellKey(rowId,columnId)),value:String(active.value??''),selectionStart:active.selectionStart,selectionEnd:active.selectionEnd,selectionDirection:active.selectionDirection};
  }else if(active?.matches?.('.notes-sheet-title-input')){
    const columnId=active.dataset.sheetColumnId||'';
    focus={kind:'title',columnId,preserveValue:sheetTitleDrafts.has(columnId),value:String(active.value??''),selectionStart:active.selectionStart,selectionEnd:active.selectionEnd,selectionDirection:active.selectionDirection};
  }
  return {scrollLeft:scroll.scrollLeft,scrollTop:scroll.scrollTop,focus};
}

function applySheetScrollPosition(scroll,state){scroll.scrollLeft=state.scrollLeft;scroll.scrollTop=state.scrollTop}

function restoreSheetInteraction(state){
  if(!state)return;
  const scroll=document.querySelector?.('.notes-sheet-scroll');if(!scroll)return;
  applySheetScrollPosition(scroll,state);
  const focusState=state.focus;if(!focusState)return;
  const target=focusState.kind==='cell'?findSheetCell(focusState.rowId,focusState.columnId):findSheetTitle(focusState.columnId);if(!target)return;
  if(focusState.preserveValue)target.value=focusState.value;
  try{target.focus({preventScroll:true})}catch(e){target.focus?.()}
  if(Number.isInteger(focusState.selectionStart)&&Number.isInteger(focusState.selectionEnd))try{target.setSelectionRange(focusState.selectionStart,focusState.selectionEnd,focusState.selectionDirection||'none')}catch(e){}
  applySheetScrollPosition(scroll,state);
  requestAnimationFrame?.(()=>{if(document.querySelector?.('.notes-sheet-scroll')!==scroll||document.activeElement!==target)return;applySheetScrollPosition(scroll,state)});
}

function refreshSheetColumnTotal(columnId){
  const sheet=activeSheetData(),column=sheet.columns.find(x=>x.id===columnId);if(!column||column.type!=='number')return;
  const total=[...(document.querySelectorAll?.('[data-sheet-total-column]')||[])].find(el=>el.dataset?.sheetTotalColumn===columnId)?.querySelector?.('b');
  if(total)total.textContent=formatSheetNumber(sheetColumnTotal(sheet,columnId));
}

function addSheetRow(afterId=''){
  const sheet=activeSheetData(),now=new Date().toISOString(),row={id:uid('SHEETROW'),sheetId:sheet.sheetId,cells:{},createdAt:now,updatedAt:now};
  if(afterId){const absolute=sheet.book.rows.findIndex(x=>x.id===afterId&&x.sheetId===sheet.sheetId);if(absolute>=0)sheet.book.rows.splice(absolute+1,0,row);else sheet.book.rows.push(row)}else sheet.book.rows.push(row);
  saveState('שורה חדשה נוספה לגיליון');renderNotes();
  requestAnimationFrame(()=>document.querySelector(`[data-sheet-row-id="${row.id}"] input[data-sheet-cell]`)?.focus());
}

function updateSheetCell(rowId,columnId,el){
  const sheet=activeSheetData(),row=sheet.book.rows.find(x=>x.id===rowId&&x.sheetId===sheet.sheetId),column=sheet.book.columns.find(x=>x.id===columnId&&x.sheetId===sheet.sheetId);if(!row||!column)return;
  const value=String(el.value??'');if(String(row.cells?.[columnId]??'')===value)return;
  row.cells=row.cells&&typeof row.cells==='object'?row.cells:{};row.cells[columnId]=value;row.updatedAt=new Date().toISOString();dirtySheetCells.add(sheetCellKey(rowId,columnId));refreshSheetColumnTotal(columnId);
}

function saveSheetCell(rowId,columnId,el){updateSheetCell(rowId,columnId,el);const key=sheetCellKey(rowId,columnId);if(!dirtySheetCells.has(key))return;dirtySheetCells.delete(key);saveState('תא בגיליון עודכן')}

function updateSheetColumnTitleDraft(id,el){const sheet=activeSheetData();if(!sheet.columns.some(x=>x.id===id))return;sheetTitleDrafts.set(id,String(el.value??''))}

function handleSheetCellKeydown(rowId,columnId,el,event){
  if(event?.isComposing||event?.altKey||event?.ctrlKey||event?.metaKey)return;
  const key=event?.key;if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(key))return;
  const sheet=activeSheetData(),rowIndex=sheet.rows.findIndex(x=>x.id===rowId),columnIndex=sheet.columns.findIndex(x=>x.id===columnId);if(rowIndex<0||columnIndex<0)return;
  let nextRow=rowIndex,nextColumn=columnIndex;if(key==='ArrowUp')nextRow--;if(key==='ArrowDown')nextRow++;if(key==='ArrowLeft')nextColumn++;if(key==='ArrowRight')nextColumn--;
  if(nextRow<0||nextRow>=sheet.rows.length||nextColumn<0||nextColumn>=sheet.columns.length)return;
  const target=findSheetCell(sheet.rows[nextRow].id,sheet.columns[nextColumn].id);if(!target)return;event.preventDefault?.();target.focus?.();target.select?.();
}

async function deleteSheetRow(id){
  const sheet=activeSheetData();if(!sheet.rows.some(x=>x.id===id))return;
  if(!await confirmDialog('מחיקת שורה','למחוק את השורה הזו מהגיליון?',{confirmText:'מחק שורה'}))return;
  sheet.book.rows=sheet.book.rows.filter(x=>x.id!==id);for(const key of dirtySheetCells)if(key.startsWith(`${id}\u0000`))dirtySheetCells.delete(key);saveState('שורה נמחקה מהגיליון',{deleteIntents:{'notesSheet.rows':[id]},mutationType:'delete',surface:'kupa.delete.notesSheet.rows'});renderNotes();
}

function addSheetColumn(){
  const sheet=activeSheetData(),used=new Set(sheet.columns.map(x=>x.title));let n=sheet.columns.length+1;while(used.has(`עמודה ${n}`))n++;
  const column={id:uid('SHEETCOL'),sheetId:sheet.sheetId,title:`עמודה ${n}`,type:'text',width:NOTES_SHEET_DEFAULT_WIDTH};sheet.book.columns.push(column);saveState('עמודה חדשה נוספה לגיליון');renderNotes();
  requestAnimationFrame(()=>document.querySelector(`[data-sheet-column-id="${column.id}"] .notes-sheet-title-input`)?.select());
}

function renameSheetColumn(id,el){
  const sheet=activeSheetData(),column=sheet.book.columns.find(x=>x.id===id&&x.sheetId===sheet.sheetId);if(!column)return;
  const raw=sheetTitleDrafts.has(id)?sheetTitleDrafts.get(id):String(el.value??'');sheetTitleDrafts.delete(id);const title=String(raw||'').trim()||'עמודה';if(column.title===title){el.value=title;return}column.title=title;el.value=title;saveState('כותרת עמודה עודכנה');
}

function setSheetColumnNumeric(id,checked){const sheet=activeSheetData(),column=sheet.book.columns.find(x=>x.id===id&&x.sheetId===sheet.sheetId);if(!column)return;const type=checked?'number':'text';if(column.type===type)return;column.type=type;saveState('סוג עמודה עודכן');renderNotes()}

async function deleteSheetColumn(id){
  const sheet=activeSheetData(),column=sheet.columns.find(x=>x.id===id);if(!column||sheet.columns.length<=1)return;
  if(!await confirmDialog('מחיקת עמודה',`למחוק את העמודה „${column.title}” ואת התוכן שבה?`,{confirmText:'מחק עמודה'}))return;
  sheet.book.columns=sheet.book.columns.filter(x=>x.id!==id);for(const row of sheet.book.rows.filter(x=>x.sheetId===sheet.sheetId))if(row.cells)delete row.cells[id];for(const key of dirtySheetCells)if(key.endsWith(`\u0000${id}`))dirtySheetCells.delete(key);sheetTitleDrafts.delete(id);saveState('עמודה נמחקה מהגיליון',{deleteIntents:{'notesSheet.columns':[id]},mutationType:'delete',surface:'kupa.delete.notesSheet.columns'});renderNotes();
}

function bindSheetColumnResizeHandles(){
  document.querySelectorAll('[data-sheet-resize-column]').forEach(handle=>handle.addEventListener('pointerdown',event=>{
    if(event.button!==undefined&&event.button!==0)return;
    const sheet=activeSheetData(),id=handle.dataset.sheetResizeColumn,column=sheet.book.columns.find(x=>x.id===id&&x.sheetId===sheet.sheetId);if(!column)return;
    event.preventDefault();const startX=event.clientX,startWidth=column.width,col=[...document.querySelectorAll('col[data-sheet-col]')].find(x=>x.dataset.sheetCol===id);let finalWidth=startWidth;
    handle.classList.add('dragging');handle.setPointerCapture?.(event.pointerId);
    const move=e=>{finalWidth=clampNotesSheetWidth(startWidth+(startX-e.clientX));if(col)col.style.width=finalWidth+'px'};
    const finish=()=>{document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',finish);document.removeEventListener('pointercancel',finish);handle.classList.remove('dragging');if(finalWidth===column.width)return;column.width=finalWidth;saveState('רוחב עמודה עודכן')};
    document.addEventListener('pointermove',move);document.addEventListener('pointerup',finish,{once:true});document.addEventListener('pointercancel',finish,{once:true});
  }));
}

function sheetTabs(){return `<div class="notes-tabs" role="tablist" aria-label="תצוגת הערות"><button class="notes-tab ${ui.notesTab==='sheet'?'':'active'}" role="tab" aria-selected="${ui.notesTab==='sheet'?'false':'true'}" data-action="notes-workspace-notes">הערות</button><button class="notes-tab ${ui.notesTab==='sheet'?'active':''}" role="tab" aria-selected="${ui.notesTab==='sheet'?'true':'false'}" data-action="notes-workspace-sheet">גיליון</button></div>`}

function workbookTabsMarkup(sheet){
  const tabs=sheet.book.sheets.map(tab=>`<button type="button" class="notes-sheet-book-tab ${tab.id===sheet.sheetId?'active':''}" role="tab" aria-selected="${tab.id===sheet.sheetId}" data-action="set-active-notes-sheet" data-click-arg0="${esc(tab.id)}">${esc(tab.name)}</button>`).join('');
  return `<div class="notes-sheet-workbook-bar"><div class="notes-sheet-book-tabs" role="tablist" aria-label="גיליונות">${tabs}<button type="button" class="notes-sheet-book-add" data-action="add-notes-sheet" title="הוסף גיליון" aria-label="הוסף גיליון">＋</button></div><label class="notes-sheet-name"><span>שם הגיליון</span><input class="notes-sheet-name-input" value="${esc(sheet.meta.name)}" data-blur="rename-notes-sheet"></label></div>`;
}

function sheetMarkup(){
  const sheet=activeSheetData(),cols=sheet.columns,rows=visibleSheetRows(sheet);
  const colgroup=cols.map(c=>`<col data-sheet-col="${esc(c.id)}" style="width:${esc(c.width)}px">`).join('')+'<col class="notes-sheet-actions-col">';
  const headers=cols.map(c=>`<th data-sheet-column-id="${esc(c.id)}"><div class="notes-sheet-column-head"><input class="notes-sheet-title-input" aria-label="שם עמודה" value="${esc(c.title)}" data-sheet-column-id="${esc(c.id)}" data-input="draft-notes-sheet-column-title" data-input-arg0="${esc(c.id)}" data-blur="rename-notes-sheet-column" data-blur-arg0="${esc(c.id)}"><label class="notes-sheet-sum-toggle" title="חשב סה״כ בתחתית העמודה"><input type="checkbox" ${c.type==='number'?'checked':''} data-change="set-notes-sheet-column-numeric" data-change-arg0="${esc(c.id)}"><span>סכום</span></label>${cols.length>1?`<button class="notes-sheet-column-delete" title="מחק עמודה" aria-label="מחק עמודה ${esc(c.title)}" data-action="delete-notes-sheet-column" data-click-arg0="${esc(c.id)}">×</button>`:''}</div><span class="notes-sheet-resizer" data-sheet-resize-column="${esc(c.id)}" title="גרור לשינוי רוחב"></span></th>`).join('');
  const body=rows.map(row=>`<tr data-sheet-row-id="${esc(row.id)}">${cols.map(c=>`<td><input data-sheet-cell data-sheet-row-id="${esc(row.id)}" data-sheet-column-id="${esc(c.id)}" class="notes-sheet-cell ${c.type==='number'?'numeric':''}" inputmode="${c.type==='number'?'decimal':'text'}" value="${esc(row.cells?.[c.id]??'')}" data-input="update-notes-sheet-cell" data-input-arg0="${esc(row.id)}" data-input-arg1="${esc(c.id)}" data-blur="save-notes-sheet-cell" data-blur-arg0="${esc(row.id)}" data-blur-arg1="${esc(c.id)}" data-keydown="navigate-notes-sheet-cell" data-keydown-arg0="${esc(row.id)}" data-keydown-arg1="${esc(c.id)}"></td>`).join('')}<td class="notes-sheet-row-actions"><button class="notes-sheet-row-add" title="הוסף שורה אחרי שורה זו" aria-label="הוסף שורה" data-action="add-notes-sheet-row-after" data-click-arg0="${esc(row.id)}">＋</button><button class="notes-sheet-row-delete" title="מחק שורה" aria-label="מחק שורה" data-action="delete-notes-sheet-row" data-click-arg0="${esc(row.id)}">×</button></td></tr>`).join('');
  const searching=String(ui.notesSheetSearchValue||'').trim(),empty=!rows.length?`<tr class="notes-sheet-empty-row"><td colspan="${cols.length+1}">${searching?'אין שורות המתאימות לחיפוש.':'אין עדיין שורות. לחץ על „+ שורה” כדי להתחיל.'}</td></tr>`:'';
  const totals=cols.map(c=>`<td ${c.type==='number'?`data-sheet-total-column="${esc(c.id)}"`:''} class="${c.type==='number'?'notes-sheet-total-cell':''}">${c.type==='number'?`<span>סה״כ</span><b>${esc(formatSheetNumber(sheetColumnTotal(sheet,c.id)))}</b>`:''}</td>`).join('');
  return `${workbookTabsMarkup(sheet)}<section class="notes-sheet-panel"><div class="notes-sheet-scroll"><table class="notes-sheet-table"><colgroup>${colgroup}</colgroup><thead><tr>${headers}<th class="notes-sheet-actions-head"><button title="הוסף שורה" aria-label="הוסף שורה" data-action="add-notes-sheet-row">＋</button></th></tr></thead><tbody>${body}${empty}</tbody><tfoot><tr>${totals}<td></td></tr></tfoot></table></div></section>`;
}

function notesWorkspaceMarkup(sheetActive){
  if(sheetActive)return sheetMarkup();
  const rows=visibleNoteRows(),searching=String(ui.notesSearchValue||'').trim();
  return `<div class="notes-grid">${rows.map(stickyNoteCard).join('')||`<div class="notes-empty"><b>${searching?'לא נמצאו פתקים':'אין עדיין פתקים'}</b>${searching?'נסה ניסוח אחר או נקה את החיפוש.':'לחץ על „פתק חדש” כדי לרשום תזכורת ראשונה.'}</div>`}</div>`;
}
function setNotesSearch(value){const sheetActive=ui.notesTab==='sheet';if(sheetActive)ui.notesSheetSearchValue=String(value||'');else ui.notesSearchValue=String(value||'');const region=document.getElementById('notesWorkspaceResults');if(!region)return;region.innerHTML=notesWorkspaceMarkup(sheetActive);if(sheetActive)bindSheetColumnResizeHandles();else requestAnimationFrame(resizeAllStickyNotes)}
function renderNotes(){
  const interaction=ui.notesTab==='sheet'?captureSheetInteraction():null;
  if(ui.notesTab!=='sheet')ui.notesTab='notes';
  const sheetActive=ui.notesTab==='sheet';if(sheetActive)activeSheetData();
  document.getElementById('content').innerHTML=`<div class="notes-view"><section class="notes-hero"><div class="notes-hero-main"><div class="notes-title-row">${sheetTabs()}</div><p>${sheetActive?'גיליונות נפרדים עם שמות, שורות, עמודות וסיכומים משלהם.':'פתקים מהירים שנשמרים ומסתנכרנים יחד עם נתוני הקופה.'}</p>${localSearchMarkup({value:sheetActive?(ui.notesSheetSearchValue||''):(ui.notesSearchValue||''),placeholder:sheetActive?'חיפוש בגיליון הפעיל…':'חיפוש בפתקים…',label:sheetActive?'חיפוש בגיליון הפעיל':'חיפוש בפתקים',inputAction:'notes-search',className:'notes-search-field'})}</div><div class="notes-actions">${sheetActive?'<button class="btn" data-action="add-notes-sheet-column">+ עמודה</button><button class="btn primary" data-action="add-notes-sheet-row">+ שורה</button>':'<button class="btn primary" data-action="add-kupa-sticky-note">+ פתק חדש</button>'}</div></section><div id="notesWorkspaceResults">${notesWorkspaceMarkup(sheetActive)}</div></div>`;
  if(sheetActive){bindSheetColumnResizeHandles();restoreSheetInteraction(interaction)}else requestAnimationFrame(resizeAllStickyNotes);
}

return {noteDisplayDate,noteSortRows,visibleNoteRows,resizeStickyNoteTextarea,resizeAllStickyNotes,addStickyNote,updateStickyNote,blurStickyNote,deleteStickyNote,stickyNoteCard,setNotesWorkspaceTab,setNotesSearch,setActiveNotesSheet,addNotesSheet,renameNotesSheet,addSheetRow,updateSheetCell,saveSheetCell,updateSheetColumnTitleDraft,handleSheetCellKeydown,deleteSheetRow,addSheetColumn,renameSheetColumn,setSheetColumnNumeric,deleteSheetColumn,renderNotes,flushNoteSave};
}
