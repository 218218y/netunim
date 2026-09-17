import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createDomainsNotesController} from '../netunim-kupa/site/assets/js/domains/notes/controller.js';
import {NOTES_SHEET_DEFAULT_WIDTH,normalizeNotesSheet} from '../netunim-kupa/site/assets/js/domains/notes/sheet-model.js';
import {createContexts} from '../netunim-kupa/site/assets/js/state/contexts.js';

function makeDocument(){
  const content={innerHTML:''};
  return {
    content,
    getElementById:id=>id==='content'?content:null,
    querySelector:()=>null,
    querySelectorAll:()=>[]
  };
}

test('Kupa notes workspace defaults to sheet and renders the sheet button first in RTL',()=>{
  Object.defineProperty(globalThis,'document',{value:makeDocument(),configurable:true});
  Object.defineProperty(globalThis,'requestAnimationFrame',{value:fn=>fn(),configurable:true});
  const {model,ui}=createContexts();
  const notes=createDomainsNotesController({model,ui,saveState:()=>{},confirmDialog:async()=>true});
  notes.renderNotes();
  assert.equal(ui.notesTab,'sheet');
  const html=document.content.innerHTML,sheetAt=html.indexOf('data-action="notes-workspace-sheet"'),notesAt=html.indexOf('data-action="notes-workspace-notes"');
  assert.ok(sheetAt>=0&&notesAt>=0&&sheetAt<notesAt);
  assert.match(html,/data-action="notes-workspace-sheet">גליון<\/button>/);
});

test('Kupa sticky notes add, edit, flush and delete through the Kupa state',async()=>{
  Object.defineProperty(globalThis,'document',{value:makeDocument(),configurable:true});
  Object.defineProperty(globalThis,'requestAnimationFrame',{value:fn=>fn(),configurable:true});
  const saved=[];let allowDelete=true;
  const model={state:{notes:[]}},ui={notesTab:'notes'};
  const notes=createDomainsNotesController({model,ui,saveState:msg=>saved.push(msg),confirmDialog:async()=>allowDelete});
  notes.addStickyNote();
  assert.equal(model.state.notes.length,1);assert.match(document.content.innerHTML,/פתק חדש/);assert.equal(saved.at(-1),'פתק חדש נוסף');
  const id=model.state.notes[0].id;
  const dateNode={textContent:''};
  const el={value:'תזכורת קופה',style:{},scrollHeight:150,closest:()=>({querySelector:()=>dateNode})};
  notes.updateStickyNote(id,el);notes.blurStickyNote();
  assert.equal(model.state.notes[0].content,'תזכורת קופה');assert.equal(saved.at(-1),'הפתק עודכן');assert.match(dateNode.textContent,/עודכן/);
  await notes.deleteStickyNote(id);assert.equal(model.state.notes.length,0);assert.equal(saved.at(-1),'הפתק נמחק');assert.match(document.content.innerHTML,/אין עדיין פתקים/);
  allowDelete=false;
});

test('Kupa notes sheet keeps configurable columns, row cells and numeric totals in state',async()=>{
  Object.defineProperty(globalThis,'document',{value:makeDocument(),configurable:true});
  Object.defineProperty(globalThis,'requestAnimationFrame',{value:fn=>fn(),configurable:true});
  const saved=[],ui={notesTab:'notes'};
  const model={state:{notes:[],notesSheet:undefined}};
  const notes=createDomainsNotesController({model,ui,saveState:msg=>saved.push(msg),confirmDialog:async()=>true});
  notes.setNotesWorkspaceTab('sheet');
  assert.equal(ui.notesTab,'sheet');assert.match(document.content.innerHTML,/>סכום<\/span>/);
  notes.addSheetRow();
  assert.match(document.content.innerHTML,/data-keydown="navigate-notes-sheet-cell"/);
  assert.equal(model.state.notesSheet.rows.length,1);assert.equal(model.state.notesSheet.columns.length,5);
  const row=model.state.notesSheet.rows[0],col=model.state.notesSheet.columns[0];
  notes.saveSheetCell(row.id,col.id,{value:'1,250.5'});
  notes.setSheetColumnNumeric(col.id,true);
  assert.equal(model.state.notesSheet.columns[0].type,'number');assert.match(document.content.innerHTML,/1,250\.5/);
  notes.renameSheetColumn(col.id,{value:'סכום'});assert.equal(model.state.notesSheet.columns[0].title,'סכום');
  notes.addSheetColumn();assert.equal(model.state.notesSheet.columns.length,6);
  await notes.deleteSheetRow(row.id);assert.equal(model.state.notesSheet.rows.length,0);
  assert.ok(saved.includes('שורה חדשה נוספה לגליון'));assert.ok(saved.includes('סוג עמודה עודכן'));
});


test('Kupa notes workbook updates only legacy automatic sheet names to the new spelling',()=>{
  const legacyPrefix='\u05d2\u05d9\u05dc\u05d9\u05d5\u05df';
  const book=normalizeNotesSheet({version:2,sheets:[{id:'S1',name:`${legacyPrefix} 1`},{id:'S2',name:'מעקב מיוחד'}],columns:[],rows:[]});
  assert.equal(book.sheets[0].name,'גליון 1');
  assert.equal(book.sheets[1].name,'מעקב מיוחד');
});

test('Kupa notes workbook migrates the legacy single sheet to compact width without losing cells',()=>{
  const legacy={version:1,columns:[{id:'C1',title:'לקוח',type:'text',width:180},{id:'C2',title:'סכום',type:'number',width:240}],rows:[{id:'R1',cells:{C1:'אברהם',C2:'125'},createdAt:'2026-09-17T00:00:00Z',updatedAt:'2026-09-17T00:00:00Z'}]};
  const book=normalizeNotesSheet(legacy);
  assert.equal(book.version,2);assert.equal(book.sheets.length,1);assert.equal(book.sheets[0].name,'גליון 1');
  assert.deepEqual(book.columns.map(column=>column.width),[NOTES_SHEET_DEFAULT_WIDTH,NOTES_SHEET_DEFAULT_WIDTH]);
  assert.equal(book.rows[0].sheetId,book.sheets[0].id);assert.deepEqual(book.rows[0].cells,{C1:'אברהם',C2:'125'});
});

test('Kupa notes workbook creates separately named sheets and scopes new rows to the active sheet',()=>{
  Object.defineProperty(globalThis,'document',{value:makeDocument(),configurable:true});
  Object.defineProperty(globalThis,'requestAnimationFrame',{value:fn=>fn(),configurable:true});
  const saved=[],ui={notesTab:'sheet',notesSheetId:''},model={state:{notes:[],notesSheet:undefined}};
  const notes=createDomainsNotesController({model,ui,saveState:msg=>saved.push(msg),confirmDialog:async()=>true});
  notes.renderNotes();const firstId=model.state.notesSheet.sheets[0].id;notes.addSheetRow();
  assert.equal(model.state.notesSheet.rows.at(-1).sheetId,firstId);
  notes.addNotesSheet();const secondId=ui.notesSheetId;
  assert.notEqual(secondId,firstId);assert.equal(model.state.notesSheet.sheets.length,2);
  assert.ok(model.state.notesSheet.columns.filter(column=>column.sheetId===secondId).every(column=>column.width===NOTES_SHEET_DEFAULT_WIDTH));
  const nameInput={value:'מעקב מיוחד'};notes.renameNotesSheet(nameInput);assert.equal(model.state.notesSheet.sheets.find(sheet=>sheet.id===secondId).name,'מעקב מיוחד');
  notes.addSheetRow();assert.equal(model.state.notesSheet.rows.filter(row=>row.sheetId===firstId).length,1);assert.equal(model.state.notesSheet.rows.filter(row=>row.sheetId===secondId).length,1);
  notes.setActiveNotesSheet(firstId);assert.equal(ui.notesSheetId,firstId);assert.ok(saved.includes('גליון חדש נוסף'));assert.ok(saved.includes('שם הגליון עודכן'));
});

test('Kupa notes sheet arrow navigation follows the visual RTL grid',()=>{
  const doc=makeDocument();Object.defineProperty(globalThis,'document',{value:doc,configurable:true});
  Object.defineProperty(globalThis,'requestAnimationFrame',{value:fn=>fn(),configurable:true});
  const model={state:{notes:[],notesSheet:{version:1,columns:[
    {id:'C1',title:'א',type:'text',width:180},{id:'C2',title:'ב',type:'text',width:180},{id:'C3',title:'ג',type:'text',width:180}
  ],rows:[
    {id:'R1',cells:{},createdAt:'2026-09-03T10:00:00Z',updatedAt:'2026-09-03T10:00:00Z'},
    {id:'R2',cells:{},createdAt:'2026-09-03T10:00:00Z',updatedAt:'2026-09-03T10:00:00Z'}
  ]}}};
  const focused=[];
  const cells=[];for(const rowId of ['R1','R2'])for(const columnId of ['C1','C2','C3'])cells.push({dataset:{sheetRowId:rowId,sheetColumnId:columnId},focus:()=>focused.push(`${rowId}:${columnId}`),select:()=>{}});
  doc.querySelectorAll=selector=>selector==='[data-sheet-cell]'?cells:[];
  const notes=createDomainsNotesController({model,ui:{notesTab:'sheet'},saveState:()=>{},confirmDialog:async()=>true});
  let prevented=0;const event=key=>({key,preventDefault:()=>prevented++});
  notes.handleSheetCellKeydown('R1','C1',null,event('ArrowLeft'));
  notes.handleSheetCellKeydown('R1','C2',null,event('ArrowRight'));
  notes.handleSheetCellKeydown('R1','C2',null,event('ArrowDown'));
  notes.handleSheetCellKeydown('R2','C2',null,event('ArrowUp'));
  assert.deepEqual(focused,['R1:C2','R1:C1','R2:C2','R1:C2']);assert.equal(prevented,4);
});

test('Kupa notes sheet rerender preserves exact scroll offset and active cell after deferred browser focus scrolling',()=>{
  let html='',focusOptions=null,selection=null;const frames=[];
  const scrollBefore={scrollLeft:-347,scrollTop:19};let scroll=scrollBefore;
  const oldCell={dataset:{sheetRowId:'R1',sheetColumnId:'C1'},value:'abc',selectionStart:2,selectionEnd:2,selectionDirection:'none',matches:selector=>selector==='[data-sheet-cell]'};
  const doc={activeElement:oldCell,querySelector:selector=>selector==='.notes-sheet-scroll'?scroll:null,querySelectorAll:selector=>selector==='[data-sheet-cell]'?[doc.currentCell].filter(Boolean):[],getElementById:id=>id==='content'?content:null,currentCell:oldCell};
  const content={};Object.defineProperty(content,'innerHTML',{get:()=>html,set:value=>{
    html=value;scroll={scrollLeft:0,scrollTop:0};
    doc.currentCell={addEventListener(){},dataset:{sheetRowId:'R1',sheetColumnId:'C1'},value:'abc',selectionStart:0,selectionEnd:0,matches:selector=>selector==='[data-sheet-cell]',focus:opts=>{focusOptions=opts;doc.activeElement=doc.currentCell},setSelectionRange:(start,end,direction)=>{selection=[start,end,direction]}};
    doc.activeElement=null;
  }});
  Object.defineProperty(globalThis,'document',{value:doc,configurable:true});Object.defineProperty(globalThis,'requestAnimationFrame',{value:fn=>{frames.push(fn);return frames.length},configurable:true});
  const model={state:{notes:[],notesSheet:{version:1,columns:[{id:'C1',title:'א',type:'text',width:180}],rows:[{id:'R1',cells:{C1:'abc'},createdAt:'2026-09-03T10:00:00Z',updatedAt:'2026-09-03T10:00:00Z'}]}}};
  const notes=createDomainsNotesController({model,ui:{notesTab:'sheet'},saveState:()=>{},confirmDialog:async()=>true});
  notes.renderNotes();
  assert.equal(scroll.scrollLeft,-347);assert.equal(scroll.scrollTop,19);assert.deepEqual(focusOptions,{preventScroll:true});assert.deepEqual(selection,[2,2,'none']);assert.equal(doc.activeElement,doc.currentCell);
  scroll.scrollLeft=-331;scroll.scrollTop=27;for(const frame of frames.splice(0))frame();
  assert.equal(scroll.scrollLeft,-347);assert.equal(scroll.scrollTop,19);
});

test('Shared workbook bounds scrolling and freezes headers without a reserved RTL scrollbar gutter',()=>{
  const css=readFileSync(new URL('../shared/notes-workbook.css',import.meta.url),'utf8');
  const rule=css.match(/\.notes-sheet-scroll\{([^}]*)\}/)?.[1]||'';
  assert.match(rule,/overflow-x:auto/);assert.match(rule,/overflow-y:auto/);assert.match(rule,/max-height:65vh/);assert.match(rule,/scrollbar-gutter:auto/);assert.doesNotMatch(rule,/scrollbar-gutter:stable/);
});


test('Kupa workbook deletion confirms, removes only the selected sheet, and replaces the last sheet with fresh IDs',async()=>{
  Object.defineProperty(globalThis,'document',{value:makeDocument(),configurable:true});
  Object.defineProperty(globalThis,'requestAnimationFrame',{value:fn=>fn(),configurable:true});
  const model={state:{notes:[]}},ui={notesTab:'sheet'},saves=[];let confirm;
  const notes=createDomainsNotesController({model,ui,saveState:(message,options)=>saves.push(options),confirmDialog:()=>new Promise(resolve=>{confirm=resolve})});
  notes.renderNotes();notes.addSheetRow();const original=structuredClone(model.state.notesSheet);
  notes.addNotesSheet();notes.addSheetRow();const deletedId=ui.notesSheetId;
  let deletion=notes.deleteNotesSheet(deletedId);confirm(false);await deletion;
  assert.equal(model.state.notesSheet.sheets.length,2);
  deletion=notes.deleteNotesSheet(deletedId);
  // A cloud refresh while the dialog is open must not leave a stale reference.
  model.state=structuredClone(model.state);confirm(true);await deletion;
  assert.deepEqual(model.state.notesSheet,original);assert.equal(ui.notesSheetId,original.sheets[0].id);
  assert.deepEqual(saves.at(-1).deleteIntents['notesSheet.sheets'],[deletedId]);
  assert.equal(saves.at(-1).deleteIntents['notesSheet.rows'].length,1);
  assert.equal(saves.at(-1).deleteIntents['notesSheet.columns'].length,5);
  assert.equal(saves.at(-1).mutationType,'bulk-delete');
  deletion=notes.deleteNotesSheet(ui.notesSheetId);confirm(true);await deletion;
  assert.equal(model.state.notesSheet.sheets.length,1);assert.equal(model.state.notesSheet.rows.length,0);
  assert.notEqual(ui.notesSheetId,original.sheets[0].id);
  assert.ok(model.state.notesSheet.columns.every(column=>column.sheetId===ui.notesSheetId));
});
