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
export function competingTransactionOrder(base,local,remote){
  const b=supplierGroups(base),l=supplierGroups(local),r=supplierGroups(remote);
  return [...b].some(([supplier,rows])=>commonOrder(rows,l.get(supplier)||[],r.get(supplier)||[]).conflict);
}

// After content merging, keep the chosen existing order and both insertion
// chains, including their neighbouring anchors. A cycle is actionable: choosing
// either side would silently relocate an insertion across a business boundary.
export function reconcileTransactionOrder(base,local,remote,rows){
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
