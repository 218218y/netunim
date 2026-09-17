import {clone} from '../core/values.js';
import {jsonEq, mergeRecordArray, mergeValue, mergeRecordArrayPreferLocal, mergeValuePreferLocal} from './merge-records.js';
import {migrateLegacyCards3Way} from './legacy-card-migration.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createSyncMerge({normalizeState, prepareKupaCloudState}){
function protectImplicitDeletes(base,local,deleteIds,key='id'){
  const allowed=new Set((Array.isArray(deleteIds)?deleteIds:[]).map(x=>String(x||'').trim()).filter(Boolean));
  const safe=clone(Array.isArray(local)?local:[]),present=new Set(safe.map(x=>String(x?.[key]??'')));
  for(const item of Array.isArray(base)?base:[]){const id=String(item?.[key]??'');if(id&&!present.has(id)&&!allowed.has(id)){safe.push(clone(item));present.add(id)}}
  return safe;
}
function mergeNotesWorkbook(base={},local={},remote={},deleteIntents={},conflicts=[],preferLocal=false){
  const safe={version:2};
  for(const part of ['sheets','columns','rows'])safe[part]=protectImplicitDeletes(base[part],local[part],deleteIntents[`notesSheet.${part}`]);
  const book={version:2},problems=[];
  // Deleting a parent conflicts with edits OR additions anywhere in that sheet.
  // Independent array merges alone miss a new row beneath a deleted parent.
  for(const sheet of base.sheets||[]){
    const localHas=safe.sheets.some(row=>row.id===sheet.id),remoteHas=(remote.sheets||[]).some(row=>row.id===sheet.id);
    if(localHas===remoteHas)continue;
    const surviving=localHas?safe:remote;
    if(['columns','rows'].some(part=>!jsonEq((base[part]||[]).filter(row=>row.sheetId===sheet.id),(surviving[part]||[]).filter(row=>row.sheetId===sheet.id))))problems.push(`notesSheet.sheets:${sheet.id}`);
  }
  for(const part of ['sheets','columns','rows'])book[part]=preferLocal
    ?mergeRecordArrayPreferLocal(base[part],safe[part],remote[part],'id')
    :mergeRecordArray(base[part],safe[part],remote[part],'id',`notesSheet.${part}`,problems);
  // Two computers can each delete a different sheet while retaining the other.
  // Do not let normalization silently resurrect a default sheet after that merge.
  if((base.sheets||[]).length&&!book.sheets.length)problems.push('notesSheet.sheets');
  if(problems.length){conflicts.push(...new Set(problems));return clone(preferLocal?safe:remote)}
  return book;
}
function mergeState3Way(base,local,remote,{deleteIntents={}}={}){
  const lineage=migrateLegacyCards3Way(base,local,remote);
  if(lineage.conflicts.length)return {state:normalizeState(clone(remote||{})),conflicts:lineage.conflicts};
  base=lineage.base;local=lineage.local;remote=lineage.remote;deleteIntents={...deleteIntents,cards:[...new Set([...(deleteIntents.cards||[]),...lineage.localDeletedIds])]};const conflicts=[];const out=clone(remote);
  out.version=Math.max(Number(base.version||1),Number(local.version||1),Number(remote.version||1));
  out.businessName=mergeValue(base.businessName,local.businessName,remote.businessName,'businessName',conflicts);
  out.checks=mergeRecordArray(base.checks,local.checks,remote.checks,'id','checks',conflicts);
  out.credits=mergeRecordArray(base.credits,protectImplicitDeletes(base.credits,local.credits,deleteIntents.credits),remote.credits,'id','credits',conflicts);
  out.cash=mergeRecordArray(base.cash,protectImplicitDeletes(base.cash,local.cash,deleteIntents.cash),remote.cash,'id','cash',conflicts);
  out.rights=mergeRecordArray(base.rights,protectImplicitDeletes(base.rights,local.rights,deleteIntents.rights),remote.rights,'id','rights',conflicts);
  out.rightsLastCalculatedDate=mergeValue(base.rightsLastCalculatedDate,local.rightsLastCalculatedDate,remote.rightsLastCalculatedDate,'rightsLastCalculatedDate',conflicts);
  out.notes=mergeRecordArray(base.notes,protectImplicitDeletes(base.notes,local.notes,deleteIntents.notes),remote.notes,'id','notes',conflicts);
  out.notesSheet=mergeNotesWorkbook(base.notesSheet,local.notesSheet,remote.notesSheet,deleteIntents,conflicts);
  out.expenses=mergeRecordArray(base.expenses,protectImplicitDeletes(base.expenses,local.expenses,deleteIntents.expenses),remote.expenses,'id','expenses',conflicts);
  out.cards=mergeRecordArray(base.cards,protectImplicitDeletes(base.cards,local.cards,deleteIntents.cards),remote.cards,'id','cards',conflicts);
  const bc=base.cashflowSettings||{},lc=local.cashflowSettings||{},rc=remote.cashflowSettings||{};
  out.cashflowSettings={version:3,businessMinimum:mergeValue(bc.businessMinimum,lc.businessMinimum,rc.businessMinimum,'cashflowSettings.businessMinimum',conflicts),homeMinimum:mergeValue(bc.homeMinimum,lc.homeMinimum,rc.homeMinimum,'cashflowSettings.homeMinimum',conflicts),businessCheckCutoffDay:mergeValue(bc.businessCheckCutoffDay,lc.businessCheckCutoffDay,rc.businessCheckCutoffDay,'cashflowSettings.businessCheckCutoffDay',conflicts),homeCheckCutoffDay:mergeValue(bc.homeCheckCutoffDay,lc.homeCheckCutoffDay,rc.homeCheckCutoffDay,'cashflowSettings.homeCheckCutoffDay',conflicts)};
  const bb=base.bank||{},lb=local.bank||{},rb=remote.bank||{};
  out.bank={currentBalance:mergeValue(bb.currentBalance,lb.currentBalance,rb.currentBalance,'bank.currentBalance',conflicts),updatedAt:mergeValue(bb.updatedAt,lb.updatedAt,rb.updatedAt,'bank.updatedAt',conflicts),asOfDate:mergeValue(bb.asOfDate,lb.asOfDate,rb.asOfDate,'bank.asOfDate',conflicts),snapshotToken:mergeValue(bb.snapshotToken,lb.snapshotToken,rb.snapshotToken,'bank.snapshotToken',conflicts),snapshotSeq:mergeValue(bb.snapshotSeq,lb.snapshotSeq,rb.snapshotSeq,'bank.snapshotSeq',conflicts),source:mergeValue(bb.source,lb.source,rb.source,'bank.source',conflicts),sourceAccount:mergeValue(bb.sourceAccount,lb.sourceAccount,rb.sourceAccount,'bank.sourceAccount',conflicts),bankSyncAt:mergeValue(bb.bankSyncAt,lb.bankSyncAt,rb.bankSyncAt,'bank.bankSyncAt',conflicts),feed:mergeValue(bb.feed,lb.feed,rb.feed,'bank.feed',conflicts),homeFeed:mergeValue(bb.homeFeed,lb.homeFeed,rb.homeFeed,'bank.homeFeed',conflicts),adjustments:mergeValue(bb.adjustments,lb.adjustments,rb.adjustments,'bank.adjustments',conflicts)};
  return {state:normalizeState(out),conflicts};
}
function rebaseLocalProgress(base,local,remote,{deleteIntents={}}={}){
  const lineage=migrateLegacyCards3Way(base,local,remote);
  if(lineage.conflicts.length){const error=new Error('legacy_card_migration_conflict');error.code='legacy_card_migration_conflict';error.conflicts=lineage.conflicts;throw error}
  base=lineage.base;local=lineage.local;remote=lineage.remote;deleteIntents={...deleteIntents,cards:[...new Set([...(deleteIntents.cards||[]),...lineage.localDeletedIds])]};const out=clone(remote);
  out.version=Math.max(Number(base.version||1),Number(local.version||1),Number(remote.version||1));
  out.businessName=mergeValuePreferLocal(base.businessName,local.businessName,remote.businessName);
  out.checks=mergeRecordArrayPreferLocal(base.checks,local.checks,remote.checks,'id');
  out.credits=mergeRecordArrayPreferLocal(base.credits,protectImplicitDeletes(base.credits,local.credits,deleteIntents.credits),remote.credits,'id');
  out.cash=mergeRecordArrayPreferLocal(base.cash,protectImplicitDeletes(base.cash,local.cash,deleteIntents.cash),remote.cash,'id');
  out.rights=mergeRecordArrayPreferLocal(base.rights,protectImplicitDeletes(base.rights,local.rights,deleteIntents.rights),remote.rights,'id');
  out.rightsLastCalculatedDate=mergeValuePreferLocal(base.rightsLastCalculatedDate,local.rightsLastCalculatedDate,remote.rightsLastCalculatedDate);
  out.notes=mergeRecordArrayPreferLocal(base.notes,protectImplicitDeletes(base.notes,local.notes,deleteIntents.notes),remote.notes,'id');
  out.notesSheet=mergeNotesWorkbook(base.notesSheet,local.notesSheet,remote.notesSheet,deleteIntents,[],true);
  out.expenses=mergeRecordArrayPreferLocal(base.expenses,protectImplicitDeletes(base.expenses,local.expenses,deleteIntents.expenses),remote.expenses,'id');
  out.cards=mergeRecordArrayPreferLocal(base.cards,protectImplicitDeletes(base.cards,local.cards,deleteIntents.cards),remote.cards,'id');
  const bc=base.cashflowSettings||{},lc=local.cashflowSettings||{},rc=remote.cashflowSettings||{};
  out.cashflowSettings={version:3,businessMinimum:mergeValuePreferLocal(bc.businessMinimum,lc.businessMinimum,rc.businessMinimum),homeMinimum:mergeValuePreferLocal(bc.homeMinimum,lc.homeMinimum,rc.homeMinimum),businessCheckCutoffDay:mergeValuePreferLocal(bc.businessCheckCutoffDay,lc.businessCheckCutoffDay,rc.businessCheckCutoffDay),homeCheckCutoffDay:mergeValuePreferLocal(bc.homeCheckCutoffDay,lc.homeCheckCutoffDay,rc.homeCheckCutoffDay)};
  const bb=base.bank||{},lb=local.bank||{},rb=remote.bank||{};
  out.bank={currentBalance:mergeValuePreferLocal(bb.currentBalance,lb.currentBalance,rb.currentBalance),updatedAt:mergeValuePreferLocal(bb.updatedAt,lb.updatedAt,rb.updatedAt),asOfDate:mergeValuePreferLocal(bb.asOfDate,lb.asOfDate,rb.asOfDate),snapshotToken:mergeValuePreferLocal(bb.snapshotToken,lb.snapshotToken,rb.snapshotToken),snapshotSeq:mergeValuePreferLocal(bb.snapshotSeq,lb.snapshotSeq,rb.snapshotSeq),source:mergeValuePreferLocal(bb.source,lb.source,rb.source),sourceAccount:mergeValuePreferLocal(bb.sourceAccount,lb.sourceAccount,rb.sourceAccount),bankSyncAt:mergeValuePreferLocal(bb.bankSyncAt,lb.bankSyncAt,rb.bankSyncAt),feed:mergeValuePreferLocal(bb.feed,lb.feed,rb.feed),homeFeed:mergeValuePreferLocal(bb.homeFeed,lb.homeFeed,rb.homeFeed),adjustments:mergeValuePreferLocal(bb.adjustments,lb.adjustments,rb.adjustments)};
  return normalizeState(out);
}
function alignCloudInputs(base,local,remote){
  const lineage=migrateLegacyCards3Way(base,local,remote);
  if(lineage.conflicts.length)return lineage;
  return {...lineage,base:{...prepareKupaCloudState(lineage.base),checks:[]},local:{...prepareKupaCloudState(lineage.local),checks:[]},remote:{...prepareKupaCloudState(lineage.remote),checks:[]}};
}
function mergeKupaCloudState3Way(base,local,remote,{deleteIntents={}}={}){const lineage=alignCloudInputs(base,local,remote);if(lineage.conflicts.length)return {state:prepareKupaCloudState(remote),conflicts:lineage.conflicts};const intents={...deleteIntents,cards:[...new Set([...(deleteIntents.cards||[]),...lineage.localDeletedIds])]};const merged=mergeState3Way(lineage.base,lineage.local,lineage.remote,{deleteIntents:intents});return {state:prepareKupaCloudState(merged.state),conflicts:merged.conflicts.filter(x=>!String(x).startsWith('checks:'))}}
function rebaseKupaCloudProgress(base,local,remote,options={}){return mergeKupaCloudState3Way(base,local,remote,options)}
return { mergeState3Way, rebaseLocalProgress, mergeKupaCloudState3Way, rebaseKupaCloudProgress };
}
