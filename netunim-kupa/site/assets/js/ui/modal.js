import {esc} from '../core/values.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createUiModal({ui}){
let pendingDraftDismiss=false;
let activeConfirm=null;
const confirmQueue=[];
let returnFocus=null;

function modalFormSnapshot(){const root=document.getElementById('modal');if(!root)return '';return JSON.stringify([...root.querySelectorAll('input,select,textarea')].map(el=>({id:el.id||'',field:el.dataset.seriesField||'',type:el.type||'',value:el.value,checked:el.type==='checkbox'||el.type==='radio'?el.checked:null})))}

function armModalDraftGuard(message='הנתונים שהקלדת עדיין לא נשמרו. לצאת ולמחוק את הטיוטה?'){ui.modalDraftGuard={snapshot:modalFormSnapshot(),message}}

function modalHasUnsavedDraft(){return !!ui.modalDraftGuard&&modalFormSnapshot()!==ui.modalDraftGuard.snapshot}

function clearModalDraftGuard(){ui.modalDraftGuard=null}

function confirmationElements(){return {backdrop:document.getElementById('confirmBackdrop'),dialog:document.getElementById('confirmDialog'),icon:document.getElementById('confirmIcon'),title:document.getElementById('confirmTitle'),message:document.getElementById('confirmMessage'),accept:document.getElementById('confirmAccept'),cancel:document.getElementById('confirmCancel')}}

function focusableConfirmationElements(){const {dialog}=confirmationElements();if(!dialog)return[];return [...dialog.querySelectorAll('button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(el=>!el.hidden&&el.offsetParent!==null)}

function pumpConfirmQueue(){
  if(activeConfirm||!confirmQueue.length)return;
  const els=confirmationElements();
  if(!els.backdrop||!els.dialog||!els.title||!els.message||!els.accept||!els.cancel){const item=confirmQueue.shift();item.resolve(false);pumpConfirmQueue();return}
  activeConfirm=confirmQueue.shift();
  const {title,message,confirmText,cancelText,tone}=activeConfirm;
  returnFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
  els.title.textContent=title;
  els.message.textContent=message;
  els.accept.textContent=confirmText;
  els.cancel.textContent=cancelText;
  els.dialog.dataset.tone=tone;
  els.icon.textContent=tone==='primary'?'✓':'!';
  els.accept.className=`btn ${tone==='primary'?'primary':'danger'}`;
  els.backdrop.classList.add('open');
  els.backdrop.setAttribute('aria-hidden','false');
  requestAnimationFrame(()=>els.cancel.focus());
}

function settleConfirm(result){
  if(!activeConfirm)return;
  const els=confirmationElements(),item=activeConfirm;
  activeConfirm=null;
  els.backdrop?.classList.remove('open');
  els.backdrop?.setAttribute('aria-hidden','true');
  delete els.dialog?.dataset.tone;
  item.resolve(result);
  const focusTarget=returnFocus;
  returnFocus=null;
  requestAnimationFrame(()=>{if(focusTarget?.isConnected)focusTarget.focus();pumpConfirmQueue()});
}

function confirmDialog(title,message,{confirmText='אישור',cancelText='ביטול',tone='danger'}={}){
  return new Promise(resolve=>{confirmQueue.push({title:String(title||'אישור פעולה'),message:String(message||''),confirmText:String(confirmText||'אישור'),cancelText:String(cancelText||'ביטול'),tone:tone==='primary'?'primary':'danger',resolve});pumpConfirmQueue()})
}

function bindConfirmationUi(){
  const {backdrop,accept,cancel}=confirmationElements();
  if(!backdrop||!accept||!cancel||backdrop.dataset.bound==='1')return;
  backdrop.dataset.bound='1';
  accept.addEventListener('click',()=>settleConfirm(true));
  cancel.addEventListener('click',()=>settleConfirm(false));
  backdrop.addEventListener('click',event=>{if(event.target===backdrop)settleConfirm(false)});
  document.addEventListener('keydown',event=>{
    if(!activeConfirm)return;
    if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();settleConfirm(false);return}
    if(event.key!=='Tab')return;
    const focusable=focusableConfirmationElements();if(!focusable.length)return;
    const first=focusable[0],last=focusable.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
  })
}

function modal(title,body,saveLabel,saveFn,deleteFn){clearModalDraftGuard();document.getElementById('modal').innerHTML=`<div class="modal-head"><h3>${esc(title)}</h3><button class="close" data-action="close-modal" type="button" aria-label="סגירה">×</button></div><div class="modal-body">${body}</div><div class="modal-foot"><button class="btn primary" data-modal-save type="button">${esc(saveLabel)}</button><button class="btn" data-action="close-modal" type="button">ביטול</button>${deleteFn?`<button class="btn danger" style="margin-right:auto" data-modal-delete type="button">מחיקה</button>`:''}</div>`;document.querySelector('[data-modal-save]').addEventListener('click',saveFn);if(deleteFn)document.querySelector('[data-modal-delete]').addEventListener('click',deleteFn);const backdrop=document.getElementById('modalBackdrop');backdrop.classList.add('open');backdrop.setAttribute('aria-hidden','false')}

function closeModal(force=false){
  if(!force&&modalHasUnsavedDraft()){
    if(pendingDraftDismiss)return false;
    pendingDraftDismiss=true;
    confirmDialog('לצאת בלי לשמור?',ui.modalDraftGuard.message,{confirmText:'צא בלי לשמור',cancelText:'המשך עריכה',tone:'danger'})
      .then(leave=>{if(leave)closeModal(true)})
      .finally(()=>{pendingDraftDismiss=false});
    return false;
  }
  clearModalDraftGuard();
  const backdrop=document.getElementById('modalBackdrop');
  backdrop.classList.remove('open');
  backdrop.setAttribute('aria-hidden','true');
  return true;
}

bindConfirmationUi();
return { modalFormSnapshot, armModalDraftGuard, modalHasUnsavedDraft, clearModalDraftGuard, modal, closeModal, confirmDialog };
}
