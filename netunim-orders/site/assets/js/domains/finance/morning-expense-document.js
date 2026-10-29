import {createExpensePdfPreview} from './morning-expense-pdf-preview.js';

// Render provider bytes in our raster-only viewer, never navigate to a signed
// attachment URL. Its Content-Disposition cannot trigger an unwanted download.
export function createExpenseDocumentViewer({request,capture,run,isActive,report,validate}) {
  let dialog=null,controller=null,download='',revision=0,previousFocus=null;
  const active=()=>isActive()&&!!dialog?.isConnected;
  const preview=createExpensePdfPreview({capture,run,isActive:active,host:()=>dialog});
  function reset(){
    revision++;controller?.abort();controller=null;preview.reset();
    if(download)URL.revokeObjectURL(download);download='';
    dialog?.close();dialog?.remove();dialog=null;
    if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});previousFocus=null;
  }
  function open(id,environment){
    if(!isActive())return false;reset();previousFocus=document.activeElement;
    const epoch=revision,base=capture(),abort=new AbortController();controller=abort;
    const check=()=>{base();if(epoch!==revision||!active()||abort.signal.aborted)throw new DOMException('Aborted','AbortError');};
    dialog=document.createElement('dialog');dialog.className='morning-expense-document-dialog';dialog.dir='rtl';
    dialog.setAttribute('aria-label','מסמך המקור ממורנינג');
    dialog.innerHTML='<header><h2>מסמך המקור ממורנינג</h2><a class="btn" data-source-download hidden>הורדה למחשב</a><button type="button" class="btn" data-source-close aria-label="סגירת מסמך המקור">סגירה</button></header><p role="status">טוען את מסמך המקור ממורנינג…</p><div data-source-content></div>';
    dialog.addEventListener('cancel',event=>{event.preventDefault();reset();});
    dialog.addEventListener('click',event=>{
      if(event.target.closest('[data-source-close]')){reset();return;}
      const button=event.target.closest('[data-expense-command]');
      const commands={'pdf-prev':preview.previous,'pdf-next':preview.next,'pdf-zoom-in':preview.zoomIn,'pdf-zoom-out':preview.zoomOut};
      if(button&&Object.hasOwn(commands,button.dataset.expenseCommand)){event.stopPropagation();commands[button.dataset.expenseCommand]();}
    });
    document.body.append(dialog);dialog.showModal();
    return run(async()=>{
      try{
        const data=await request('source_file',{id,expectedEnvironment:environment},check,{signal:abort.signal});check();
        const item=await validate(data.file);check();download=URL.createObjectURL(item.file);
        const link=dialog.querySelector('[data-source-download]');link.href=download;link.download=item.name;link.hidden=false;
        dialog.querySelector('[role="status"]').textContent='';
        const content=dialog.querySelector('[data-source-content]');
        if(item.type==='application/pdf'){content.innerHTML=preview.markup();preview.select(item);}
        else {const image=document.createElement('img');image.src=download;image.alt='מסמך המקור';content.replaceChildren(image);}
        return true;
      }catch(error){
        try{check();dialog.querySelector('[role="status"]').textContent=error.message||'לא ניתן לטעון את מסמך המקור. אפשר לסגור ולנסות שוב.';report(error.message);}catch{/* Closed or old account. */}
        return false;
      }
    });
  }
  return {open,reset};
}
