import {beginMeasure,recordPerformanceValue,performanceEnabled} from './runtime-performance.js';
export function measureStorage(name,work){const done=beginMeasure('storage:'+name);try{return work()}finally{done()}}
export function storageBytes(name,text){if(performanceEnabled())recordPerformanceValue('storage:bytes:'+name,new TextEncoder().encode(text).length)}
export function stringifyStorage(name,value){return measureStorage(`${name}-stringify`,()=>{const text=JSON.stringify(value);storageBytes(name,text);return text})}
export function writeVerifiedStorage(storage,key,text){
  measureStorage('localstorage-write',()=>storage.setItem(key,text));
  if(measureStorage('localstorage-verify',()=>storage.getItem(key))!==text)throw new Error('storage_verification_failed');
}
