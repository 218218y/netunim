export const DOCUMENT_SORT_FIELDS=new Set(['name','path','size','modified']);

export function defaultDocumentSortDirection(field){return field==='size'||field==='modified'?'desc':'asc'}

export function normalizeDocumentSort(sort={}){
  const field=DOCUMENT_SORT_FIELDS.has(String(sort?.field||'').toLowerCase())?String(sort.field).toLowerCase():'modified',direction=String(sort?.direction||'').toLowerCase();
  return {field,direction:direction==='asc'||direction==='desc'?direction:defaultDocumentSortDirection(field)};
}

export function nextDocumentSort(current,field){
  const normalized=normalizeDocumentSort(current),target=DOCUMENT_SORT_FIELDS.has(field)?field:'modified';
  return normalized.field===target?{field:target,direction:normalized.direction==='asc'?'desc':'asc'}:{field:target,direction:defaultDocumentSortDirection(target)};
}

export function compareDocumentRows(a,b,sort={}){
  const normalized=normalizeDocumentSort(sort),factor=normalized.direction==='desc'?-1:1;let result=0;
  if(normalized.field==='size'){
    const left=Number(a?.size),right=Number(b?.size);result=(Number.isFinite(left)?left:-1)-(Number.isFinite(right)?right:-1);
  }else if(normalized.field==='modified'){
    const left=Date.parse(a?.modified||''),right=Date.parse(b?.modified||'');result=(Number.isFinite(left)?left:0)-(Number.isFinite(right)?right:0);
  }else{
    const left=normalized.field==='path'?String(a?.relativePath||a?.fullPath||''):String(a?.name||''),right=normalized.field==='path'?String(b?.relativePath||b?.fullPath||''):String(b?.name||'');
    result=left.localeCompare(right,'he',{numeric:true,sensitivity:'base'});
  }
  if(result)return result*factor;
  return String(a?.fullPath||a?.name||'').localeCompare(String(b?.fullPath||b?.name||''),'he',{numeric:true,sensitivity:'base'})*factor;
}

export function sortedDocumentRows(rows,sort){return [...(Array.isArray(rows)?rows:[])].sort((a,b)=>compareDocumentRows(a,b,sort))}
