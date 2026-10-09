// @ts-check

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function object(value){return value!==null&&typeof value==='object'&&!Array.isArray(value)}

/** @param {unknown} value */
function canonical(value){
  return JSON.stringify(value??null,(_key,/** @type {unknown} */ item)=>
    object(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
}

// JSONB object-key ordering is not a mutation. Retain JSON wire semantics for
// omitted optional fields, null roots, toJSON and ordered arrays.
/** @param {unknown} a @param {unknown} b @returns {boolean} */
export function equalSyncJson(a,b){return canonical(a)===canonical(b)}
