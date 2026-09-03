import test from 'node:test';
import assert from 'node:assert/strict';
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
  assert.equal(ui.notesTab,'sheet');assert.match(document.content.innerHTML,/Σ מספרים/);
  notes.addSheetRow();
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
