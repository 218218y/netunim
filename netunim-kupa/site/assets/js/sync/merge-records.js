import {equalSyncJson} from '../shared/cloud-sync.js';
import {clone} from '../core/values.js';
import {mergeBusinessRecord3} from '../shared/business-field-merge.js';

/** @param {unknown} a @param {unknown} b */
export function jsonEq(a,b){return equalSyncJson(a,b)}

/** @param {Record<string,unknown>[]|null|undefined} baseArr @param {Record<string,unknown>[]|null|undefined} localArr @param {Record<string,unknown>[]|null|undefined} remoteArr @param {string} keyName @param {string} path @param {string[]} conflicts */
export function mergeRecordArray(baseArr,localArr,remoteArr,keyName,path,conflicts){
  /** @param {Record<string,unknown>} x */
  const keyOf=x=>String(x?.[keyName]??'');
  const bm=new Map((baseArr||[]).map(x=>[keyOf(x),x])),lm=new Map((localArr||[]).map(x=>[keyOf(x),x])),rm=new Map((remoteArr||[]).map(x=>[keyOf(x),x]));
  const keys=new Set([...bm.keys(),...lm.keys(),...rm.keys()]),out=[];
  for(const k of keys){
    const b=bm.has(k)?bm.get(k):undefined,l=lm.has(k)?lm.get(k):undefined,r=rm.has(k)?rm.get(k):undefined;
    const lc=!jsonEq(l,b),rc=!jsonEq(r,b);
    if(lc&&rc&&!jsonEq(l,r)){
      const merged=mergeBusinessRecord3(b,l,r,`kupa.${path}`);
      if(merged){out.push(merged);continue}
      conflicts.push(`${path}:${k}`);continue;
    }
    const chosen=lc?l:r;
    if(chosen!==undefined)out.push(clone(chosen));
  }
  return out;
}

/** @template T @param {T} value @returns {T} */
function copyOptionalValue(value){return value===undefined?value:clone(value)}

/** @param {unknown} base @param {unknown} local @param {unknown} remote @param {string} path @param {string[]} conflicts */
export function mergeValue(base,local,remote,path,conflicts){const lc=!jsonEq(local,base),rc=!jsonEq(remote,base);if(lc&&rc&&!jsonEq(local,remote)){conflicts.push(path);return copyOptionalValue(remote)}return copyOptionalValue(lc?local:remote)}

/** @param {Record<string,unknown>[]|null|undefined} baseArr @param {Record<string,unknown>[]|null|undefined} localArr @param {Record<string,unknown>[]|null|undefined} remoteArr @param {string} keyName */
export function mergeRecordArrayPreferLocal(baseArr,localArr,remoteArr,keyName){
  /** @param {Record<string,unknown>} x */
  const keyOf=x=>String(x?.[keyName]??'');
  const bm=new Map((baseArr||[]).map(x=>[keyOf(x),x])),lm=new Map((localArr||[]).map(x=>[keyOf(x),x])),rm=new Map((remoteArr||[]).map(x=>[keyOf(x),x]));
  const keys=new Set([...bm.keys(),...lm.keys(),...rm.keys()]),out=[];
  for(const k of keys){
    const b=bm.has(k)?bm.get(k):undefined,l=lm.has(k)?lm.get(k):undefined,r=rm.has(k)?rm.get(k):undefined;
    const localChanged=!jsonEq(l,b),chosen=localChanged?l:r;
    if(chosen!==undefined)out.push(clone(chosen));
  }
  return out;
}

/** @param {unknown} base @param {unknown} local @param {unknown} remote */
export function mergeValuePreferLocal(base,local,remote){return copyOptionalValue(!jsonEq(local,base)?local:remote)}

/** @param {Record<string,unknown>|null} a @param {Record<string,unknown>|null} b */
export function comparePendingFreshness(a,b){const ag=Number(a?.generation||0),bg=Number(b?.generation||0);if(ag!==bg)return ag-bg;return (Date.parse(String(a?.savedAt||''))||0)-(Date.parse(String(b?.savedAt||''))||0)}
