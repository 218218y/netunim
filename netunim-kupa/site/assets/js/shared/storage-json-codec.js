// @ts-check

/**
 * @typedef {import('./storage-json.js').StorageJson} StorageJson
 */
/** @template {StorageJson} Data @typedef {{data: Data, checksum: string}} SealedStorageRecord */
/** @typedef {<Result>(name: string, work: () => Result) => Result} StorageRecordMeasure */
const forbidden=new Set(['__proto__','prototype','constructor']);

/** @param {unknown} value @returns {value is object} */
function container(value){
  return value!==null&&typeof value==='object'&&(Array.isArray(value)||Object.getPrototypeOf(value)===Object.prototype);
}

/** @param {unknown} value @returns {value is StorageJson} */
function validJson(value){
  /** @type {Set<object>} */ const seen=new Set();
  /** @param {unknown} item */
  function visit(item){
    if(item===null||typeof item==='string'||typeof item==='boolean')return;
    if(typeof item==='number'&&Number.isFinite(item))return;
    if(!container(item)||seen.has(item))throw new Error('storage_non_json_value');
    seen.add(item);
    /** @type {[string, unknown][]} */ const entries=Object.entries(item);
    for(const [key,child] of entries){if(forbidden.has(key))throw new Error('storage_unsafe_key');visit(child)}
    seen.delete(item);
  }
  visit(value);return true;
}

// Preserve the existing JSON rules, error codes, graph handling and identity.
/** @param {unknown} value @returns {StorageJson} */
export function assertStorageJson(value){
  if(validJson(value))return value;
  throw new Error('storage_non_json_value');
}

// Corruption detection, not a cryptographic signature or authentication proof.
/** @param {string} text @returns {string} */
export function storageChecksum(text){
  let a=2166136261,b=0x9e3779b9;
  for(let i=0;i<text.length;i++){const c=text.charCodeAt(i);a=Math.imul(a^c,16777619);b=Math.imul(b^c,2246822519)}
  return (a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');
}

/**
 * @template {StorageJson} Data
 * @param {Data} value
 * @param {{kind?: string | null, measure?: StorageRecordMeasure, onSerialized?: (text: string) => undefined}} [options]
 * @returns {SealedStorageRecord<Data>}
 */
export function sealStorageJsonRecord(value,{kind=null,measure,onSerialized}={}){
  /** @template Result @param {string} name @param {() => Result} work @returns {Result} */
  const run=(name,work)=>measure?measure(name,work):work();
  run('validate',()=>assertStorageJson(value));
  const data=run(`${kind}-clone`,()=>structuredClone(value));
  const text=run(`${kind}-stringify`,()=>JSON.stringify(data));
  if(typeof text!=='string')throw new Error('storage_non_json_value');
  onSerialized?.(text);
  return {data,checksum:storageChecksum(text)};
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function envelope(value){return value!==null&&typeof value==='object'&&!Array.isArray(value)}

// A verified JSON envelope is not yet a checkpoint/operation/flight. Its owner
// must decode the record kind before granting recovery, ACK or publication.
/** @param {unknown} record @returns {StorageJson} */
export function readStorageJsonRecord(record){
  if(!envelope(record)||!record.data)throw new Error('storage_checksum_mismatch');
  // IndexedDB can contain BigInt/cycles even though this journal writes JSON.
  // Reject them explicitly before stringify can emit an unclassified TypeError.
  const data=assertStorageJson(record.data);
  const text=JSON.stringify(data);
  if(typeof text!=='string'||storageChecksum(text)!==record.checksum)throw new Error('storage_checksum_mismatch');
  return structuredClone(data);
}
