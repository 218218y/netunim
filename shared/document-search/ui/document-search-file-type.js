const FILE_TYPES=new Set(['all','audio','documents','folders','images','video','pdf','word']);

export function normalizeDocumentFileType(value){const key=String(value||'').trim().toLowerCase();return FILE_TYPES.has(key)?key:'all'}

export function createDocumentFileTypeFilter({refs,isEnabled=()=>true,onChanged=()=>{},listen=(target,...args)=>target?.addEventListener?.(...args)}={}){
  let current='all';
  function value(){return current}
  function update(){
    const {fileType,fileTypeWrap}=refs?.()||{},enabled=!!isEnabled();
    if(fileType){fileType.value=current;fileType.disabled=!enabled;fileType.title=enabled?'סנן את תוצאות הקבצים, התוכן והפריטים האחרונים לפי סוג קובץ':'מסנן סוגי הקבצים אינו משפיע על חיפוש באתר.'}
    fileTypeWrap?.classList.toggle('is-disabled',!enabled);
  }
  function set(next){
    const normalized=normalizeDocumentFileType(next);if(normalized===current){update();return false}
    current=normalized;update();onChanged(current);return true;
  }
  function bind(){
    const {fileType}=refs?.()||{};listen(fileType,'change',()=>set(fileType.value));update();
  }
  return {bind,update,value,set};
}
