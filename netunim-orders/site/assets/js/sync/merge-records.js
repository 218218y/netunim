import {equalSyncJson} from '../shared/cloud-sync.js';
import {clone} from '../core/values.js';
import {customerDebtProgressData,customerDebtActiveProgressEntries} from '../shared/customer-debt-progress.js';
import {mergeBusinessRecord3} from '../shared/business-field-merge.js';

const compareId=(a,b)=>String(a)<String(b)?-1:String(a)>String(b)?1:0;
const ordered=rows=>rows.slice().sort((a,b)=>Number(a.sequence||0)-Number(b.sequence||0)||compareId(a.id,b.id));
function supplierGroups(rows){
  const groups=new Map();
  for(const row of rows||[]){const key=String(row.supplierId);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row)}
  for(const [key,value] of groups)groups.set(key,ordered(value));
  return groups;
}
function commonOrder(base,local,remote){
  const ls=new Set(local.map(row=>String(row.id))),rs=new Set(remote.map(row=>String(row.id)));
  const b=base.map(row=>String(row.id)).filter(id=>ls.has(id)&&rs.has(id)),ids=new Set(b);
  const l=local.map(row=>String(row.id)).filter(id=>ids.has(id)),r=remote.map(row=>String(row.id)).filter(id=>ids.has(id));
  return {ids,order:equalSyncJson(l,b)?r:l,conflict:!equalSyncJson(l,b)&&!equalSyncJson(r,b)&&!equalSyncJson(l,r)};
}

// Membership and numeric renumbering are not reorders. Only competing changes
// to the relative order of surviving existing rows in the same card are fenced.
function competingTransactionOrder(base,local,remote){
  const b=supplierGroups(base),l=supplierGroups(local),r=supplierGroups(remote);
  return [...b].some(([supplier,rows])=>commonOrder(rows,l.get(supplier)||[],r.get(supplier)||[]).conflict);
}

// After content merging, keep the chosen existing order and both insertion
// chains, including their neighbouring anchors. A cycle is actionable: choosing
// either side would silently relocate an insertion across a business boundary.
function reconcileTransactionOrder(base,local,remote,rows){
  const b=supplierGroups(base),l=supplierGroups(local),r=supplierGroups(remote),groups=supplierGroups(rows);
  const updates=[];
  for(const [supplier,group] of groups){
    const before=b.get(supplier)||[],left=l.get(supplier)||[],right=r.get(supplier)||[];
    const {ids,order,conflict}=commonOrder(before,left,right);
    if(conflict)return false;
    const nodes=new Map(group.map(row=>[String(row.id),{row,next:new Set(),incoming:0}]));
    const edge=(a,z)=>{if(a===z||!nodes.has(a)||!nodes.has(z)||nodes.get(a).next.has(z))return;nodes.get(a).next.add(z);nodes.get(z).incoming++};
    const core=order.filter(id=>nodes.has(id));
    for(let i=1;i<core.length;i++)edge(core[i-1],core[i]);
    for(const side of [left,right]){
      const chain=side.map(row=>String(row.id)).filter(id=>nodes.has(id));
      for(let i=1;i<chain.length;i++)if(!ids.has(chain[i-1])||!ids.has(chain[i]))edge(chain[i-1],chain[i]);
    }
    const ready=[...nodes.keys()].filter(id=>nodes.get(id).incoming===0).sort(compareId),result=[];
    while(ready.length){
      const id=ready.shift(),node=nodes.get(id);result.push(node.row);
      for(const next of node.next)if(--nodes.get(next).incoming===0){ready.push(next);ready.sort(compareId)}
    }
    if(result.length!==group.length)return false;
    const topology=value=>value.map(row=>[String(row.id),row.sequence]);
    if(!equalSyncJson(topology(before),topology(left))||!equalSyncJson(topology(before),topology(right)))updates.push(result);
  }
  // Publish only a complete plan; a later supplier conflict cannot partially
  // renumber the proposed result.
  for(const group of updates)group.forEach((row,index)=>{row.sequence=index+1});
  return true;
}

export function eq(a,b){return equalSyncJson(a,b)}

export function mergeArray(base,local,remote,key,conflicts,label,preferLocalConflicts=false){
  const competing=label==='transaction'&&competingTransactionOrder(base,local,remote);
  if(competing)conflicts.push('transactionOrder');
  const bm=new Map((base||[]).map(x=>[String(x?.[key]),x])),lm=new Map((local||[]).map(x=>[String(x?.[key]),x])),rm=new Map((remote||[]).map(x=>[String(x?.[key]),x])),keys=new Set([...bm.keys(),...lm.keys(),...rm.keys()]),out=[];
  for(const k of keys){
    let b=bm.get(k),l=lm.get(k),r=rm.get(k);
    // Numeric sequence changes also arise from insertion/deletion. Merge the
    // content independently; the card topology below owns sequence allocation.
    if(label==='transaction'&&!competing&&b&&l&&r&&b.supplierId===l.supplierId&&b.supplierId===r.supplierId){
      l={...l,sequence:b.sequence};r={...r,sequence:b.sequence};
    }
    const lc=!eq(l,b),rc=!eq(r,b);
    if(lc&&rc&&!eq(l,r)){
      const merged=competing?null:mergeBusinessRecord3(b,l,r,`orders.${label}`);
      if(merged){out.push(merged);continue}
      conflicts.push(`${label}:${k}`);if(preferLocalConflicts&&l!==undefined)out.push(clone(l));continue;
    }
    const v=lc?l:r;if(v!==undefined)out.push(clone(v));
  }
  if(label==='transaction'){
    if(!competing&&!reconcileTransactionOrder(base,local,remote,out))conflicts.push('transactionOrder');
    const rank=new Map((base||[]).map((row,index)=>[String(row[key]),index]));
    out.sort((a,b)=>(rank.get(String(a[key]))??Infinity)-(rank.get(String(b[key]))??Infinity)||(String(a[key])<String(b[key])?-1:String(a[key])>String(b[key])?1:0));
  }
  return out;
}

function withoutDebtProgress(row){if(row===undefined)return undefined;const value=clone(row);delete value.debtProgress;delete value.morningDocuments;return value}
function comparableDebtRow(row){const value=withoutDebtProgress(row);if(value===undefined)return undefined;delete value.updatedAt;delete value.paidAt;delete value.invoiceIssuedAt;delete value.closedAt;return value}
function progressRows(row){return Array.isArray(row?.debtProgress)?row.debtProgress:[]}
function mergeDebtDocuments(base,local,remote,conflicts,id){return mergeArray(base?.morningDocuments,local?.morningDocuments,remote?.morningDocuments,'operationId',conflicts,`customerDebtDocument:${id}`)}
function attachDebtDocuments(row,base,local,remote,conflicts,id){const links=mergeDebtDocuments(base,local,remote,conflicts,id);if(links.length)row.morningDocuments=links;return row}
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
  const updatedAt=latestTimestamp([...sourceRows.map(value=>value?.updatedAt),...progressTimes])??row.updatedAt;
  if(updatedAt===undefined)delete row.updatedAt;else row.updatedAt=updatedAt;
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
      const row=withoutDebtProgress(l);const progress=mergeDebtProgress(undefined,l,r,conflicts,id);if(progress.length)row.debtProgress=progress;out.push(reconcileDebtMetadata(attachDebtDocuments(row,undefined,l,r,conflicts,id),l,r));continue;
    }
    const br=comparableDebtRow(b),lr=comparableDebtRow(l),rr=comparableDebtRow(r),lrc=!eq(lr,br),rrc=!eq(rr,br);
    if(lrc&&rrc&&!eq(lr,rr)){conflicts.push(`customerDebt:${id}`);if(preferLocalConflicts){const row=withoutDebtProgress(l),progress=mergeDebtProgress(b,l,r,conflicts,id);if(progress.length)row.debtProgress=progress;out.push(reconcileDebtMetadata(attachDebtDocuments(row,b,l,r,conflicts,id),b,l,r))}continue}
    const source=lrc?l:r,row=withoutDebtProgress(source),progress=mergeDebtProgress(b,l,r,conflicts,id);if(progress.length)row.debtProgress=progress;else delete row.debtProgress;out.push(reconcileDebtMetadata(attachDebtDocuments(row,b,l,r,conflicts,id),b,l,r));
  }
  return out;
}
