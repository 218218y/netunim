import {equalSyncJson} from './cloud-sync.js';

function finiteRevision(value){const n=Number(value);return Number.isSafeInteger(n)&&n>=0?n:0}
function unique(values){return [...new Set((Array.isArray(values)?values:[values]).filter(Boolean).map(String))]}

// Small explicit revision ledger for render/selector invalidation. Local mutations
// bump known domains directly; whole-state replacements reconcile only at the
// replacement boundary, never from a render path.
export function createDomainRevisionLedger({target={},domains={}}={}){
  const definitions=new Map(Object.entries(domains));
  target.globalEpoch=finiteRevision(target.globalEpoch);
  for(const [name,definition] of definitions){
    const field=definition?.field||`${name}Rev`;
    target[field]=finiteRevision(target[field]);
  }

  function definition(name){
    const value=definitions.get(String(name));
    if(!value)throw new Error(`unknown domain revision: ${name}`);
    return value;
  }

  function touch(values){
    const changed=[];
    for(const name of unique(values)){
      const item=definition(name),field=item.field||`${name}Rev`;
      target[field]=finiteRevision(target[field])+1;changed.push(name);
    }
    return changed;
  }

  function touchAll(){target.globalEpoch=finiteRevision(target.globalEpoch)+1;return target.globalEpoch}

  function stamp(values){
    const parts=[finiteRevision(target.globalEpoch)];
    for(const name of unique(values)){
      const item=definition(name),field=item.field||`${name}Rev`;parts.push(finiteRevision(target[field]));
    }
    return parts.join(':');
  }

  function reconcile(previous,next,{forceAll=false}={}){
    if(forceAll){touchAll();return [...definitions.keys()]}
    const changed=[];
    for(const [name,item] of definitions){
      if(typeof item?.select!=='function')continue;
      if(!equalSyncJson(item.select(previous),item.select(next)))changed.push(name);
    }
    if(changed.length)touch(changed);
    return changed;
  }

  function snapshot(){return Object.freeze({...target})}
  return {target,touch,touchAll,stamp,reconcile,snapshot};
}
