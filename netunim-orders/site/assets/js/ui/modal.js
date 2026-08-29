import {esc} from '../core/values.js';
import {$} from '../state/constants.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createUiModal({}){
let modalGeneration=0,modalBaseline=null,modalDraftReady=false,pendingDismiss=null;
const confirmQueue=[];
let activeConfirm=null,confirmPumpTimer=null;

function modalFieldState(){
  const root=$('#modal');
  if(!root)return'[]';
  return JSON.stringify({
    fields:[...root.querySelectorAll('input,select,textarea')]
      .filter(el=>!el.matches('[data-no-draft-guard]'))
      .map(el=>({tag:el.tagName,id:el.id||'',name:el.name||'',type:el.type||'',value:el.value,checked:'checked'in el?!!el.checked:null})),
    draftOrder:[...root.querySelectorAll('[data-modal-draft]')].map(el=>el.getAttribute('data-modal-draft')||''),
  });
}

function captureModalBaseline(generation){
  queueMicrotask(()=>{
    if(generation!==modalGeneration||!$('#modalBackdrop')?.classList.contains('open'))return;
    modalBaseline=modalFieldState();
    modalDraftReady=true;
  });
}

function modalHasUnsavedDraft(){
  return !!($('#modalBackdrop')?.classList.contains('open')&&modalDraftReady&&modalBaseline!==null&&modalFieldState()!==modalBaseline);
}

function modal(title,body,foot=''){
  const back=$('#modalBackdrop'),panel=$('#modal');
  modalGeneration++;
  modalBaseline=null;
  modalDraftReady=false;
  pendingDismiss=null;
  panel.innerHTML=`<div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" type="button" data-action="close-modal" aria-label="סגור">✕</button></div><div class="modal-body">${body}</div><div class="modal-foot">${foot}</div>`;
  back.classList.add('open');
  back.setAttribute('aria-hidden','false');
  captureModalBaseline(modalGeneration);
}

function closeModal(){
  modalGeneration++;
  modalBaseline=null;
  modalDraftReady=false;
  pendingDismiss=null;
  const back=$('#modalBackdrop');
  back?.classList.remove('open');
  back?.setAttribute('aria-hidden','true');
}

function confirmationElements(){
  return {
    back:$('#confirmBackdrop'),
    card:$('#confirmDialog'),
    title:$('#confirmTitle'),
    message:$('#confirmMessage'),
    accept:$('#confirmAccept'),
    cancel:$('#confirmCancel'),
    icon:$('#confirmIcon'),
  };
}

function pumpConfirmQueue(){
  if(activeConfirm||!confirmQueue.length)return;
  if(confirmPumpTimer){clearTimeout(confirmPumpTimer);confirmPumpTimer=null}
  const els=confirmationElements(),request=confirmQueue.shift();
  if(!els.back||!els.card||!els.title||!els.message||!els.accept||!els.cancel){
    request.resolve(false);
    queueMicrotask(pumpConfirmQueue);
    return;
  }
  activeConfirm={...request,returnFocus:document.activeElement instanceof HTMLElement?document.activeElement:null};
  const tone=request.options.tone==='primary'?'primary':'danger';
  els.card.dataset.tone=tone;
  els.title.textContent=request.title||'אישור פעולה';
  els.message.textContent=request.message||'';
  els.accept.textContent=request.options.confirmText||'אישור';
  els.cancel.textContent=request.options.cancelText||'ביטול';
  els.accept.className=`btn ${tone}`;
  if(els.icon)els.icon.textContent=tone==='danger'?'!':'?';
  els.back.classList.add('open');
  els.back.setAttribute('aria-hidden','false');
  requestAnimationFrame(()=>els.cancel?.focus());
}

function settleConfirmation(confirmed){
  if(!activeConfirm)return;
  const request=activeConfirm,els=confirmationElements();
  activeConfirm=null;
  els.back?.classList.remove('open');
  els.back?.setAttribute('aria-hidden','true');
  request.resolve(!!confirmed);
  const returnFocus=request.returnFocus;
  if(returnFocus?.isConnected)queueMicrotask(()=>returnFocus.focus());
  confirmPumpTimer=setTimeout(()=>{confirmPumpTimer=null;pumpConfirmQueue()},160);
}

function confirmDialog(title,message,options={}){
  return new Promise(resolve=>{
    confirmQueue.push({title:String(title??''),message:String(message??''),options,resolve});
    pumpConfirmQueue();
  });
}

async function performDismiss(){
  if(!$('#modalBackdrop')?.classList.contains('open'))return true;
  if(modalHasUnsavedDraft()){
    const leave=await confirmDialog('לצאת בלי לשמור?','יש שינויים בחלון שעדיין לא נשמרו. אם תצא עכשיו, השינויים יאבדו.',{confirmText:'צא בלי לשמור',cancelText:'המשך עריכה',tone:'danger'});
    if(!leave)return false;
  }
  closeModal();
  return true;
}

function dismissModal(){
  if(pendingDismiss)return pendingDismiss;
  pendingDismiss=performDismiss().finally(()=>{pendingDismiss=null});
  return pendingDismiss;
}

function bindConfirmationUi(){
  const els=confirmationElements();
  if(!els.back||els.back.dataset.bound==='1')return;
  els.back.dataset.bound='1';
  els.accept?.addEventListener('click',()=>settleConfirmation(true));
  els.cancel?.addEventListener('click',()=>settleConfirmation(false));
  let pointerId=null;
  els.back.addEventListener('pointerdown',event=>{pointerId=event.target===els.back?event.pointerId:null});
  els.back.addEventListener('pointerup',event=>{const cancel=pointerId===event.pointerId&&event.target===els.back;pointerId=null;if(cancel)settleConfirmation(false)});
  els.back.addEventListener('pointercancel',event=>{if(pointerId===event.pointerId)pointerId=null});
  document.addEventListener('keydown',event=>{
    if(!activeConfirm)return;
    if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();settleConfirmation(false);return}
    if(event.key!=='Tab')return;
    const buttons=[els.accept,els.cancel].filter(button=>button&&!button.disabled);
    if(buttons.length<2)return;
    const first=buttons[0],last=buttons[buttons.length-1];
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
  });
}

bindConfirmationUi();

function triSelect(id,label,val,na=true){return `<div class="field"><label>${esc(label)}</label><select id="${esc(id)}">${na?`<option value="null" ${val==null?'selected':''}>לא רלוונטי</option>`:''}<option value="true" ${val===true?'selected':''}>כן</option><option value="false" ${val===false?'selected':''}>לא</option></select></div>`}

function parseTri(id){const v=$('#'+id).value;return v==='true'?true:v==='false'?false:null}

return { modal, closeModal, dismissModal, confirmDialog, modalHasUnsavedDraft, triSelect, parseTri };
}
