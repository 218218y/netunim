/** @param {unknown} source @param {unknown} path @returns {unknown} */
function pathValue(source,path){
  return String(path||'').split('.').filter(Boolean).reduce((value,key)=>/** @type {Record<string,unknown>|null|undefined} */ (value)?.[key],source);
}

/** @param {string} code @param {string} path @param {string} [detail] */
function invariantError(code,path,detail=''){
  return Object.assign(new Error(`${code}:${path}${detail?`:${detail}`:''}`),{name:'DataInvariantError',code,collection:path,detail});
}
/** @param {unknown} value @returns {value is Record<string,unknown>} */
function record(value){return !!value&&typeof value==='object'&&!Array.isArray(value)}

/** @param {unknown} value @param {string} path @param {{required?:boolean,key?:string}} [options] @returns {Record<string,unknown>[]|undefined} */
export function assertEntityCollection(value,path,{required=true,key='id'}={}){
  if(value===undefined&&!required)return value;
  if(!Array.isArray(value))throw invariantError('entity_collection_required',path);
  const seen=new Set();
  const rows=/** @type {unknown[]} */ (value);
  for(let index=0;index<rows.length;index++){
    const row=rows[index];
    if(!record(row))throw invariantError('entity_record_invalid',path,String(index));
    if(typeof row[key]!=='string')throw invariantError('entity_id_not_string',path,String(index));
    const id=row[key].trim();
    if(!id)throw invariantError('entity_id_blank',path,String(index));
    if(row[key]!==id)throw invariantError('entity_id_not_canonical',path,String(index));
    if(seen.has(id))throw invariantError('entity_id_duplicate',path,id);
    seen.add(id);
  }
  // Every element passed the object and canonical string-key checks above.
  return /** @type {Record<string,unknown>[]} */ (value);
}

/** @param {unknown} state @param {readonly string[]} paths @param {{required?:boolean}} [options] @returns {Record<string,unknown>} */
export function assertEntityCollections(state,paths,{required=true}={}){
  if(!state||typeof state!=='object'||Array.isArray(state))throw invariantError('document_not_object','state');
  for(const path of paths)assertEntityCollection(pathValue(state,path),path,{required});
  return /** @type {Record<string,unknown>} */ (state);
}

/** @param {unknown} prefix @param {unknown} row @param {unknown} index */
export function stableLegacyEntityId(prefix,row,index){
  const text=JSON.stringify(row??null);let hash=2166136261;
  for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619)}
  return `${String(prefix||'LEGACY')}-${(hash>>>0).toString(36)}-${Number(index).toString(36)}`;
}

/** @param {unknown} prefix @param {unknown} index */
export function stableLegacyPositionId(prefix,index){
  const position=Number(index);
  if(!Number.isSafeInteger(position)||position<0)throw invariantError('legacy_position_invalid',String(prefix||'LEGACY'),String(index));
  return `${String(prefix||'LEGACY')}-LEGACY-${position.toString(36)}`;
}

/** @param {unknown} state @param {readonly string[]} paths @returns {Record<string,number>} */
export function collectionCounts(state,paths){
  /** @type {Record<string,number>} */ const out={};for(const path of paths){const value=pathValue(state,path);if(Array.isArray(value))out[path]=value.length}return out;
}
