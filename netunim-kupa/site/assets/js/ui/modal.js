import {esc} from '../core/values.js';


// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createUiModal({ui}){
function modalFormSnapshot(){const root=document.getElementById('modal');if(!root)return '';return JSON.stringify([...root.querySelectorAll('input,select,textarea')].map(el=>({id:el.id||'',field:el.dataset.seriesField||'',type:el.type||'',value:el.value,checked:el.type==='checkbox'||el.type==='radio'?el.checked:null})))}

function armModalDraftGuard(message='הנתונים שהקלדת עדיין לא נשמרו. לצאת ולמחוק את הטיוטה?'){ui.modalDraftGuard={snapshot:modalFormSnapshot(),message}}

function modalHasUnsavedDraft(){return !!ui.modalDraftGuard&&modalFormSnapshot()!==ui.modalDraftGuard.snapshot}

function clearModalDraftGuard(){ui.modalDraftGuard=null}

function modal(title,body,saveLabel,saveFn,deleteFn){clearModalDraftGuard();document.getElementById('modal').innerHTML=`<div class="modal-head"><h3>${esc(title)}</h3><button class="close" data-action="close-modal">×</button></div><div class="modal-body">${body}</div><div class="modal-foot"><button class="btn primary" data-modal-save>${esc(saveLabel)}</button><button class="btn" data-action="close-modal">ביטול</button>${deleteFn?`<button class="btn danger" style="margin-right:auto" data-modal-delete>מחיקה</button>`:''}</div>`;document.querySelector('[data-modal-save]').addEventListener('click',saveFn);if(deleteFn)document.querySelector('[data-modal-delete]').addEventListener('click',deleteFn);document.getElementById('modalBackdrop').classList.add('open')}

function closeModal(force=false){if(!force&&modalHasUnsavedDraft()&&!confirm(ui.modalDraftGuard.message))return false;clearModalDraftGuard();document.getElementById('modalBackdrop').classList.remove('open');return true}

return { modalFormSnapshot, armModalDraftGuard, modalHasUnsavedDraft, clearModalDraftGuard, modal, closeModal };
}
