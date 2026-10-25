import {beginMeasure,recordPerformanceValue,performanceEnabled} from './runtime-performance.js';
/** @template Result @param {string} name @param {() => Result} work @returns {Result} */
export function measureStorage(name,work){const done=beginMeasure('storage:'+name);try{return work()}finally{done()}}
/** @param {string} name @param {string} text */
export function storageBytes(name,text){if(performanceEnabled())recordPerformanceValue('storage:bytes:'+name,new TextEncoder().encode(text).length)}
/** @param {string} name @param {import('./storage-json.js').StorageJson} value */
export function stringifyStorage(name,value){return measureStorage(`${name}-stringify`,()=>{const text=JSON.stringify(value);storageBytes(name,text);return text})}
/** @param {Pick<Storage,'setItem'|'getItem'>} storage @param {string} key @param {string} text */
export function writeVerifiedStorage(storage,key,text){
  measureStorage('localstorage-write',()=>storage.setItem(key,text));
  if(measureStorage('localstorage-verify',()=>storage.getItem(key))!==text)throw new Error('storage_verification_failed');
}
