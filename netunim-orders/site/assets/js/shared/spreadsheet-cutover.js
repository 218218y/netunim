import {createOperationId} from './cloud-sync.js';

export function withoutEmbeddedWorkbook(source){const state=structuredClone(source||{});delete state.notesSheet;state.notesWorkbookExternal=1;return state}

export async function detachLegacyOutbox(record,capture){
  if(!record?.snapshot?.notesSheet)return record;
  await capture(record.snapshot.notesSheet,record.baseState?.notesSheet,record.deleteIntents||{});
  // This is a new main-document snapshot. Never reuse a flight's old idempotency
  // key with a modified payload; normal three-way merge still fences its base.
  return {...record,snapshot:withoutEmbeddedWorkbook(record.snapshot),baseState:withoutEmbeddedWorkbook(record.baseState),operationId:createOperationId('workbook-cutover'),generation:Number(record.generation||0)+1,mutationSeq:Number(record.mutationSeq||record.generation||0)+1,deleteIntents:Object.fromEntries(Object.entries(record.deleteIntents||{}).filter(([key])=>!key.startsWith('notesSheet.')))};
}
