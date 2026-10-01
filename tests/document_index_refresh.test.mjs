import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocumentIndexRefresh} from '../shared/document-search/ui/document-index-refresh.js';

function fixture(bridge){
  let click;
  const classes=new Set(),label={textContent:''};
  const button={hidden:true,disabled:false,title:'',classList:{toggle(name,on){if(on)classes.add(name);else classes.delete(name)}},setAttribute(name,value){this[name]=value},querySelector(){return label},addEventListener(name,handler){if(name==='click')click=handler}};
  const status={hidden:true,textContent:''};
  let completed=0;
  const control=createDocumentIndexRefresh({bridge,button,status,onCompleted:()=>{completed+=1}});
  control.bind();
  const flush=()=>new Promise(resolve=>setImmediate(resolve));
  return {button,status,label,classes,control,click:async()=>{click();await flush()},flush,get completed(){return completed}};
}

test('manual refresh starts once, offers cancellation and reflects a completed run',async()=>{
  let starts=0,stops=0,live={running:false};
  const bridge={supportsPdfIndexRefresh:true,localToken:'paired',pdfIndexStatus:async()=>live,startPdfIndex:async()=>{starts+=1;live={running:true,source:'manual',cancelable:true,progress:{selected:3,processed:0}};return live},stopPdfIndex:async()=>{stops+=1;live={...live,cancelable:false,stopRequested:true};return live}};
  const ui=fixture(bridge);ui.control.show();await ui.flush();
  await ui.click();assert.equal(starts,1);assert.equal(ui.label.textContent,'עצור PDF');
  assert.match(ui.status.textContent,/0 מתוך 3/);
  await ui.click();assert.equal(stops,1);assert.equal(ui.button.disabled,true);
  live={running:false,lastRun:{aborted:true,processed:1}};
  await ui.control.load();assert.match(ui.status.textContent,/נעצר/);assert.equal(ui.completed,0);
  ui.control.hide();
});

test('scheduled maintenance cannot be stopped from the manual button',async()=>{
  let starts=0;
  const bridge={supportsPdfIndexRefresh:true,localToken:'paired',pdfIndexStatus:async()=>({running:true,source:'scheduled',cancelable:false}),startPdfIndex:async()=>{starts+=1}};
  const ui=fixture(bridge);ui.control.show();await ui.flush();
  assert.equal(ui.button.disabled,true);assert.match(ui.status.textContent,/מתוזמן/);
  await ui.click();assert.equal(starts,0);ui.control.hide();
});

test('a completed manual refresh re-runs the current search once',async()=>{
  let live={running:false};
  const bridge={supportsPdfIndexRefresh:true,localToken:'paired',pdfIndexStatus:async()=>live,startPdfIndex:async()=>{live={running:true,source:'manual',cancelable:true};return live}};
  const ui=fixture(bridge);ui.control.show();await ui.flush();await ui.click();
  live={running:false,lastRun:{processed:2,pending:0,aborted:false}};
  await ui.control.load();assert.equal(ui.completed,1);
  await ui.control.load();assert.equal(ui.completed,1);
  assert.match(ui.status.textContent,/נבדקו 2/);ui.control.hide();
});

test('the refresh action stays unavailable without a local Bridge token',()=>{
  const ui=fixture({supportsPdfIndexRefresh:true,localToken:''});
  assert.equal(ui.button.disabled,true);
  const unavailable=fixture({supportsPdfIndexRefresh:false,localToken:''});
  assert.equal(unavailable.button.hidden,true);
});
