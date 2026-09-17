import {normalizeNotesSheet} from './notes-sheet-model.js';

export function createNotesWorkbookMerger({clone,jsonEq,mergeRecordArray,mergeRecordArrayPreferLocal}){
function protectImplicitDeletes(base,local,deleteIds,key='id'){
  const allowed=new Set((Array.isArray(deleteIds)?deleteIds:[]).map(x=>String(x||'').trim()).filter(Boolean));
  const safe=clone(Array.isArray(local)?local:[]),present=new Set(safe.map(x=>String(x?.[key]??'')));
  for(const item of Array.isArray(base)?base:[]){const id=String(item?.[key]??'');if(id&&!present.has(id)&&!allowed.has(id)){safe.push(clone(item));present.add(id)}}
  return safe;
}
function mergeNotesWorkbook(base={},local={},remote={},deleteIntents={},conflicts=[],preferLocal=false){
  base=normalizeNotesSheet(base);local=normalizeNotesSheet(local);remote=normalizeNotesSheet(remote);
  const safe={version:2};
  for(const part of ['sheets','columns','rows'])safe[part]=protectImplicitDeletes(base[part],local[part],deleteIntents[`notesSheet.${part}`]);
  const book={version:2},problems=[];
  // Deleting a parent conflicts with edits OR additions anywhere in that sheet.
  // Independent array merges alone miss a new row beneath a deleted parent.
  for(const sheet of base.sheets||[]){
    const localHas=safe.sheets.some(row=>row.id===sheet.id),remoteHas=(remote.sheets||[]).some(row=>row.id===sheet.id);
    if(localHas===remoteHas)continue;
    const surviving=localHas?safe:remote;
    if(['columns','rows'].some(part=>!jsonEq((base[part]||[]).filter(row=>row.sheetId===sheet.id),(surviving[part]||[]).filter(row=>row.sheetId===sheet.id))))problems.push(`notesSheet.sheets:${sheet.id}`);
  }
  // A remote row added under a locally deleted column must not lose that cell
  // during normalization, even though the row did not exist in the base.
  for(const column of base.columns){
    const localHas=safe.columns.some(item=>item.id===column.id),remoteHas=remote.columns.some(item=>item.id===column.id);
    if(localHas===remoteHas)continue;
    const surviving=localHas?safe:remote;
    const cells=book=>book.rows.filter(row=>row.sheetId===column.sheetId&&Object.hasOwn(row.cells||{},column.id)).map(row=>({id:row.id,value:row.cells[column.id]}));
    if(!jsonEq(cells(base),cells(surviving)))problems.push(`notesSheet.columns:${column.id}`);
  }
  for(const part of ['sheets','columns','rows'])book[part]=preferLocal
    ?mergeRecordArrayPreferLocal(base[part],safe[part],remote[part],'id')
    :mergeRecordArray(base[part],safe[part],remote[part],'id',`notesSheet.${part}`,problems);
  // Two computers can each delete a different sheet while retaining the other.
  // Do not let normalization silently resurrect a default sheet after that merge.
  if((base.sheets||[]).length&&!book.sheets.length)problems.push('notesSheet.sheets');
  if(problems.length){conflicts.push(...new Set(problems));return clone(preferLocal?safe:remote)}
  return book;
}
return mergeNotesWorkbook;
}
