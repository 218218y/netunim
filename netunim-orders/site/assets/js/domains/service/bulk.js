import {esc} from '../../core/values.js';
import {$} from '../../state/constants.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsServiceBulk({serviceUi, model, renderService, toast, scheduleSave, confirmDialog}){
function serviceVisibleBulkIds(){return [...document.querySelectorAll('[data-service-bulk-id]')].map(el=>el.dataset.serviceBulkId).filter(Boolean)}

function toggleServiceBulkMode(){serviceUi.serviceBulkMode=!serviceUi.serviceBulkMode;serviceUi.serviceBulkSelected.clear();renderService()}

function toggleServiceBulkRow(id,checked){if(!serviceUi.serviceBulkMode||!model.state.serviceCalls.some(x=>x.id===id))return;if(checked)serviceUi.serviceBulkSelected.add(id);else serviceUi.serviceBulkSelected.delete(id);syncServiceBulkUi()}

function toggleServiceBulkVisible(){if(!serviceUi.serviceBulkMode)return;const ids=serviceVisibleBulkIds(),allSelected=ids.length>0&&ids.every(id=>serviceUi.serviceBulkSelected.has(id));ids.forEach(id=>allSelected?serviceUi.serviceBulkSelected.delete(id):serviceUi.serviceBulkSelected.add(id));syncServiceBulkUi()}

function serviceBulkControls(){return `<div class="module-bulk-controls"><button class="btn small bulk-select-toggle ${esc(serviceUi.serviceBulkMode?'active':'')}" data-action="toggle-service-bulk-mode">${serviceUi.serviceBulkMode?'סיום בחירה':'בחירה'}</button>${serviceUi.serviceBulkMode?`<button id="serviceBulkAll" class="btn small bulk-select-all-btn" data-action="toggle-service-bulk-visible">בחר הכל</button><button id="serviceBulkDelete" class="btn danger small bulk-delete-btn" data-action="delete-selected-service-calls" disabled>מחק נבחרים</button>`:''}</div>`}

function syncServiceBulkUi(){if(!serviceUi.serviceBulkMode)return;const valid=new Set(model.state.serviceCalls.map(x=>x.id));[...serviceUi.serviceBulkSelected].forEach(id=>{if(!valid.has(id))serviceUi.serviceBulkSelected.delete(id)});const del=$('#serviceBulkDelete');if(del){del.disabled=!serviceUi.serviceBulkSelected.size;del.textContent=serviceUi.serviceBulkSelected.size?`מחק ${serviceUi.serviceBulkSelected.size}`:'מחק נבחרים'}const visible=serviceVisibleBulkIds(),all=visible.length>0&&visible.every(id=>serviceUi.serviceBulkSelected.has(id)),allBtn=$('#serviceBulkAll');if(allBtn)allBtn.textContent=all?'בטל הכל':'בחר הכל';document.querySelectorAll('[data-service-bulk-id]').forEach(card=>{const selected=serviceUi.serviceBulkSelected.has(card.dataset.serviceBulkId);card.classList.toggle('bulk-selected-card',selected);const cb=card.querySelector('[data-service-bulk-check]');if(cb)cb.checked=selected})}

async function deleteSelectedServiceCalls(){const valid=new Set(model.state.serviceCalls.map(x=>x.id)),ids=[...serviceUi.serviceBulkSelected].filter(id=>valid.has(id));if(!ids.length)return toast('לא נבחרו קריאות שירות למחיקה');if(!await confirmDialog('מחיקת קריאות שירות',`למחוק ${ids.length} קריאות שירות שנבחרו?\n\nהפעולה מוחקת את הקריאות עצמן, כפי שעושה כפתור המחיקה בעריכת קריאה.`,{confirmText:'מחק קריאות'}))return;const set=new Set(ids);model.state.serviceCalls=model.state.serviceCalls.filter(x=>!set.has(x.id));serviceUi.serviceBulkSelected.clear();scheduleSave(`${ids.length} קריאות שירות נמחקו`,{deleteIntents:{serviceCalls:ids},mutationType:'bulk-delete',surface:'orders.bulk.serviceCalls'});renderService()}

return { serviceVisibleBulkIds, toggleServiceBulkMode, toggleServiceBulkRow, toggleServiceBulkVisible, serviceBulkControls, syncServiceBulkUi, deleteSelectedServiceCalls };
}
