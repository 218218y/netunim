import {supplierSortValue} from './model.js';
import {esc} from '../../core/values.js';
import {$} from '../../state/constants.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsSuppliersOrder({model, supplierUi, ui, modal, scheduleSave, render, renderSupplier, closeModal}){
function openSupplierOrderModal(){supplierUi.supplierOrderDraft=[...model.state.suppliers].sort((a,b)=>supplierSortValue(a)-supplierSortValue(b)||a.name.localeCompare(b.name,'he')).map(s=>s.id);modal('סידור ספקים',`<div class="notice supplier-order-help">גרור ספק למיקום הרצוי, או השתמש בחיצים. הסדר נשמר גם לאחר רענון וסנכרון.</div><div id="supplierOrderList" class="supplier-order-list"></div>`,`<button class="btn primary" data-action="save-supplier-order">שמור סדר</button><button class="btn" data-action="close-modal">ביטול</button>`);renderSupplierOrderList()}

function renderSupplierOrderList(){const el=$('#supplierOrderList');if(!el)return;el.innerHTML=supplierUi.supplierOrderDraft.map((id,i)=>{const sp=model.state.suppliers.find(s=>s.id===id);return `<div class="supplier-order-row" draggable="true" data-id="${esc(id)}" data-dragstart="supplier-order-drag-start" data-dragstart-arg0="${esc(id)}" data-dragover="allow-drop" data-drop="supplier-order-drop" data-drop-arg0="${esc(id)}" data-dragend="end-drag"><div class="supplier-order-handle" title="גרור לשינוי סדר">⋮⋮</div><div class="supplier-order-name">${i+1}. ${esc(sp?.name||'ספק')}</div><div class="supplier-order-actions"><button class="icon-btn" ${i===0?'disabled':''} data-action="move-supplier-order" data-click-arg0="${esc(id)}" title="העבר למעלה">↑</button><button class="icon-btn" ${i===supplierUi.supplierOrderDraft.length-1?'disabled':''} data-action="move-supplier-order-2" data-click-arg0="${esc(id)}" title="העבר למטה">↓</button></div></div>`}).join('')}

function moveSupplierOrder(id,delta){const i=supplierUi.supplierOrderDraft.indexOf(id),j=i+delta;if(i<0||j<0||j>=supplierUi.supplierOrderDraft.length)return;[supplierUi.supplierOrderDraft[i],supplierUi.supplierOrderDraft[j]]=[supplierUi.supplierOrderDraft[j],supplierUi.supplierOrderDraft[i]];renderSupplierOrderList()}

function supplierOrderDragStart(ev,id,element){ev.dataTransfer.effectAllowed='move';ev.dataTransfer.setData('text/plain',id);element.classList.add('dragging')}

function supplierOrderDrop(ev,targetId){ev.preventDefault();const sourceId=ev.dataTransfer.getData('text/plain');if(!sourceId||sourceId===targetId)return;const from=supplierUi.supplierOrderDraft.indexOf(sourceId),to=supplierUi.supplierOrderDraft.indexOf(targetId);if(from<0||to<0)return;supplierUi.supplierOrderDraft.splice(from,1);supplierUi.supplierOrderDraft.splice(to,0,sourceId);renderSupplierOrderList()}

function saveSupplierOrder(){const index=new Map(supplierUi.supplierOrderDraft.map((id,i)=>[id,i]));model.state.suppliers.forEach((sp,i)=>sp.sortOrder=index.has(sp.id)?index.get(sp.id):supplierUi.supplierOrderDraft.length+i);closeModal();scheduleSave('סדר הספקים נשמר');if(ui.currentView==='supplier')renderSupplier({scrollMode:'auto'});else render()}

return { openSupplierOrderModal, renderSupplierOrderList, moveSupplierOrder, supplierOrderDragStart, supplierOrderDrop, saveSupplierOrder };
}
