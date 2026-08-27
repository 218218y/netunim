import {clone} from '../core/values.js';
import {mergeRecordArray, mergeValue, mergeRecordArrayPreferLocal, mergeValuePreferLocal} from './merge-records.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createSyncMerge({normalizeState, prepareKupaCloudState}){
function mergeState3Way(base,local,remote){
  base=base||{};local=local||{};remote=remote||{};const conflicts=[];const out=clone(remote);
  out.version=Math.max(Number(base.version||1),Number(local.version||1),Number(remote.version||1));
  out.businessName=mergeValue(base.businessName,local.businessName,remote.businessName,'businessName',conflicts);
  out.checks=mergeRecordArray(base.checks,local.checks,remote.checks,'id','checks',conflicts);
  out.credits=mergeRecordArray(base.credits,local.credits,remote.credits,'id','credits',conflicts);
  out.cash=mergeRecordArray(base.cash,local.cash,remote.cash,'id','cash',conflicts);
  out.expenses=mergeRecordArray(base.expenses,local.expenses,remote.expenses,'id','expenses',conflicts);
  out.cards=mergeRecordArray(base.cards,local.cards,remote.cards,'name','cards',conflicts);
  const bb=base.bank||{},lb=local.bank||{},rb=remote.bank||{};
  out.bank={
    currentBalance:mergeValue(bb.currentBalance,lb.currentBalance,rb.currentBalance,'bank.currentBalance',conflicts),
    updatedAt:mergeValue(bb.updatedAt,lb.updatedAt,rb.updatedAt,'bank.updatedAt',conflicts),
    asOfDate:mergeValue(bb.asOfDate,lb.asOfDate,rb.asOfDate,'bank.asOfDate',conflicts),
    snapshotToken:mergeValue(bb.snapshotToken,lb.snapshotToken,rb.snapshotToken,'bank.snapshotToken',conflicts),
    snapshotSeq:mergeValue(bb.snapshotSeq,lb.snapshotSeq,rb.snapshotSeq,'bank.snapshotSeq',conflicts),
    adjustments:mergeRecordArray(bb.adjustments,lb.adjustments,rb.adjustments,'id','bank.adjustments',conflicts)
  };
  return {state:normalizeState(out),conflicts};
}

function rebaseLocalProgress(base,local,remote){
  base=base||{};local=local||{};remote=remote||{};const out=clone(remote);
  out.version=Math.max(Number(base.version||1),Number(local.version||1),Number(remote.version||1));
  out.businessName=mergeValuePreferLocal(base.businessName,local.businessName,remote.businessName);
  out.checks=mergeRecordArrayPreferLocal(base.checks,local.checks,remote.checks,'id');
  out.credits=mergeRecordArrayPreferLocal(base.credits,local.credits,remote.credits,'id');
  out.cash=mergeRecordArrayPreferLocal(base.cash,local.cash,remote.cash,'id');
  out.expenses=mergeRecordArrayPreferLocal(base.expenses,local.expenses,remote.expenses,'id');
  out.cards=mergeRecordArrayPreferLocal(base.cards,local.cards,remote.cards,'name');
  const bb=base.bank||{},lb=local.bank||{},rb=remote.bank||{};
  out.bank={
    currentBalance:mergeValuePreferLocal(bb.currentBalance,lb.currentBalance,rb.currentBalance),
    updatedAt:mergeValuePreferLocal(bb.updatedAt,lb.updatedAt,rb.updatedAt),
    asOfDate:mergeValuePreferLocal(bb.asOfDate,lb.asOfDate,rb.asOfDate),
    snapshotToken:mergeValuePreferLocal(bb.snapshotToken,lb.snapshotToken,rb.snapshotToken),
    snapshotSeq:mergeValuePreferLocal(bb.snapshotSeq,lb.snapshotSeq,rb.snapshotSeq),
    adjustments:mergeRecordArrayPreferLocal(bb.adjustments,lb.adjustments,rb.adjustments,'id')
  };
  return normalizeState(out);
}

function mergeKupaCloudState3Way(base,local,remote){const merged=mergeState3Way({...prepareKupaCloudState(base),checks:[]},{...prepareKupaCloudState(local),checks:[]},{...prepareKupaCloudState(remote),checks:[]});return {state:prepareKupaCloudState(merged.state),conflicts:merged.conflicts.filter(x=>!String(x).startsWith('checks:'))}}

function rebaseKupaCloudProgress(base,local,remote){return prepareKupaCloudState(rebaseLocalProgress({...prepareKupaCloudState(base),checks:[]},{...prepareKupaCloudState(local),checks:[]},{...prepareKupaCloudState(remote),checks:[]}))}

return { mergeState3Way, rebaseLocalProgress, mergeKupaCloudState3Way, rebaseKupaCloudProgress };
}
