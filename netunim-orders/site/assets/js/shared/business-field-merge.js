import {equalSyncJson} from './sync-json.js';

// Opt in by collection. Unknown fields and financial/identity changes retain
// whole-record conflict semantics. Checks and debt progress have separate owners.
const policies=Object.freeze({
  'orders.transaction':['invoiceReceived','signed','supplied','supplyInfo','note','message','sequence'],
  'orders.note':['content','text'],
  'kupa.notes':['content'],
  'kupa.cash':['description','note'],
  'kupa.rights':['description','note'],
  'kupa.expenses':['description','note'],
});
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const sameField=(a,b,key)=>Object.hasOwn(a,key)===Object.hasOwn(b,key)&&equalSyncJson(a[key],b[key]);

export function mergeBusinessRecord3(base,local,remote,policy){
  const fields=policies[policy];
  if(!fields||![base,local,remote].every(object))return null;
  const result=structuredClone(base),keys=new Set([...Object.keys(base),...Object.keys(local),...Object.keys(remote)]);
  for(const key of keys){
    const lc=!sameField(local,base,key),rc=!sameField(remote,base,key);
    if(!lc&&!rc)continue;
    if(key!=='updatedAt'&&!fields.includes(key))return null;
    if(key==='updatedAt'&&[local,remote].some(row=>!sameField(row,base,key)&&(typeof row[key]!=='string'||!Number.isFinite(Date.parse(row[key])))))return null;
    let source=lc?local:remote;
    if(lc&&rc&&!sameField(local,remote,key)){
      if(key!=='updatedAt')return null;
      const l=Date.parse(local[key]),r=Date.parse(remote[key]);
      if(typeof local[key]!=='string'||typeof remote[key]!=='string'||!Number.isFinite(l)||!Number.isFinite(r))return null;
      source=l>r||l===r&&local[key]>remote[key]?local:remote;
    }
    if(Object.hasOwn(source,key))result[key]=structuredClone(source[key]);else delete result[key];
  }
  return result;
}

// Row-by-row merging cannot detect two reorders which produce duplicate
// sequence values on different rows. Fence the topology as one collection.
export function competingTransactionOrder(base,local,remote){
  const topology=rows=>(rows||[]).map(row=>[row.id,row.supplierId,row.sequence]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
  const b=topology(base),l=topology(local),r=topology(remote);
  return !equalSyncJson(l,b)&&!equalSyncJson(r,b)&&!equalSyncJson(l,r);
}
