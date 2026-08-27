import {clone} from '../core/values.js';

export function eq(a,b){return JSON.stringify(a??null)===JSON.stringify(b??null)}

export function mergeArray(base,local,remote,key,conflicts,label,preferLocalConflicts=false){const bm=new Map((base||[]).map(x=>[String(x?.[key]),x])),lm=new Map((local||[]).map(x=>[String(x?.[key]),x])),rm=new Map((remote||[]).map(x=>[String(x?.[key]),x])),keys=new Set([...bm.keys(),...lm.keys(),...rm.keys()]),out=[];for(const k of keys){const b=bm.get(k),l=lm.get(k),r=rm.get(k),lc=!eq(l,b),rc=!eq(r,b);if(lc&&rc&&!eq(l,r)){conflicts.push(`${label}:${k}`);if(preferLocalConflicts&&l!==undefined)out.push(clone(l));continue}const v=lc?l:r;if(v!==undefined)out.push(clone(v))}return out}
