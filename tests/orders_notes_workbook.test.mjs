import test from 'node:test';
import assert from 'node:assert/strict';
import {createStateNormalization} from '../netunim-orders/site/assets/js/state/normalization.js';
import {createSyncMerge} from '../netunim-orders/site/assets/js/sync/merge.js';
import {parseSheetClipboard,sheetColumnLabel} from '../shared/notes-sheet-model.js';
import {createNotesWorkbook} from '../shared/notes-workbook.js';

const {normalizeState,validateRestoreJson}=createStateNormalization({});
const {merge3}=createSyncMerge({normalizeState});
const seed=()=>normalizeState({notes:[{id:'N',content:'keep'}],notesSheet:{version:2,sheets:[{id:'S1',name:'First'},{id:'S2',name:'Second'}],columns:[{id:'C1',sheetId:'S1'},{id:'C2',sheetId:'S2'}],rows:[{id:'R1',sheetId:'S1',cells:{C1:'10'}},{id:'R2',sheetId:'S2',cells:{C2:'20'}}]}});

test('Orders initializes its own empty workbook and round-trips workbook backups',()=>{
  const a=normalizeState({}),b=normalizeState({});a.notesSheet.sheets[0].name='Local';
  assert.equal(b.notesSheet.sheets[0].name,'גליון 1');
  const original=seed();assert.deepEqual(validateRestoreJson(JSON.parse(JSON.stringify(original))).notesSheet,original.notesSheet);
  assert.throws(()=>normalizeState({notesSheet:{sheets:[],rows:[],columns:[]}}),/parent/);
  const orphan=seed();orphan.notesSheet.rows[0].sheetId='missing';assert.throws(()=>normalizeState(orphan),/parent/);
});

test('Orders merges independent workbook rows and rejects parent deletion racing a new child',()=>{
  const base=seed(),local=structuredClone(base),remote=structuredClone(base);
  local.notesSheet.rows[0].cells.C1='11';remote.notesSheet.rows[1].cells.C2='21';
  const merged=merge3(base,local,remote);assert.deepEqual(merged.conflicts,[]);
  assert.deepEqual(merged.state.notesSheet.rows.map(row=>Object.values(row.cells)[0]),['11','21']);
  const deleted=structuredClone(base),intents={};
  for(const part of ['sheets','columns','rows']){const key=part==='sheets'?'id':'sheetId';intents['notesSheet.'+part]=deleted.notesSheet[part].filter(row=>row[key]==='S1').map(row=>row.id);deleted.notesSheet[part]=deleted.notesSheet[part].filter(row=>row[key]!=='S1')}
  const concurrent=structuredClone(base);concurrent.notesSheet.rows.push({id:'new',sheetId:'S1',cells:{C1:'new remote'}});
  assert.ok(merge3(base,deleted,concurrent,{deleteIntents:intents}).conflicts.includes('notesSheet.sheets:S1'));
  const confirmed=merge3(base,deleted,base,{deleteIntents:intents});assert.deepEqual(confirmed.conflicts,[]);assert.equal(confirmed.state.notesSheet.sheets.length,1);
  const unconfirmed=merge3(base,deleted,base);assert.equal(unconfirmed.state.notesSheet.sheets.length,2);
});

test('Workbook deletion re-reads current state after asynchronous confirmation',async()=>{
  globalThis.document={querySelectorAll:()=>[]};globalThis.requestAnimationFrame=()=>{};
  const model={state:seed()};let confirm;const saves=[];
  const controller=createNotesWorkbook({model,ui:{notesSheetId:'S1'},saveState:(...args)=>saves.push(args),confirmDialog:()=>new Promise(resolve=>{confirm=resolve}),renderNotes(){},uid:()=>'',esc:x=>x,searchMatch:()=>true,site:'orders'});
  const pending=controller.deleteSheetRow('R1');
  model.state=seed();model.state.notesSheet.rows.push({id:'remote',sheetId:'S1',cells:{C1:'retained'}});
  confirm(true);await pending;
  assert.deepEqual(model.state.notesSheet.rows.map(row=>row.id),['R2','remote']);
  assert.deepEqual(saves[0][1].deleteIntents,{'notesSheet.rows':['R1']});
});

test('Excel TSV parser preserves empty cells, quotes, Unicode and quoted newlines',()=>{
  assert.deepEqual(parseSheetClipboard('שם\t"שורה\nשנייה"\t"a""b"\r\n\t2\t\r\n'),[['שם','שורה\nשנייה','a"b'],['','2','']]);
  assert.deepEqual(parseSheetClipboard('a\t\t'),[['a','','']]);
  assert.deepEqual([0,25,26,51,52,701,702].map(sheetColumnLabel),['A','Z','AA','AZ','BA','ZZ','AAA']);
});
