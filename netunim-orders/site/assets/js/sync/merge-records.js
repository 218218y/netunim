import {equalSyncJson} from '../shared/cloud-sync.js';
import {clone} from '../core/values.js';
import {customerDebtProgressData,customerDebtActiveProgressEntries} from '../shared/customer-debt-progress.js';

export function eq(a,b){return equalSyncJson(a,b)}

export function mergeArray(base,local,remote,key,conflicts,label,preferLocalConflicts=false){const bm=new Map((base||[]).map(x=>[String(x?.[key]),x])),lm=new Map((local||[]).map(x=>[String(x?.[key]),x])),rm=new Map((remote||[]).map(x=>[String(x?.[key]),x])),keys=new Set([...bm.keys(),...lm.keys(),...rm.keys()]),out=[];for(const k of keys){const b=bm.get(k),l=lm.get(k),r=rm.get(k),lc=!eq(l,b),rc=!eq(r,b);if(lc&&rc&&!eq(l,r)){conflicts.push(`${label}:${k}`);if(preferLocalConflicts&&l!==undefined)out.push(clone(l));continue}const v=lc?l:r;if(v!==undefined)out.push(clone(v))}return out}

function withoutDebtProgress(row){if(row===undefined)return undefined;const value=clone(row);delete value.debtProgress;return value}
function comparableDebtRow(row){const value=withoutDebtProgress(row);if(value===undefined)return undefined;delete value.updatedAt;delete value.paidAt;delete value.invoiceIssuedAt;delete value.closedAt;return value}
function progressRows(row){return Array.isArray(row?.debtProgress)?row.debtProgress:[]}
function timestampValue(value){if(typeof value!=='string'||!value)return null;const time=Date.parse(value);return Number.isFinite(time)?{value,time}:null}
function earliestTimestamp(values){const rows=values.map(timestampValue).filter(Boolean).sort((a,b)=>a.time-b.time||a.value.localeCompare(b.value));return rows[0]?.value||null}
function latestTimestamp(values){const rows=values.map(timestampValue).filter(Boolean).sort((a,b)=>b.time-a.time||b.value.localeCompare(a.value));return rows[0]?.value||null}
function progressCompletionAt(row,kind){
  const target=Math.abs(Math.round(Number(row?.amount||0)*100));if(!target)return null;
  const active=customerDebtActiveProgressEntries(row,kind).slice().sort((a,b)=>String(a?.createdAt||'').localeCompare(String(b?.createdAt||''))||String(a?.id||'').localeCompare(String(b?.id||'')));
  let total=0;for(const entry of active){total+=Math.max(0,Math.round(Number(entry?.amount||0)*100));if(total>=target)return timestampValue(entry?.createdAt)?.value||null}return null;
}
function sameDebtTarget(a,b){return Math.round(Number(a?.amount||0)*100)===Math.round(Number(b?.amount||0)*100)}
function reconcileDebtMetadata(row,...sources){
  const p=customerDebtProgressData(row),sourceRows=[row,...sources].filter(Boolean),sameTargetSources=sourceRows.filter(value=>sameDebtTarget(value,row)),progressTimes=progressRows(row).map(entry=>entry?.createdAt);
  const paymentSourceTimes=sameTargetSources.filter(value=>customerDebtProgressData(value).paymentComplete).map(value=>value?.paidAt),invoiceSourceTimes=sameTargetSources.filter(value=>customerDebtProgressData(value).invoiceComplete).map(value=>value?.invoiceIssuedAt);
  const paymentAt=p.paymentComplete?earliestTimestamp([...paymentSourceTimes,progressCompletionAt(row,'payment')]):null;
  const invoiceAt=p.invoiceComplete?earliestTimestamp([...invoiceSourceTimes,progressCompletionAt(row,'invoice')]):null;
  const existingClosed=earliestTimestamp(sameTargetSources.filter(value=>{const progress=customerDebtProgressData(value);return progress.paymentComplete&&progress.invoiceComplete}).map(value=>value?.closedAt)),derivedClosed=latestTimestamp([paymentAt,invoiceAt]);
  row.paidAt=paymentAt;row.invoiceIssuedAt=invoiceAt;row.closedAt=p.paymentComplete&&p.invoiceComplete?latestTimestamp([derivedClosed,existingClosed]):null;
  row.updatedAt=latestTimestamp([...sourceRows.map(value=>value?.updatedAt),...progressTimes])||row.updatedAt;
  return row;
}

function comparableProgress(entry){if(entry===undefined)return undefined;const value=clone(entry);delete value.createdAt;return value}
function mergeDebtProgress(base,local,remote,conflicts,debtId){
  const bm=new Map(progressRows(base).map(x=>[String(x?.id),x])),lm=new Map(progressRows(local).map(x=>[String(x?.id),x])),rm=new Map(progressRows(remote).map(x=>[String(x?.id),x]));
  const keys=new Set([...bm.keys(),...lm.keys(),...rm.keys()]),out=[];
  for(const id of keys){
    const b=bm.get(id),l=lm.get(id),r=rm.get(id);
    if(b!==undefined){
      if((l!==undefined&&!eq(comparableProgress(l),comparableProgress(b)))||(r!==undefined&&!eq(comparableProgress(r),comparableProgress(b)))){conflicts.push(`customerDebt:${debtId}`);continue}
      out.push(clone(b));continue;
    }
    if(l!==undefined&&r!==undefined&&!eq(comparableProgress(l),comparableProgress(r))){conflicts.push(`customerDebt:${debtId}`);continue}
    const entry=clone(l!==undefined?l:r);
    if(l!==undefined&&r!==undefined){const createdAt=earliestTimestamp([l.createdAt,r.createdAt]);if(createdAt)entry.createdAt=createdAt;else delete entry.createdAt}
    out.push(entry);
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
      if(!eq(comparableDebtRow(l),comparableDebtRow(r))){conflicts.push(`customerDebt:${id}`);if(preferLocalConflicts)out.push(clone(l));continue}
      const row=withoutDebtProgress(l);const progress=mergeDebtProgress(undefined,l,r,conflicts,id);if(progress.length)row.debtProgress=progress;out.push(reconcileDebtMetadata(row,l,r));continue;
    }
    const br=comparableDebtRow(b),lr=comparableDebtRow(l),rr=comparableDebtRow(r),lrc=!eq(lr,br),rrc=!eq(rr,br);
    if(lrc&&rrc&&!eq(lr,rr)){conflicts.push(`customerDebt:${id}`);if(preferLocalConflicts){const row=withoutDebtProgress(l),progress=mergeDebtProgress(b,l,r,conflicts,id);if(progress.length)row.debtProgress=progress;out.push(reconcileDebtMetadata(row,b,l,r))}continue}
    const source=lrc?l:r,row=withoutDebtProgress(source),progress=mergeDebtProgress(b,l,r,conflicts,id);if(progress.length)row.debtProgress=progress;else delete row.debtProgress;out.push(reconcileDebtMetadata(row,b,l,r));
  }
  return out;
}
