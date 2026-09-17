import {NOTES_SHEET_DEFAULT_WIDTH,clampNotesSheetWidth,formatSheetNumber,normalizeNotesSheet,sheetNumericValue,sheetColumnLabel,parseSheetClipboard} from './notes-sheet-model.js';

export const SHEET_RENDER_THRESHOLD=200;
export const SHEET_PAGE_SIZE=100;

export function createNotesWorkbook({model,ui,saveState,confirmDialog,renderNotes,uid,esc,searchMatch,site,cellChanged=()=>{},canEdit=()=>true}){
const dirtySheetCells=new Set();
const sheetTitleDrafts=new Map();
let normalizedBook=null;
let cachedSheet=null;
const totals=new Map();
function visibleSheetRows(sheet){const q=String(ui.notesSheetSearchValue||'').trim(),rows=sheet.rows||[];if(!q)return rows;return rows.filter(row=>searchMatch(q,(sheet.columns||[]).map(c=>row.cells?.[c.id]??''),[row.createdAt,row.updatedAt]))}
function ensureWorkbook(){if(!normalizedBook||normalizedBook!==model.state.notesSheet)model.state.notesSheet=normalizedBook=normalizeNotesSheet(model.state.notesSheet);return normalizedBook}
function activeSheetData(){
  const book=ensureWorkbook();let meta=book.sheets.find(sheet=>sheet.id===ui.notesSheetId)||book.sheets[0];
  ui.notesSheetId=meta.id;
  if(cachedSheet?.book===book&&cachedSheet.sheetId===meta.id&&cachedSheet.rowSource===book.rows&&cachedSheet.colSource===book.columns&&cachedSheet.rowCount===book.rows.length&&cachedSheet.colCount===book.columns.length)return cachedSheet;
  const rows=book.rows.filter(row=>row.sheetId===meta.id),columns=book.columns.filter(column=>column.sheetId===meta.id);
  cachedSheet={book,meta,sheetId:meta.id,columns,rows,rowSource:book.rows,colSource:book.columns,rowCount:book.rows.length,colCount:book.columns.length,rowMap:new Map(rows.map(row=>[row.id,row])),colMap:new Map(columns.map(column=>[column.id,column]))};
  totals.clear();return cachedSheet;
}
function columnTotal(sheet,id){if(!totals.has(id))totals.set(id,sheet.rows.reduce((sum,row)=>sum+(sheetNumericValue(row.cells?.[id])??0),0));return totals.get(id)}
function showSheetRow(rowId){const rows=visibleSheetRows(activeSheetData()),index=rows.findIndex(row=>row.id===rowId);ui.notesSheetPage=rows.length>SHEET_RENDER_THRESHOLD?Math.floor(Math.max(0,index)/SHEET_PAGE_SIZE):0}
function setSheetPage(page){ui.notesSheetPage=Math.max(0,Number(page)||0);renderNotes();document.querySelector('.notes-sheet-scroll')?.scrollTo?.({top:0})}
function setNotesWorkspaceTab(tab){ui.notesTab=tab==='notes'?'notes':'sheet';renderNotes()}
function setActiveNotesSheet(id){const book=ensureWorkbook(),target=book.sheets.find(sheet=>sheet.id===id);if(!target)return;ui.notesSheetId=target.id;ui.notesSheetSearchValue='';ui.notesSheetPage=0;renderNotes()}
function nextSheetName(book){let n=book.sheets.length+1,names=new Set(book.sheets.map(sheet=>sheet.name));while(names.has(`גליון ${n}`))n++;return `גליון ${n}`}
function addNotesSheet(){if(!canEdit())return;
  const book=ensureWorkbook(),id=uid('SHEET'),name=nextSheetName(book);book.sheets.push({id,name});
  for(let i=0;i<5;i++)book.columns.push({id:uid('SHEETCOL'),sheetId:id,title:`עמודה ${i+1}`,type:'text',width:NOTES_SHEET_DEFAULT_WIDTH});
  ui.notesSheetId=id;ui.notesSheetSearchValue='';saveState('גליון חדש נוסף');renderNotes();
  requestAnimationFrame(()=>{const input=document.querySelector('.notes-sheet-name-input');input?.focus();input?.select?.()});
}
function renameNotesSheet(el){if(!canEdit())return;
  const {meta}=activeSheetData(),name=String(el?.value||'').trim()||meta.name;if(meta.name===name){if(el)el.value=name;return}meta.name=name;if(el)el.value=name;saveState('שם הגליון עודכן');
  // Keep the button receiving the pending click mounted when this input blurs.
  for(const tab of document.querySelectorAll('[data-action="set-active-notes-sheet"]'))if(tab.dataset.clickArg0===meta.id)tab.textContent=name;
}

async function deleteNotesSheet(id){if(!canEdit())return;
  const initial=ensureWorkbook(),meta=initial.sheets.find(sheet=>sheet.id===id);if(!meta)return;
  if(!await confirmDialog('מחיקת גליון',`למחוק את הגליון „${meta.name}” עם כל השורות והעמודות שלו?`,{confirmText:'מחק גליון'}))return;
  // Re-read after the dialog: synchronization may have replaced the state meanwhile.
  const book=ensureWorkbook(),index=book.sheets.findIndex(sheet=>sheet.id===id);if(index<0)return;
  const rows=book.rows.filter(row=>row.sheetId===id).map(row=>row.id),columns=book.columns.filter(column=>column.sheetId===id).map(column=>column.id);
  book.sheets.splice(index,1);book.rows=book.rows.filter(row=>row.sheetId!==id);book.columns=book.columns.filter(column=>column.sheetId!==id);
  for(const key of dirtySheetCells)if(rows.includes(key.split('\u0000')[0]))dirtySheetCells.delete(key);
  for(const columnId of columns)sheetTitleDrafts.delete(columnId);
  if(!book.sheets.length){
    const replacementId=uid('SHEET');book.sheets.push({id:replacementId,name:'גליון 1'});
    for(let i=0;i<5;i++)book.columns.push({id:uid('SHEETCOL'),sheetId:replacementId,title:`עמודה ${i+1}`,type:'text',width:NOTES_SHEET_DEFAULT_WIDTH});
  }
  if(ui.notesSheetId===id){ui.notesSheetId=book.sheets[Math.min(index,book.sheets.length-1)].id;ui.notesSheetSearchValue=''}
  saveState('הגליון נמחק',{deleteIntents:{'notesSheet.sheets':[id],'notesSheet.rows':rows,'notesSheet.columns':columns},mutationType:'bulk-delete',surface:site+'.delete.notesSheet.sheets'});renderNotes();
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
  if(total)total.textContent=formatSheetNumber(columnTotal(sheet,columnId));
}

function addSheetRow(afterId=''){if(!canEdit())return;
  const sheet=activeSheetData(),now=new Date().toISOString(),row={id:uid('SHEETROW'),sheetId:sheet.sheetId,cells:{},createdAt:now,updatedAt:now};
  if(afterId){const absolute=sheet.book.rows.findIndex(x=>x.id===afterId&&x.sheetId===sheet.sheetId);if(absolute>=0)sheet.book.rows.splice(absolute+1,0,row);else sheet.book.rows.push(row)}else sheet.book.rows.push(row);
  ui.notesSheetSearchValue='';showSheetRow(row.id);saveState('שורה חדשה נוספה לגליון');renderNotes();
  requestAnimationFrame(()=>document.querySelector(`[data-sheet-row-id="${row.id}"] [data-sheet-cell]`)?.focus());
}

function updateSheetCell(rowId,columnId,el){if(!canEdit())return;
  const sheet=activeSheetData(),row=sheet.rowMap.get(rowId),column=sheet.colMap.get(columnId);if(!row||!column)return;
  const value=String(el.value??'');if(String(row.cells?.[columnId]??'')===value)return;
  if(totals.has(columnId))totals.set(columnId,totals.get(columnId)-(sheetNumericValue(row.cells?.[columnId])??0)+(sheetNumericValue(value)??0));
  row.cells=row.cells&&typeof row.cells==='object'?row.cells:{};row.cells[columnId]=value;row.updatedAt=new Date().toISOString();dirtySheetCells.add(sheetCellKey(rowId,columnId));refreshSheetColumnTotal(columnId);cellChanged(rowId,columnId,value,row.updatedAt);
}

function saveSheetCell(rowId,columnId,el){updateSheetCell(rowId,columnId,el);const key=sheetCellKey(rowId,columnId);if(!dirtySheetCells.has(key))return;dirtySheetCells.delete(key);saveState('תא בגליון עודכן')}

function updateSheetColumnTitleDraft(id,el){if(!canEdit())return;const sheet=activeSheetData();if(!sheet.columns.some(x=>x.id===id))return;sheetTitleDrafts.set(id,String(el.value??''))}

function handleSheetCellKeydown(rowId,columnId,el,event){
  if(event?.isComposing||event?.altKey||event?.ctrlKey||event?.metaKey)return;
  const key=event?.key;
  if(key==='F2'){event.preventDefault();el?.setSelectionRange?.(el.value.length,el.value.length);return}
  if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter','Tab'].includes(key))return;
  // Horizontal arrows remain caret controls while editing a partially selected cell.
  if(['ArrowLeft','ArrowRight'].includes(key)&&el&&!(el.selectionStart===0&&el.selectionEnd===el.value.length))return;
  const sheet=activeSheetData(),rows=visibleSheetRows(sheet),rowIndex=rows.findIndex(x=>x.id===rowId),columnIndex=sheet.columns.findIndex(x=>x.id===columnId);if(rowIndex<0||columnIndex<0)return;
  let nextRow=rowIndex,nextColumn=columnIndex;
  if(key==='ArrowUp'||key==='Enter'&&event.shiftKey)nextRow--;
  if(key==='ArrowDown'||key==='Enter'&&!event.shiftKey)nextRow++;
  if(key==='ArrowLeft')nextColumn++;if(key==='ArrowRight')nextColumn--;
  if(key==='Tab'){nextColumn+=event.shiftKey?-1:1;if(nextColumn>=sheet.columns.length){nextColumn=0;nextRow++}if(nextColumn<0){nextColumn=sheet.columns.length-1;nextRow--}}
  if(nextRow===rows.length&&['Enter','Tab'].includes(key)&&!ui.notesSheetSearchValue){
    event.preventDefault();if(el)saveSheetCell(rowId,columnId,el);addSheetRow();
    requestAnimationFrame(()=>{const row=activeSheetData().rows.at(-1),target=findSheetCell(row.id,sheet.columns[nextColumn].id);target?.focus();target?.select()});return;
  }
  if(nextRow<0||nextRow>=rows.length||nextColumn<0||nextColumn>=sheet.columns.length)return;
  event.preventDefault?.();let target=findSheetCell(rows[nextRow].id,sheet.columns[nextColumn].id);
  if(!target){if(el)saveSheetCell(rowId,columnId,el);showSheetRow(rows[nextRow].id);renderNotes();target=findSheetCell(rows[nextRow].id,sheet.columns[nextColumn].id)}
  target?.focus?.();target?.select?.();
}

async function deleteSheetRow(id){if(!canEdit())return;
  let sheet=activeSheetData();if(!sheet.rows.some(x=>x.id===id))return;
  if(!await confirmDialog('מחיקת שורה','למחוק את השורה הזו מהגליון?',{confirmText:'מחק שורה'}))return;
  sheet=activeSheetData();if(!sheet.rows.some(x=>x.id===id))return;
  sheet.book.rows=sheet.book.rows.filter(x=>x.id!==id);for(const key of dirtySheetCells)if(key.startsWith(`${id}\u0000`))dirtySheetCells.delete(key);saveState('שורה נמחקה מהגליון',{deleteIntents:{'notesSheet.rows':[id]},mutationType:'delete',surface:site+'.delete.notesSheet.rows'});renderNotes();
}

function addSheetColumn(){if(!canEdit())return;
  const sheet=activeSheetData(),used=new Set(sheet.columns.map(x=>x.title));let n=sheet.columns.length+1;while(used.has(`עמודה ${n}`))n++;
  const column={id:uid('SHEETCOL'),sheetId:sheet.sheetId,title:`עמודה ${n}`,type:'text',width:NOTES_SHEET_DEFAULT_WIDTH};sheet.book.columns.push(column);saveState('עמודה חדשה נוספה לגליון');renderNotes();
  requestAnimationFrame(()=>document.querySelector(`[data-sheet-column-id="${column.id}"] .notes-sheet-title-input`)?.select());
}

function renameSheetColumn(id,el){if(!canEdit())return;
  const sheet=activeSheetData(),column=sheet.book.columns.find(x=>x.id===id&&x.sheetId===sheet.sheetId);if(!column)return;
  const raw=sheetTitleDrafts.has(id)?sheetTitleDrafts.get(id):String(el.value??'');sheetTitleDrafts.delete(id);const title=String(raw||'').trim()||'עמודה';if(column.title===title){el.value=title;return}column.title=title;el.value=title;saveState('כותרת עמודה עודכנה');
}

function setSheetColumnNumeric(id,checked){if(!canEdit())return;const sheet=activeSheetData(),column=sheet.book.columns.find(x=>x.id===id&&x.sheetId===sheet.sheetId);if(!column)return;const type=checked?'number':'text';if(column.type===type)return;column.type=type;saveState('סוג עמודה עודכן');renderNotes()}

async function deleteSheetColumn(id){if(!canEdit())return;
  let sheet=activeSheetData();const column=sheet.columns.find(x=>x.id===id);if(!column||sheet.columns.length<=1)return;
  if(!await confirmDialog('מחיקת עמודה',`למחוק את העמודה „${column.title}” ואת התוכן שבה?`,{confirmText:'מחק עמודה'}))return;
  sheet=activeSheetData();if(!sheet.columns.some(x=>x.id===id)||sheet.columns.length<=1)return;
  sheet.book.columns=sheet.book.columns.filter(x=>x.id!==id);for(const row of sheet.book.rows.filter(x=>x.sheetId===sheet.sheetId))if(row.cells)delete row.cells[id];for(const key of dirtySheetCells)if(key.endsWith(`\u0000${id}`))dirtySheetCells.delete(key);sheetTitleDrafts.delete(id);saveState('עמודה נמחקה מהגליון',{deleteIntents:{'notesSheet.columns':[id]},mutationType:'delete',surface:site+'.delete.notesSheet.columns'});renderNotes();
}

function pasteSheetCells(el,event){if(!canEdit())return;
  const text=event.clipboardData?.getData('text/plain');if(!text||!/[\t\r\n]/.test(text))return;
  const values=parseSheetClipboard(text),sheet=activeSheetData(),rows=visibleSheetRows(sheet);
  const r=rows.findIndex(row=>row.id===el.dataset.sheetRowId),c=sheet.columns.findIndex(column=>column.id===el.dataset.sheetColumnId);
  if(r<0||c<0)return;
  event.preventDefault();const width=Math.max(...values.map(row=>row.length)),now=new Date().toISOString();
  while(sheet.columns.length<c+width){const column={id:uid('SHEETCOL'),sheetId:sheet.sheetId,title:`עמודה ${sheet.columns.length+1}`,type:'text',width:NOTES_SHEET_DEFAULT_WIDTH};sheet.columns.push(column);sheet.book.columns.push(column)}
  while(rows.length<r+values.length){const row={id:uid('SHEETROW'),sheetId:sheet.sheetId,cells:{},createdAt:now,updatedAt:now};rows.push(row);sheet.book.rows.push(row)}
  values.forEach((line,y)=>line.forEach((value,x)=>{const row=rows[r+y],column=sheet.columns[c+x];row.cells[column.id]=value;row.updatedAt=now;dirtySheetCells.delete(sheetCellKey(row.id,column.id))}));
  totals.clear();saveState('טווח התאים הודבק');renderNotes();
  requestAnimationFrame(()=>{const target=findSheetCell(rows[r].id,sheet.columns[c].id);target?.focus();target?.select()});
}

function bindSheetColumnResizeHandles(){
  document.querySelectorAll('[data-sheet-cell]').forEach(cell=>cell.addEventListener('paste',event=>pasteSheetCells(cell,event)));
  document.querySelectorAll('[data-sheet-resize-column]').forEach(handle=>handle.addEventListener('pointerdown',event=>{
    if(event.button!==undefined&&event.button!==0)return;
    const sheet=activeSheetData(),id=handle.dataset.sheetResizeColumn,column=sheet.book.columns.find(x=>x.id===id&&x.sheetId===sheet.sheetId);if(!column)return;
    event.preventDefault();const startX=event.clientX,startWidth=column.width,col=[...document.querySelectorAll('col[data-sheet-col]')].find(x=>x.dataset.sheetCol===id);let finalWidth=startWidth;
    handle.classList.add('dragging');handle.setPointerCapture?.(event.pointerId);
    const move=e=>{finalWidth=clampNotesSheetWidth(startWidth+(startX-e.clientX));if(col)col.style.width=finalWidth+'px'};
    const finish=()=>{document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',finish);document.removeEventListener('pointercancel',finish);handle.classList.remove('dragging');const current=ensureWorkbook().columns.find(c=>c.id===id);if(!current||finalWidth===current.width)return;current.width=finalWidth;saveState('רוחב עמודה עודכן')};
    document.addEventListener('pointermove',move);document.addEventListener('pointerup',finish,{once:true});document.addEventListener('pointercancel',finish,{once:true});
  }));
}

function sheetTabs(){const tabs={sheet:`<button class="notes-tab ${ui.notesTab==='sheet'?'active':''}" role="tab" aria-selected="${ui.notesTab==='sheet'?'true':'false'}" data-action="notes-workspace-sheet">גליון</button>`,notes:`<button class="notes-tab ${ui.notesTab==='sheet'?'':'active'}" role="tab" aria-selected="${ui.notesTab==='sheet'?'false':'true'}" data-action="notes-workspace-notes">הערות</button>`};return `<div class="notes-tabs" role="tablist" aria-label="תצוגת הערות">${site==='orders'?tabs.notes+tabs.sheet:tabs.sheet+tabs.notes}</div>`}

function workbookTabsMarkup(sheet){
  const tabs=sheet.book.sheets.map(tab=>`<button type="button" class="notes-sheet-book-tab ${tab.id===sheet.sheetId?'active':''}" role="tab" aria-selected="${tab.id===sheet.sheetId}" data-action="set-active-notes-sheet" data-click-arg0="${esc(tab.id)}">${esc(tab.name)}</button>`).join('');
  return `<div class="notes-sheet-workbook-bar"><div class="notes-sheet-book-tabs" role="tablist" aria-label="גיליונות">${tabs}<button type="button" class="notes-sheet-book-add" data-action="add-notes-sheet" title="הוסף גליון" aria-label="הוסף גליון">＋</button></div><div class="notes-sheet-manage"><label class="notes-sheet-name"><span>שם הגליון</span><input class="notes-sheet-name-input" value="${esc(sheet.meta.name)}" data-blur="rename-notes-sheet"></label><button type="button" class="btn danger small" data-action="delete-notes-sheet" data-click-arg0="${esc(sheet.sheetId)}" aria-label="מחק את הגליון ${esc(sheet.meta.name)}">מחק גליון</button></div></div>`;
}

function sheetMarkup(){
  const sheet=activeSheetData(),cols=sheet.columns,allRows=visibleSheetRows(sheet),paged=allRows.length>SHEET_RENDER_THRESHOLD;
  const pages=paged?Math.ceil(allRows.length/SHEET_PAGE_SIZE):1,page=Math.min(pages-1,Math.max(0,Number(ui.notesSheetPage)||0));ui.notesSheetPage=page;
  const rows=paged?allRows.slice(page*SHEET_PAGE_SIZE,(page+1)*SHEET_PAGE_SIZE):allRows;
  const colgroup='<col class="notes-sheet-index-col">'+cols.map(c=>`<col data-sheet-col="${esc(c.id)}" style="width:${esc(c.width)}px">`).join('')+'<col class="notes-sheet-actions-col">';
  const headers=cols.map((c,index)=>`<th data-sheet-column-id="${esc(c.id)}"><div class="notes-sheet-column-letter">${sheetColumnLabel(index)}</div><div class="notes-sheet-column-head"><input class="notes-sheet-title-input" aria-label="שם עמודה" value="${esc(c.title)}" data-sheet-column-id="${esc(c.id)}" data-input="draft-notes-sheet-column-title" data-input-arg0="${esc(c.id)}" data-blur="rename-notes-sheet-column" data-blur-arg0="${esc(c.id)}"><label class="notes-sheet-sum-toggle" title="חשב סה״כ בתחתית העמודה"><input type="checkbox" ${c.type==='number'?'checked':''} data-change="set-notes-sheet-column-numeric" data-change-arg0="${esc(c.id)}"><span>סכום</span></label>${cols.length>1?`<button class="notes-sheet-column-delete" title="מחק עמודה" aria-label="מחק עמודה ${esc(c.title)}" data-action="delete-notes-sheet-column" data-click-arg0="${esc(c.id)}">×</button>`:''}</div><span class="notes-sheet-resizer" data-sheet-resize-column="${esc(c.id)}" title="גרור לשינוי רוחב"></span></th>`).join('');
  const rowNumbers=new Map(sheet.rows.map((row,index)=>[row.id,index+1]));
  const body=rows.map(row=>`<tr data-sheet-row-id="${esc(row.id)}"><th scope="row" class="notes-sheet-row-index">${rowNumbers.get(row.id)}</th>${cols.map((c,index)=>`<td><textarea rows="1" aria-label="${sheetColumnLabel(index)}${rowNumbers.get(row.id)} · ${esc(c.title)}" autocomplete="off" spellcheck="false" data-sheet-cell data-sheet-row-id="${esc(row.id)}" data-sheet-column-id="${esc(c.id)}" class="notes-sheet-cell ${c.type==='number'?'numeric':''}" inputmode="${c.type==='number'?'decimal':'text'}" data-input="update-notes-sheet-cell" data-input-arg0="${esc(row.id)}" data-input-arg1="${esc(c.id)}" data-blur="save-notes-sheet-cell" data-blur-arg0="${esc(row.id)}" data-blur-arg1="${esc(c.id)}" data-keydown="navigate-notes-sheet-cell" data-keydown-arg0="${esc(row.id)}" data-keydown-arg1="${esc(c.id)}">${esc(row.cells?.[c.id]??'')}</textarea></td>`).join('')}<td class="notes-sheet-row-actions"><button class="notes-sheet-row-add" title="הוסף שורה אחרי שורה זו" aria-label="הוסף שורה" data-action="add-notes-sheet-row-after" data-click-arg0="${esc(row.id)}">＋</button><button class="notes-sheet-row-delete" title="מחק שורה" aria-label="מחק שורה" data-action="delete-notes-sheet-row" data-click-arg0="${esc(row.id)}">×</button></td></tr>`).join('');
  const searching=String(ui.notesSheetSearchValue||'').trim(),empty=!rows.length?`<tr class="notes-sheet-empty-row"><td colspan="${cols.length+2}">${searching?'אין שורות המתאימות לחיפוש.':'אין עדיין שורות. לחץ על „+ שורה” כדי להתחיל.'}</td></tr>`:'';
  const totals=cols.map(c=>`<td ${c.type==='number'?`data-sheet-total-column="${esc(c.id)}"`:''} class="${c.type==='number'?'notes-sheet-total-cell':''}">${c.type==='number'?`<span>סה״כ</span><b>${esc(formatSheetNumber(columnTotal(sheet,c.id)))}</b>`:''}</td>`).join('');
  const paging=paged?`<div class="notes-sheet-pagination"><button class="btn small" data-action="notes-sheet-page" data-click-arg0="${page-1}" ${page===0?'disabled':''}>הקודם</button><span>שורות ${page*SHEET_PAGE_SIZE+1}–${Math.min(allRows.length,(page+1)*SHEET_PAGE_SIZE)} מתוך ${allRows.length}</span><button class="btn small" data-action="notes-sheet-page" data-click-arg0="${page+1}" ${page===pages-1?'disabled':''}>הבא</button></div>`:'';
  return `<section class="notes-sheet-panel"><div class="notes-sheet-scroll"><table class="notes-sheet-table" aria-label="${esc(sheet.meta.name)}"><colgroup>${colgroup}</colgroup><thead><tr><th class="notes-sheet-corner" aria-label="מספר שורה">#</th>${headers}<th class="notes-sheet-actions-head"><button title="הוסף שורה" aria-label="הוסף שורה" data-action="add-notes-sheet-row">＋</button></th></tr></thead><tbody>${body}${empty}</tbody><tfoot><tr><td class="notes-sheet-row-index">Σ</td>${totals}<td></td></tr></tfoot></table></div><div class="notes-sheet-status"><span>${sheet.rows.length} שורות · ${cols.length} עמודות</span><span>Tab מעבר בין תאים · Enter לשורה הבאה · F2 עריכת טקסט · הדבקה מאקסל</span><span>Σ סיכום כל השורות בעמודה</span></div>${paging}${workbookTabsMarkup(sheet)}</section>`;
}


return {setNotesWorkspaceTab,setActiveNotesSheet,addNotesSheet,renameNotesSheet,deleteNotesSheet,addSheetRow,updateSheetCell,saveSheetCell,updateSheetColumnTitleDraft,handleSheetCellKeydown,deleteSheetRow,addSheetColumn,renameSheetColumn,setSheetColumnNumeric,deleteSheetColumn,activeSheetData,sheetTabs,sheetMarkup,captureSheetInteraction,restoreSheetInteraction,bindSheetColumnResizeHandles,sheetActions:{
  'notes-sheet-page':element=>setSheetPage(element.dataset.clickArg0),
  'notes-workspace-notes':(element,event)=>{setNotesWorkspaceTab('notes')},
  'notes-workspace-sheet':(element,event)=>{setNotesWorkspaceTab('sheet')},
  'set-active-notes-sheet':(element,event)=>{setActiveNotesSheet(element.dataset.clickArg0)},
  'add-notes-sheet':(element,event)=>{addNotesSheet()},
  'delete-notes-sheet':(element,event)=>{deleteNotesSheet(element.dataset.clickArg0)},
  'rename-notes-sheet':(element,event)=>{renameNotesSheet(element)},
  'add-notes-sheet-row':(element,event)=>{addSheetRow()},
  'add-notes-sheet-row-after':(element,event)=>{addSheetRow(element.dataset.clickArg0)},
  'update-notes-sheet-cell':(element,event)=>{updateSheetCell(element.dataset.inputArg0,element.dataset.inputArg1,element)},
  'save-notes-sheet-cell':(element,event)=>{saveSheetCell(element.dataset.blurArg0,element.dataset.blurArg1,element)},
  'navigate-notes-sheet-cell':(element,event)=>{handleSheetCellKeydown(element.dataset.keydownArg0,element.dataset.keydownArg1,element,event)},
  'delete-notes-sheet-row':(element,event)=>{deleteSheetRow(element.dataset.clickArg0)},
  'add-notes-sheet-column':(element,event)=>{addSheetColumn()},
  'draft-notes-sheet-column-title':(element,event)=>{updateSheetColumnTitleDraft(element.dataset.inputArg0,element)},
  'rename-notes-sheet-column':(element,event)=>{renameSheetColumn(element.dataset.blurArg0,element)},
  'set-notes-sheet-column-numeric':(element,event)=>{setSheetColumnNumeric(element.dataset.changeArg0,element.checked)},
  'delete-notes-sheet-column':(element,event)=>{deleteSheetColumn(element.dataset.clickArg0)},
}};
}
