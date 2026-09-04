function pathValue(source,path){
  return String(path||'').split('.').filter(Boolean).reduce((value,key)=>value?.[key],source);
}

function invariantError(code,path,detail=''){
  const error=new Error(`${code}:${path}${detail?`:${detail}`:''}`);
  error.name='DataInvariantError';error.code=code;error.collection=path;error.detail=detail;
  return error;
}

export function assertEntityCollection(value,path,{required=true,key='id'}={}){
  if(value===undefined&&!required)return value;
  if(!Array.isArray(value))throw invariantError('entity_collection_required',path);
  const seen=new Set();
  for(let index=0;index<value.length;index++){
    const row=value[index];
    if(!row||typeof row!=='object'||Array.isArray(row))throw invariantError('entity_record_invalid',path,String(index));
    if(typeof row[key]!=='string')throw invariantError('entity_id_not_string',path,String(index));
    const id=row[key].trim();
    if(!id)throw invariantError('entity_id_blank',path,String(index));
    if(row[key]!==id)throw invariantError('entity_id_not_canonical',path,String(index));
    if(seen.has(id))throw invariantError('entity_id_duplicate',path,id);
    seen.add(id);
  }
  return value;
}

export function assertEntityCollections(state,paths,{required=true}={}){
  if(!state||typeof state!=='object'||Array.isArray(state))throw invariantError('document_not_object','state');
  for(const path of paths)assertEntityCollection(pathValue(state,path),path,{required});
  return state;
}

export function stableLegacyEntityId(prefix,row,index){
  const text=JSON.stringify(row??null);let hash=2166136261;
  for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619)}
  return `${String(prefix||'LEGACY')}-${(hash>>>0).toString(36)}-${Number(index).toString(36)}`;
}

export function collectionCounts(state,paths){
  const out={};for(const path of paths){const value=pathValue(state,path);if(Array.isArray(value))out[path]=value.length}return out;
}
