import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createDomainsNotesController} from '../netunim-kupa/site/assets/js/domains/notes/controller.js';

function makeDocument(){
  const content={innerHTML:''};
  return {
    content,
    getElementById:id=>id==='content'?content:null,
    querySelector:()=>null,
    querySelectorAll:()=>[]
  };
}

test('Kupa sticky notes add, edit, flush and delete through the Kupa state',async()=>{
  Object.defineProperty(globalThis,'document',{value:makeDocument(),configurable:true});
  Object.defineProperty(globalThis,'requestAnimationFrame',{value:fn=>fn(),configurable:true});
  const saved=[];let allowDelete=true;
  const model={state:{notes:[]}};
  const notes=createDomainsNotesController({model,saveState:msg=>saved.push(msg),confirmDialog:async()=>allowDelete});
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
  assert.ok(saved.includes('שורה חדשה נוספה לגיליון'));assert.ok(saved.includes('סוג עמודה עודכן'));
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
    doc.currentCell={dataset:{sheetRowId:'R1',sheetColumnId:'C1'},value:'abc',selectionStart:0,selectionEnd:0,matches:selector=>selector==='[data-sheet-cell]',focus:opts=>{focusOptions=opts;doc.activeElement=doc.currentCell},setSelectionRange:(start,end,direction)=>{selection=[start,end,direction]}};
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

test('Kupa notes sheet uses a horizontal-only scroller without a reserved RTL scrollbar gutter',()=>{
  const css=readFileSync(new URL('../netunim-kupa/site/assets/app.css',import.meta.url),'utf8');
  const rule=css.match(/\.notes-sheet-scroll\{([^}]*)\}/)?.[1]||'';
  assert.match(rule,/overflow-x:auto/);assert.match(rule,/overflow-y:hidden/);assert.match(rule,/scrollbar-gutter:auto/);assert.doesNotMatch(rule,/scrollbar-gutter:stable/);
});
