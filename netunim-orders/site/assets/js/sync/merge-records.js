import {equalSyncJson} from '../shared/cloud-sync.js';
import {clone} from '../core/values.js';

export function eq(a,b){return equalSyncJson(a,b)}

export function mergeArray(base,local,remote,key,conflicts,label,preferLocalConflicts=false){const bm=new Map((base||[]).map(x=>[String(x?.[key]),x])),lm=new Map((local||[]).map(x=>[String(x?.[key]),x])),rm=new Map((remote||[]).map(x=>[String(x?.[key]),x])),keys=new Set([...bm.keys(),...lm.keys(),...rm.keys()]),out=[];for(const k of keys){const b=bm.get(k),l=lm.get(k),r=rm.get(k),lc=!eq(l,b),rc=!eq(r,b);if(lc&&rc&&!eq(l,r)){conflicts.push(`${label}:${k}`);if(preferLocalConflicts&&l!==undefined)out.push(clone(l));continue}const v=lc?l:r;if(v!==undefined)out.push(clone(v))}return out}

function withoutDebtProgress(row){if(row===undefined)return undefined;const value=clone(row);delete value.debtProgress;return value}
function progressRows(row){return Array.isArray(row?.debtProgress)?row.debtProgress:[]}

function mergeDebtProgress(base,local,remote,conflicts,debtId){
  const bm=new Map(progressRows(base).map(x=>[String(x?.id),x])),lm=new Map(progressRows(local).map(x=>[String(x?.id),x])),rm=new Map(progressRows(remote).map(x=>[String(x?.id),x]));
  const keys=new Set([...bm.keys(),...lm.keys(),...rm.keys()]),out=[];
  for(const id of keys){
    const b=bm.get(id),l=lm.get(id),r=rm.get(id);
    if(b!==undefined){
      if((l!==undefined&&!eq(l,b))||(r!==undefined&&!eq(r,b))){conflicts.push(`customerDebt:${debtId}`);continue}
      out.push(clone(b));continue;
    }
    if(l!==undefined&&r!==undefined&&!eq(l,r)){conflicts.push(`customerDebt:${debtId}`);continue}
    out.push(clone(l!==undefined?l:r));
  }
  return out.sort((a,b)=>String(a?.createdAt||'').localeCompare(String(b?.createdAt||''))||String(a?.id||'').localeCompare(String(b?.id||'')));
}

export function mergeCustomerDebtArray(base,local,remote,conflicts,preferLocalConflicts=false){
  const bm=new Map((base||[]).map(x=>[String(x?.id),x])),lm=new Map((local||[]).map(x=>[String(x?.id),x])),rm=new Map((remote||[]).map(x=>[String(x?.id),x]));
  const keys=new Set([...bm.keys(),...lm.keys(),...rm.keys()]),out=[];
  for(const id of keys){
    const b=bm.get(id),l=lm.get(id),r=rm.get(id),lc=!eq(l,b),rc=!eq(r,b);
    if(l===undefined||r===undefined){
      if(lc&&rc&&!eq(l,r)){conflicts.push(`customerDebt:${id}`);if(preferLocalConflicts&&l!==undefined)out.push(clone(l));continue}
      const value=lc?l:r;if(value!==undefined)out.push(clone(value));continue;
    }
    if(b===undefined){
      if(!eq(withoutDebtProgress(l),withoutDebtProgress(r))){conflicts.push(`customerDebt:${id}`);if(preferLocalConflicts)out.push(clone(l));continue}
      const row=withoutDebtProgress(l);const progress=mergeDebtProgress(undefined,l,r,conflicts,id);if(progress.length)row.debtProgress=progress;out.push(row);continue;
    }
    const br=withoutDebtProgress(b),lr=withoutDebtProgress(l),rr=withoutDebtProgress(r),lrc=!eq(lr,br),rrc=!eq(rr,br);
    if(lrc&&rrc&&!eq(lr,rr)){conflicts.push(`customerDebt:${id}`);if(preferLocalConflicts){const row=clone(lr),progress=mergeDebtProgress(b,l,r,conflicts,id);if(progress.length)row.debtProgress=progress;out.push(row)}continue}
    const row=clone(lrc?lr:rr),progress=mergeDebtProgress(b,l,r,conflicts,id);if(progress.length)row.debtProgress=progress;else delete row.debtProgress;out.push(row);
  }
  return out;
}

