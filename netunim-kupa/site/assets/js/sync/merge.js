import {clone} from '../core/values.js';
import {mergeRecordArray, mergeValue, mergeRecordArrayPreferLocal, mergeValuePreferLocal} from './merge-records.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createSyncMerge({normalizeState, prepareKupaCloudState}){
function protectImplicitDeletes(base,local,deleteIds,key='id'){
  const allowed=new Set((Array.isArray(deleteIds)?deleteIds:[]).map(x=>String(x||'').trim()).filter(Boolean));
  const safe=clone(Array.isArray(local)?local:[]),present=new Set(safe.map(x=>String(x?.[key]??'')));
  for(const item of Array.isArray(base)?base:[]){const id=String(item?.[key]??'');if(id&&!present.has(id)&&!allowed.has(id)){safe.push(clone(item));present.add(id)}}
  return safe;
}
function mergeState3Way(base,local,remote,{deleteIntents={}}={}){
  base=base||{};local=local||{};remote=remote||{};const conflicts=[];const out=clone(remote);
  out.version=Math.max(Number(base.version||1),Number(local.version||1),Number(remote.version||1));
  out.businessName=mergeValue(base.businessName,local.businessName,remote.businessName,'businessName',conflicts);
  out.checks=mergeRecordArray(base.checks,local.checks,remote.checks,'id','checks',conflicts);
  out.credits=mergeRecordArray(base.credits,protectImplicitDeletes(base.credits,local.credits,deleteIntents.credits),remote.credits,'id','credits',conflicts);
  out.cash=mergeRecordArray(base.cash,protectImplicitDeletes(base.cash,local.cash,deleteIntents.cash),remote.cash,'id','cash',conflicts);
  out.rights=mergeRecordArray(base.rights,protectImplicitDeletes(base.rights,local.rights,deleteIntents.rights),remote.rights,'id','rights',conflicts);
  out.rightsLastCalculatedDate=mergeValue(base.rightsLastCalculatedDate,local.rightsLastCalculatedDate,remote.rightsLastCalculatedDate,'rightsLastCalculatedDate',conflicts);
  out.notes=mergeRecordArray(base.notes,protectImplicitDeletes(base.notes,local.notes,deleteIntents.notes),remote.notes,'id','notes',conflicts);
  {const bs=base.notesSheet||{},ls=local.notesSheet||{},rs=remote.notesSheet||{};out.notesSheet={version:1,columns:mergeRecordArray(bs.columns,protectImplicitDeletes(bs.columns,ls.columns,deleteIntents['notesSheet.columns']),rs.columns,'id','notesSheet.columns',conflicts),rows:mergeRecordArray(bs.rows,protectImplicitDeletes(bs.rows,ls.rows,deleteIntents['notesSheet.rows']),rs.rows,'id','notesSheet.rows',conflicts)}}
  out.expenses=mergeRecordArray(base.expenses,protectImplicitDeletes(base.expenses,local.expenses,deleteIntents.expenses),remote.expenses,'id','expenses',conflicts);
  out.cards=mergeRecordArray(base.cards,local.cards,remote.cards,'name','cards',conflicts);
  const bc=base.cashflowSettings||{},lc=local.cashflowSettings||{},rc=remote.cashflowSettings||{};
  out.cashflowSettings={version:1,businessMinimum:mergeValue(bc.businessMinimum,lc.businessMinimum,rc.businessMinimum,'cashflowSettings.businessMinimum',conflicts),homeMinimum:mergeValue(bc.homeMinimum,lc.homeMinimum,rc.homeMinimum,'cashflowSettings.homeMinimum',conflicts)};
  const bb=base.bank||{},lb=local.bank||{},rb=remote.bank||{};
  out.bank={currentBalance:mergeValue(bb.currentBalance,lb.currentBalance,rb.currentBalance,'bank.currentBalance',conflicts),updatedAt:mergeValue(bb.updatedAt,lb.updatedAt,rb.updatedAt,'bank.updatedAt',conflicts),asOfDate:mergeValue(bb.asOfDate,lb.asOfDate,rb.asOfDate,'bank.asOfDate',conflicts),snapshotToken:mergeValue(bb.snapshotToken,lb.snapshotToken,rb.snapshotToken,'bank.snapshotToken',conflicts),snapshotSeq:mergeValue(bb.snapshotSeq,lb.snapshotSeq,rb.snapshotSeq,'bank.snapshotSeq',conflicts),source:mergeValue(bb.source,lb.source,rb.source,'bank.source',conflicts),sourceAccount:mergeValue(bb.sourceAccount,lb.sourceAccount,rb.sourceAccount,'bank.sourceAccount',conflicts),bankSyncAt:mergeValue(bb.bankSyncAt,lb.bankSyncAt,rb.bankSyncAt,'bank.bankSyncAt',conflicts),feed:mergeValue(bb.feed,lb.feed,rb.feed,'bank.feed',conflicts),homeFeed:mergeValue(bb.homeFeed,lb.homeFeed,rb.homeFeed,'bank.homeFeed',conflicts),adjustments:mergeRecordArray(bb.adjustments,lb.adjustments,rb.adjustments,'id','bank.adjustments',conflicts)};
  return {state:normalizeState(out),conflicts};
}
function rebaseLocalProgress(base,local,remote,{deleteIntents={}}={}){
  base=base||{};local=local||{};remote=remote||{};const out=clone(remote);
  out.version=Math.max(Number(base.version||1),Number(local.version||1),Number(remote.version||1));
  out.businessName=mergeValuePreferLocal(base.businessName,local.businessName,remote.businessName);
  out.checks=mergeRecordArrayPreferLocal(base.checks,local.checks,remote.checks,'id');
  out.credits=mergeRecordArrayPreferLocal(base.credits,protectImplicitDeletes(base.credits,local.credits,deleteIntents.credits),remote.credits,'id');
  out.cash=mergeRecordArrayPreferLocal(base.cash,protectImplicitDeletes(base.cash,local.cash,deleteIntents.cash),remote.cash,'id');
  out.rights=mergeRecordArrayPreferLocal(base.rights,protectImplicitDeletes(base.rights,local.rights,deleteIntents.rights),remote.rights,'id');
  out.rightsLastCalculatedDate=mergeValuePreferLocal(base.rightsLastCalculatedDate,local.rightsLastCalculatedDate,remote.rightsLastCalculatedDate);
  out.notes=mergeRecordArrayPreferLocal(base.notes,protectImplicitDeletes(base.notes,local.notes,deleteIntents.notes),remote.notes,'id');
  {const bs=base.notesSheet||{},ls=local.notesSheet||{},rs=remote.notesSheet||{};out.notesSheet={version:1,columns:mergeRecordArrayPreferLocal(bs.columns,protectImplicitDeletes(bs.columns,ls.columns,deleteIntents['notesSheet.columns']),rs.columns,'id'),rows:mergeRecordArrayPreferLocal(bs.rows,protectImplicitDeletes(bs.rows,ls.rows,deleteIntents['notesSheet.rows']),rs.rows,'id')}}
  out.expenses=mergeRecordArrayPreferLocal(base.expenses,protectImplicitDeletes(base.expenses,local.expenses,deleteIntents.expenses),remote.expenses,'id');
  out.cards=mergeRecordArrayPreferLocal(base.cards,local.cards,remote.cards,'name');
  const bc=base.cashflowSettings||{},lc=local.cashflowSettings||{},rc=remote.cashflowSettings||{};
  out.cashflowSettings={version:1,businessMinimum:mergeValuePreferLocal(bc.businessMinimum,lc.businessMinimum,rc.businessMinimum),homeMinimum:mergeValuePreferLocal(bc.homeMinimum,lc.homeMinimum,rc.homeMinimum)};
  const bb=base.bank||{},lb=local.bank||{},rb=remote.bank||{};
  out.bank={currentBalance:mergeValuePreferLocal(bb.currentBalance,lb.currentBalance,rb.currentBalance),updatedAt:mergeValuePreferLocal(bb.updatedAt,lb.updatedAt,rb.updatedAt),asOfDate:mergeValuePreferLocal(bb.asOfDate,lb.asOfDate,rb.asOfDate),snapshotToken:mergeValuePreferLocal(bb.snapshotToken,lb.snapshotToken,rb.snapshotToken),snapshotSeq:mergeValuePreferLocal(bb.snapshotSeq,lb.snapshotSeq,rb.snapshotSeq),source:mergeValuePreferLocal(bb.source,lb.source,rb.source),sourceAccount:mergeValuePreferLocal(bb.sourceAccount,lb.sourceAccount,rb.sourceAccount),bankSyncAt:mergeValuePreferLocal(bb.bankSyncAt,lb.bankSyncAt,rb.bankSyncAt),feed:mergeValuePreferLocal(bb.feed,lb.feed,rb.feed),homeFeed:mergeValuePreferLocal(bb.homeFeed,lb.homeFeed,rb.homeFeed),adjustments:mergeRecordArrayPreferLocal(bb.adjustments,lb.adjustments,rb.adjustments,'id')};
  return normalizeState(out);
}
function mergeKupaCloudState3Way(base,local,remote,{deleteIntents={}}={}){const merged=mergeState3Way({...prepareKupaCloudState(base),checks:[]},{...prepareKupaCloudState(local),checks:[]},{...prepareKupaCloudState(remote),checks:[]},{deleteIntents});return {state:prepareKupaCloudState(merged.state),conflicts:merged.conflicts.filter(x=>!String(x).startsWith('checks:'))}}
function rebaseKupaCloudProgress(base,local,remote,{deleteIntents={}}={}){return prepareKupaCloudState(rebaseLocalProgress({...prepareKupaCloudState(base),checks:[]},{...prepareKupaCloudState(local),checks:[]},{...prepareKupaCloudState(remote),checks:[]},{deleteIntents}))}
return { mergeState3Way, rebaseLocalProgress, mergeKupaCloudState3Way, rebaseKupaCloudProgress };
}
