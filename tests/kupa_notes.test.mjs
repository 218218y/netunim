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
