// Local file actions stay separate from search result composition. The bridge
// accepts opaque result IDs; no path from the browser is trusted or sent here.
export function createDocumentResultMenu({results,available,open,reveal,remove,select}){
  let menu=null,current=null;
  function findButton(id,key){
    return [...(results()?.querySelectorAll('[data-document-result-id]')||[])]
      .find(row=>(key&&row.dataset.documentResultKey===key)||row.dataset.documentResultId===id)||null;
  }
  function hide(){
    if(!menu||menu.hidden)return false;
    menu.hidden=true;current=null;return true;
  }
  function ensure(){
    if(menu?.isConnected)return menu;
    menu=document.createElement('div');menu.className='document-result-context-menu';menu.hidden=true;menu.setAttribute('role','menu');
    menu.innerHTML='<button type="button" role="menuitem" data-document-menu-action="open">פתח</button><button type="button" role="menuitem" data-document-menu-action="reveal">פתח מיקום</button><button type="button" role="menuitem" class="danger" data-document-menu-action="delete">מחק</button>';
    menu.addEventListener('click',event=>{
      const action=event.target.closest('[data-document-menu-action]')?.dataset.documentMenuAction;
      if(!action||!current)return;
      const {id,key,mode}=current,button=findButton(id,key);hide();
      if(action==='open')void open(id,button);
      else if(action==='reveal')void reveal(id,button);
      else if(action==='delete')void remove(id,button,mode);
    });
    document.body.appendChild(menu);return menu;
  }
  function show(button,{clientX=null,clientY=null}={}){
    if(!available()||!button?.dataset.documentResultId)return;
    const id=String(button.dataset.documentResultId),mode=button.dataset.documentSearchMode==='content'?'content':'everything';
    current={id,key:String(button.dataset.documentResultKey||''),mode};
    select(id,button,mode);
    const node=ensure();node.hidden=false;
    const anchor=button.getBoundingClientRect();
    const x=Number.isFinite(clientX)?clientX:Math.min(window.innerWidth-8,anchor.left+Math.min(anchor.width,180));
    const y=Number.isFinite(clientY)?clientY:Math.min(window.innerHeight-8,anchor.top+Math.min(anchor.height,28));
    node.style.left=`${Math.max(6,x)}px`;node.style.top=`${Math.max(6,y)}px`;
    const rect=node.getBoundingClientRect();
    node.style.left=`${Math.max(6,Math.min(window.innerWidth-rect.width-6,x))}px`;
    node.style.top=`${Math.max(6,Math.min(window.innerHeight-rect.height-6,y))}px`;
  }
  function contains(target){return !!menu&&!menu.hidden&&menu.contains(target)}
  return {hide,show,contains};
}

export async function deleteLocalDocumentResult({id,button,item,bridge,confirmDialog,beforeDelete,afterDelete,showStatus}){
  if(!bridge?.deleteDocument||!id)return;
  const name=String(item?.name||'הפריט הנבחר'),kind=item?.isDirectory?'התיקייה':'הקובץ';
  const message=`${kind} “${name}” יישלח לסל המיחזור של Windows.\nבכונן רשת או מיקום שאינו תומך בסל המיחזור, אופן המחיקה נקבע על־ידי Windows.`;
  const approved=confirmDialog?await confirmDialog('למחוק את הקובץ?',message,{confirmText:'מחק',cancelText:'ביטול',tone:'danger'}):globalThis.confirm?.(message);
  if(!approved)return;
  await beforeDelete();
  const previous=button?.disabled;if(button)button.disabled=true;
  try{
    const result=await bridge.deleteDocument(id);
    const invalidated=Array.isArray(result?.invalidatedIds)&&result.invalidatedIds.length?result.invalidatedIds:[id];
    afterDelete(invalidated);
    showStatus(`${kind} נמחק${item?.isDirectory?'ה':''} מתוצאות החיפוש.`);
  }catch(error){showStatus(error?.message||'מחיקת הקובץ נכשלה')}
  finally{if(button?.isConnected)button.disabled=!!previous}
}
