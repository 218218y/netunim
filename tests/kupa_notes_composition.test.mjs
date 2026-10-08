import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createKupaNotesRuntime} from '../netunim-kupa/site/assets/js/composition/notes.js';

test('Notes binds after shell ports exist and keeps sticky-note writes in the notes domain',t=>{
  const oldDocument=globalThis.document;
  const oldAnimationFrame=globalThis.requestAnimationFrame;
  t.after(()=>{globalThis.document=oldDocument;globalThis.requestAnimationFrame=oldAnimationFrame});
  const content={innerHTML:''};
  globalThis.document={getElementById:id=>id==='content'?content:null,querySelector:()=>null,querySelectorAll:()=>[]};
  globalThis.requestAnimationFrame=callback=>callback();

  const model={state:{notes:[]},legacyNotesSheet:null};
  const ui={notesTab:'notes',currentPage:'notes',notesSearchValue:''};
  const notes=createKupaNotesRuntime({model,ui,session:{connectionMode:'local'},tab:{primaryTab:true}});
  assert.throws(()=>notes.renderNotes(),/notes_runtime_not_bound/);
  assert.throws(()=>notes.captureLegacyWorkbook({}),/notes_runtime_not_bound/);
  assert.throws(()=>notes.actions,/notes_runtime_not_bound/);
  assert.throws(()=>notes.bind({}),/notes_cloud_supaRest_required/);

  const saves=[];
  const ports={
    cloudAuth:{supaRest:()=>{},loadSupaSession:()=>null},
    uiModal:{confirmDialog:async()=>true,modal:()=>{},closeModal:()=>{}},
    storagePersistence:{saveState:(message,options)=>saves.push({message,options})},
  };
  notes.bind(ports);
  assert.equal(notes.assertReady(),true);
  assert.throws(()=>notes.bind(ports),/notes_runtime_already_bound/);
  assert.equal(typeof notes.sheetActions['notes-workspace-sheet'],'function');
  assert.equal(typeof notes.workspaceActions['spreadsheet-export'],'function');
  assert.equal(notes.revisionSuffix('cash'),'');
  notes.actions['add-kupa-sticky-note']();
  assert.equal(model.state.notes.length,1);
  assert.equal(saves.length,1);
  assert.deepEqual(saves[0].options.domains,['notes']);
  assert.equal(saves[0].options.operations[0].collection,'notes');
  assert.match(content.innerHTML,/data-action="delete-kupa-sticky-note"/);
});

test('Kupa root binds Notes after modal construction and before startup',()=>{
  const main=fs.readFileSync(new URL('../netunim-kupa/site/assets/js/main.js',import.meta.url),'utf8');
  assert.doesNotMatch(main,/from ['"]\.\/domains\/notes\//);
  assert.doesNotMatch(main,/from ['"]\.\/shared\/spreadsheet-workspace\.js['"]/);
  assert.ok(main.indexOf('const notes=createKupaNotesRuntime(')<main.indexOf('const uiNavigation='));
  assert.ok(main.indexOf('notes.bind(')>main.indexOf('const uiModal='));
  assert.ok(main.indexOf('notes.assertReady()')<main.indexOf('const lifecycle='));
  assert.match(main,/captureLegacyWorkbook=\(\.\.\.args\)=>notes\.captureLegacyWorkbook/);
  assert.match(main,/name:'notes',actions:notes\.actions/);
  assert.match(main,/name:'notes-sheet',actions:notes\.sheetActions/);
  assert.match(main,/name:'spreadsheet-workspace',actions:notes\.workspaceActions/);
});
