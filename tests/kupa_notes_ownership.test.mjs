import test from 'node:test';
import assert from 'node:assert/strict';
import {createDomainsNotesController} from '../netunim-kupa/site/assets/js/domains/notes/controller.js';

function fixture(){
  const model={state:{notes:[{id:'N',content:'before'}]}},saves=[];
  let owner='local',writable=true,confirm;
  let release;
  const committed=new Promise(resolve=>{release=resolve});
  const controller=createDomainsNotesController({model,ui:{notesTab:'notes'},
    editScope:()=>owner,canWrite:()=>writable,
    saveState:(message,options)=>{saves.push({owner,operations:structuredClone(options.operations)});return committed},
    confirmDialog:()=>new Promise(resolve=>{confirm=resolve}),
  });
  const element=value=>({value,style:{},scrollHeight:150,closest:()=>null});
  return {controller,model,saves,element,release,
    replaceOwner(){owner='account';model.state={notes:[{id:'N',content:'account note'}]}},
    lock(){writable=false},approve(){confirm(true)},
  };
}

test('sticky edit is submitted before a transfer can fence writes and drain waits for its commit',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const f=fixture();
  f.controller.updateStickyNote('N',f.element('exact edit before 220ms'));
  assert.equal(f.saves.length,1,'durability submission must happen in the input turn');
  assert.equal(f.saves[0].owner,'local');
  assert.equal(f.saves[0].operations[0].record.content,'exact edit before 220ms');
  f.lock();f.controller.runtime.cancelPending();
  let drained=false;
  const drain=f.controller.runtime.drain().then(()=>{drained=true});
  await Promise.resolve();assert.equal(drained,false);
  f.release(true);await drain;
  f.replaceOwner();t.mock.timers.tick(1000);
  assert.equal(f.saves.length,1,'no delayed write may target the replacement owner');
  assert.equal(f.model.state.notes[0].content,'account note');
});

test('sticky deletion confirmation cannot cross owner replacement or quiescence',async t=>{
  for(const transition of ['replaceOwner','cancelPending','dispose']){
    const f=fixture();
    const deletion=f.controller.deleteStickyNote('N');
    if(transition==='replaceOwner')f.replaceOwner();else f.controller.runtime[transition]();
    f.approve();assert.equal(await deletion,false);
    assert.equal(f.model.state.notes.length,1);assert.equal(f.saves.length,0);
    f.release(true);await f.controller.runtime.drain();
  }
});

test('fenced or disposed Notes commands do not mutate the model',async t=>{
  const f=fixture();f.lock();
  f.controller.updateStickyNote('N',f.element('rejected'));
  assert.equal(f.model.state.notes[0].content,'before');assert.equal(f.saves.length,0);
  assert.equal(f.controller.runtime.dispose(),true);assert.equal(f.controller.runtime.dispose(),false);
  assert.equal(await f.controller.deleteStickyNote('N'),false);
  assert.equal(f.controller.runtime.isPending(),false);
});

test('accepted deletion renders immediately while its owned durability operation is held',async t=>{
  const oldDocument=globalThis.document,oldAnimationFrame=globalThis.requestAnimationFrame;
  t.after(()=>{globalThis.document=oldDocument;globalThis.requestAnimationFrame=oldAnimationFrame});
  const content={innerHTML:''};
  globalThis.document={getElementById:()=>content,querySelectorAll:()=>[]};
  globalThis.requestAnimationFrame=()=>{};
  const f=fixture(),deleting=f.controller.deleteStickyNote('N');
  f.approve();await Promise.resolve();
  assert.equal(f.model.state.notes.length,0);assert.match(content.innerHTML,/אין עדיין פתקים/);
  assert.equal(f.controller.runtime.isPending(),true);
  f.release(true);await deleting;await f.controller.runtime.drain();
});
