import {equalSyncJson} from './sync-json.js';

// Opt in by collection. Unknown fields and financial/identity changes retain
// whole-record conflict semantics. Checks and debt progress have separate owners.
/** @type {Readonly<Record<string,readonly string[]>>} */
const policies=Object.freeze({
  'orders.transaction':['invoiceReceived','signed','supplied','supplyInfo','note','message','sequence'],
  'orders.note':['content','text'],
  'kupa.notes':['content'],
  'kupa.cash':['description','note'],
  'kupa.rights':['description','note'],
  'kupa.expenses':['description','note'],
});
/** @param {unknown} value @returns {value is Record<string,unknown>} */
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
/** @param {Record<string,unknown>} a @param {Record<string,unknown>} b @param {string} key */
const sameField=(a,b,key)=>Object.hasOwn(a,key)===Object.hasOwn(b,key)&&equalSyncJson(a[key],b[key]);

/** @param {unknown} base @param {unknown} local @param {unknown} remote @param {string} policy */
export function mergeBusinessRecord3(base,local,remote,policy){
  const fields=policies[policy];
  if(!fields||!object(base)||!object(local)||!object(remote))return null;
  const result=structuredClone(base),keys=new Set([...Object.keys(base),...Object.keys(local),...Object.keys(remote)]);
  for(const key of keys){
    const lc=!sameField(local,base,key),rc=!sameField(remote,base,key);
    if(!lc&&!rc)continue;
    if(key!=='updatedAt'&&!fields.includes(key))return null;
    if(key==='updatedAt'&&[local,remote].some(row=>{const value=row[key];return !sameField(row,base,key)&&(typeof value!=='string'||!Number.isFinite(Date.parse(value)))}))return null;
    let source=lc?local:remote;
    if(lc&&rc&&!sameField(local,remote,key)){
      if(key!=='updatedAt')return null;
      const left=local[key],right=remote[key];if(typeof left!=='string'||typeof right!=='string')return null;
      const l=Date.parse(left),r=Date.parse(right);
      if(!Number.isFinite(l)||!Number.isFinite(r))return null;
      source=l>r||l===r&&left>right?local:remote;
    }
    if(Object.hasOwn(source,key))result[key]=structuredClone(source[key]);else delete result[key];
  }
  return result;
}

