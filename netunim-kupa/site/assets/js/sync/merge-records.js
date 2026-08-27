import {clone} from '../core/values.js';

export function jsonEq(a,b){return JSON.stringify(a??null)===JSON.stringify(b??null)}

export function mergeRecordArray(baseArr,localArr,remoteArr,keyName,path,conflicts){
  const keyOf=x=>String(x?.[keyName]??'');
  const bm=new Map((baseArr||[]).map(x=>[keyOf(x),x])),lm=new Map((localArr||[]).map(x=>[keyOf(x),x])),rm=new Map((remoteArr||[]).map(x=>[keyOf(x),x]));
  const keys=new Set([...bm.keys(),...lm.keys(),...rm.keys()]),out=[];
  for(const k of keys){
    const b=bm.has(k)?bm.get(k):undefined,l=lm.has(k)?lm.get(k):undefined,r=rm.has(k)?rm.get(k):undefined;
    const lc=!jsonEq(l,b),rc=!jsonEq(r,b);
    if(lc&&rc&&!jsonEq(l,r)){conflicts.push(`${path}:${k}`);continue}
    const chosen=lc?l:r;
    if(chosen!==undefined)out.push(clone(chosen));
  }
  return out;
}

function copyOptionalValue(value){return value===undefined?undefined:clone(value)}

export function mergeValue(base,local,remote,path,conflicts){const lc=!jsonEq(local,base),rc=!jsonEq(remote,base);if(lc&&rc&&!jsonEq(local,remote)){conflicts.push(path);return copyOptionalValue(remote)}return copyOptionalValue(lc?local:remote)}

export function mergeRecordArrayPreferLocal(baseArr,localArr,remoteArr,keyName){
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

export function mergeValuePreferLocal(base,local,remote){return copyOptionalValue(!jsonEq(local,base)?local:remote)}

export function comparePendingFreshness(a,b){const ag=Number(a?.generation||0),bg=Number(b?.generation||0);if(ag!==bg)return ag-bg;return (Date.parse(a?.savedAt||'')||0)-(Date.parse(b?.savedAt||'')||0)}
