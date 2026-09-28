export function createDocumentSearchFolderScope({documentBridge,getFilter,refs,onChanged,onCancelled}){
  let path='',label='';

  function update(){
    const {folderScope,folderPick,folderLabel,folderClear}=refs();
    if(!folderScope)return;
    const available=!!documentBridge?.supportsFolderScope&&getFilter()!=='site';
    folderScope.hidden=!available;
    if(folderPick){folderPick.disabled=!available;folderPick.title=path?path:'מקד את חיפוש הקבצים והתוכן לתיקייה מסוימת'}
    if(folderLabel)folderLabel.textContent=path?(label||path):'בחר תיקייה';
    if(folderClear)folderClear.hidden=!path;
    folderScope.classList.toggle('has-scope',!!path);
  }

  async function choose(){
    const {meta,folderPick}=refs();
    if(!documentBridge?.selectFolder||!documentBridge?.supportsFolderScope)return;
    if(folderPick)folderPick.disabled=true;
    if(meta)meta.textContent='פותח בחירת תיקייה…';
    try{
      const selected=await documentBridge.selectFolder();
      if(selected?.cancelled){onCancelled?.();return}
      path=String(selected?.path||'').trim();
      label=String(selected?.label||'').trim();
      update();
      onChanged?.();
    }catch(error){
      if(meta)meta.textContent=error?.message||'בחירת התיקייה נכשלה';
    }finally{update()}
  }

  function clear(){
    if(!path)return;
    path='';label='';update();onChanged?.();
    requestAnimationFrame(()=>refs().input?.focus());
  }

  return {get path(){return path},update,choose,clear};
}
