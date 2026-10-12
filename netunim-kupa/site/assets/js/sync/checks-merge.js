import {clone} from '../core/values.js';
import {normalizeSharedChecks} from '../shared/shared-checks-contract.js';
import {jsonEq,mergeRecordArray,mergeRecordArrayPreferLocal} from './merge-records.js';

function normalizeDeleteIds(value){
  return [...new Set((Array.isArray(value)?value:[]).map(x=>String(x||'').trim()).filter(Boolean))].sort();
}

// Missing records never imply deletion. A caller must supply explicit intent.
export function mergeSharedChecks(base,local,remote,{preferLocalConflicts=false,deleteIds=[],bootstrapActive=false}={}){
  const b=normalizeSharedChecks(base||[]),rawLocal=normalizeSharedChecks(local||[]),r=normalizeSharedChecks(remote||[]);
  const allowed=new Set(normalizeDeleteIds(deleteIds));
  if(bootstrapActive&&!rawLocal.length&&r.length>0&&b.length>0&&jsonEq(b,r)&&!allowed.size){
    return {checks:clone(r),conflicts:[],repairedEmptyBootstrap:true};
  }
  const safe=clone(rawLocal),present=new Set(safe.map(item=>item.id));
  for(const item of b){
    if(item?.id&&!present.has(item.id)&&!allowed.has(item.id)){safe.push(clone(item));present.add(item.id)}
  }
  const conflicts=[];
  let checks=mergeRecordArray(b,safe,r,'id','checks',conflicts);
  if(preferLocalConflicts&&conflicts.length)checks=mergeRecordArrayPreferLocal(b,safe,r,'id');
  return {checks:normalizeSharedChecks(checks),conflicts,repairedEmptyBootstrap:false};
}

// Bootstrap is a one-shot business policy, independent of a live cloud runtime.
export function createSharedChecksMerge({checksSession={}}={}){
  return (base,local,remote,options={})=>{
    const bootstrapActive=checksSession.sharedChecksBootstrapActive;
    checksSession.sharedChecksBootstrapActive=false;
    return mergeSharedChecks(base,local,remote,{...options,bootstrapActive});
  };
}
