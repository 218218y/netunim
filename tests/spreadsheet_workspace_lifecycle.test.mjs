import test from 'node:test';
import assert from 'node:assert/strict';
import {createSpreadsheetWorkspace} from '../shared/spreadsheet-workspace.js';

test('workspace disposal owns every listener and rebinds exactly once, preserving drafts',async()=>{
  const original=Object.getOwnPropertyDescriptors(globalThis);
  const window=new EventTarget(),document=new EventTarget(),intervals=new Map();
  document.querySelectorAll=()=>[];document.hidden=false;
  Object.assign(globalThis,{window,document,setInterval:fn=>{const id=intervals.size+1;intervals.set(id,fn);return id},clearInterval:id=>intervals.delete(id)});
  try{
    const workspace=createSpreadsheetWorkspace({domain:'orders',enabled:()=>false,primary:()=>true,active:()=>true,esc:String});
    const counts={pagehide:0,beforeUnload:0,poll:0,flush:0};
    Object.defineProperty(workspace.sync,'ready',{get:()=>true});
    for(const name of Object.keys(counts))workspace.sync[name]=()=>{counts[name]++;return Promise.resolve(true)};
    const events=()=>{
      window.dispatchEvent(new Event('pagehide'));window.dispatchEvent(new Event('beforeunload'));
      document.dispatchEvent(new Event('visibilitychange'));
      const click=new Event('click');Object.defineProperty(click,'target',{value:{closest:()=>true}});
      document.dispatchEvent(click);window.dispatchEvent(new Event('online'));
      for(const tick of intervals.values())tick();
    };
    workspace.toolbarMarkup();workspace.toolbarMarkup();
    assert.equal(intervals.size,1);events();
    assert.deepEqual(counts,{pagehide:1,beforeUnload:1,poll:2,flush:2});
    workspace.dispose();workspace.dispose();
    assert.equal(counts.pagehide,2);assert.equal(intervals.size,0);
    events();assert.deepEqual(counts,{pagehide:2,beforeUnload:1,poll:2,flush:2});
    workspace.toolbarMarkup();events();
    assert.deepEqual(counts,{pagehide:3,beforeUnload:2,poll:4,flush:4});
    workspace.dispose();
  }finally{
    for(const key of ['window','document','setInterval','clearInterval']){
      if(original[key])Object.defineProperty(globalThis,key,original[key]);else delete globalThis[key];
    }
  }
});
