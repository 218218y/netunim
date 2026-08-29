import {esc} from '../core/values.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createUiBulk({ui, model, render, saveState, saveChecksState, toast, confirmDialog}){
function bulkModeFor(collection){return ui.bulkCollection===collection}

function toggleBulkMode(collection){if(ui.bulkCollection===collection){ui.bulkCollection=null;ui.bulkSelected.clear()}else{ui.bulkCollection=collection;ui.bulkSelected.clear()}render()}

function toggleBulkRow(collection,id,checked){if(!bulkModeFor(collection))return;if(!model.state[collection]?.some(x=>x.id===id))return;if(checked)ui.bulkSelected.add(id);else ui.bulkSelected.delete(id);syncBulkUi(collection)}

function visibleBulkIds(collection){return [...document.querySelectorAll(`[data-bulk-collection="${CSS.escape(String(collection))}"][data-bulk-id]`)].map(row=>row.dataset.bulkId).filter(Boolean)}

function toggleBulkVisible(collection,checked){if(!bulkModeFor(collection))return;const ids=visibleBulkIds(collection);ids.forEach(id=>checked?ui.bulkSelected.add(id):ui.bulkSelected.delete(id));document.querySelectorAll(`[data-bulk-collection="${CSS.escape(String(collection))}"][data-bulk-id] .bulk-check`).forEach(cb=>cb.checked=checked);syncBulkUi(collection)}

function syncBulkUi(collection){
  if(!bulkModeFor(collection))return;
  const valid=new Set((model.state[collection]||[]).map(x=>x.id));[...ui.bulkSelected].forEach(id=>{if(!valid.has(id))ui.bulkSelected.delete(id)});
  const del=document.getElementById(`bulkDelete-${collection}`);if(del){del.disabled=!ui.bulkSelected.size;del.textContent=ui.bulkSelected.size?`מחק ${ui.bulkSelected.size}`:'מחק נבחרים'}
  const visible=visibleBulkIds(collection),selectedVisible=visible.filter(id=>ui.bulkSelected.has(id)).length;
  document.querySelectorAll(`[data-bulk-all="${CSS.escape(String(collection))}"]`).forEach(head=>{head.checked=visible.length>0&&selectedVisible===visible.length;head.indeterminate=selectedVisible>0&&selectedVisible<visible.length});
  document.querySelectorAll(`[data-bulk-collection="${CSS.escape(String(collection))}"][data-bulk-id]`).forEach(row=>row.classList.toggle('bulk-selected-row',ui.bulkSelected.has(row.dataset.bulkId)));
}

function bulkControls(collection){
  const active=bulkModeFor(collection);
  return `<button class="btn small bulk-select-toggle ${esc(active?'active':'')}" data-action="toggle-bulk-mode" data-click-arg0="${esc(collection)}">${active?'סיום בחירה':'בחירה'}</button>${active?`<button id="bulkDelete-${esc(collection)}" class="btn danger small bulk-delete-btn" data-action="delete-bulk-selected" data-click-arg0="${esc(collection)}" disabled>מחק נבחרים</button>`:''}`;
}

function bulkHeader(collection){return bulkModeFor(collection)?`<th class="bulk-check-col"><input class="bulk-check" type="checkbox" data-bulk-all="${esc(collection)}" title="בחר את כל השורות המוצגות" data-change="toggle-bulk-visible" data-change-arg0="${esc(collection)}"></th>`:''}

function bulkCell(collection,id){return bulkModeFor(collection)?`<td class="bulk-check-col"><input class="bulk-check" type="checkbox" ${ui.bulkSelected.has(id)?'checked':''} aria-label="בחר רשומה" data-change="toggle-bulk-row" data-change-arg0="${esc(collection)}" data-change-arg1="${esc(id)}"></td>`:''}

async function deleteBulkSelected(collection){
  if(!['checks','credits','cash'].includes(collection))return;
  const ids=[...ui.bulkSelected].filter(id=>(model.state[collection]||[]).some(x=>x.id===id));
  if(!ids.length)return toast('לא נבחרו רשומות למחיקה');
  const labels={checks:'צקים',credits:'עסקאות אשראי',cash:'תנועות מזומן'};
  if(!await confirmDialog('מחיקת רשומות',`למחוק ${ids.length} ${labels[collection]} שנבחרו?\n\nהמחיקה תישמר במקור הנתונים ולא ניתן לבטל אותה מתוך המסך.`,{confirmText:`מחק ${ids.length}`,cancelText:'ביטול',tone:'danger'}))return;
  const set=new Set(ids);model.state[collection]=model.state[collection].filter(x=>!set.has(x.id));ui.bulkSelected.clear();if(collection==='checks')saveChecksState(`${ids.length} רשומות נמחקו`);else saveState(`${ids.length} רשומות נמחקו`);render()
}

return { bulkModeFor, toggleBulkMode, toggleBulkRow, visibleBulkIds, toggleBulkVisible, syncBulkUi, bulkControls, bulkHeader, bulkCell, deleteBulkSelected };
}
