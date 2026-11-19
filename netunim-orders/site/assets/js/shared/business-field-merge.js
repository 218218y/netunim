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

/** @param {Record<string,unknown>} base @param {Record<string,unknown>} review @param {Record<string,unknown>} updated */
function mergeCheckReview(base,review,updated){
  const event=review.bankReview,original=base.bankMatch;
  if(typeof event!=='string'||!event||event===base.bankReview||!object(original)||original.eventId!==event)return null;
  const fields=new Set([...Object.keys(base),...Object.keys(review)]);
  if([...fields].some(key=>key!=='bankReview'&&!sameField(base,review,key)))return null;
  if(!sameField(updated,base,'bankReview')&&!sameField(updated,review,'bankReview'))return null;
  const match=updated.bankMatch,history=updated.bankHistory;
  const recorded=(object(match)&&match.eventId===event)||(Array.isArray(history)&&history.some(entry=>object(entry)&&entry.eventId===event));
  // An acknowledgement belongs to its event, even if the bank has since
  // reported a new match. A local rejection or business edit follows the
  // ordinary conflict rules.
  return recorded?{...structuredClone(updated),bankReview:event}:null;
}

/** @param {Record<string,unknown>} check */
function checkWithoutNote(check){
  const fields={...check};
  delete fields.note;
  return fields;
}

/** @param {Record<string,unknown>} base @param {Record<string,unknown>} local @param {Record<string,unknown>} remote */
function mergeCheck(base,local,remote){
  const localNoteChanged=!sameField(base,local,'note'),remoteNoteChanged=!sameField(base,remote,'note');
  if(!localNoteChanged&&!remoteNoteChanged)return mergeCheckReview(base,local,remote);
  if(localNoteChanged&&remoteNoteChanged&&!sameField(local,remote,'note'))return null;

  // Notes do not affect the bank or financial state. Keep the existing review
  // proof and whole-record conflict rules for the remaining fields.
  const baseFields=checkWithoutNote(base),localFields=checkWithoutNote(local),remoteFields=checkWithoutNote(remote);
  let merged;
  if(equalSyncJson(baseFields,localFields))merged=remoteFields;
  else if(equalSyncJson(baseFields,remoteFields)||equalSyncJson(localFields,remoteFields))merged=localFields;
  else merged=mergeCheckReview(baseFields,localFields,remoteFields);
  if(!merged)return null;
  const noteSource=localNoteChanged?local:remote;
  if(Object.hasOwn(noteSource,'note'))return structuredClone({...merged,note:noteSource.note});
  return structuredClone(merged);
}

/** @param {unknown} base @param {unknown} local @param {unknown} remote @param {string} policy */
export function mergeBusinessRecord3(base,local,remote,policy){
  if(policy==='orders.check'||policy==='kupa.checks'){
    if(!object(base)||!object(local)||!object(remote))return null;
    return mergeCheck(base,local,remote);
  }
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

