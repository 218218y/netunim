import test from 'node:test';
import assert from 'node:assert/strict';
import {createUiLayout} from '../netunim-orders/site/assets/js/ui/layout.js';

function withScrollHarness(run){
  const previous={document:globalThis.document,window:globalThis.window,requestAnimationFrame:globalThis.requestAnimationFrame,getComputedStyle:globalThis.getComputedStyle};
  const frames=[];
  globalThis.requestAnimationFrame=callback=>{frames.push(callback);return frames.length};
  globalThis.getComputedStyle=()=>({marginTop:'0',marginBottom:'0'});
  globalThis.window={scrollY:0,scrollX:0,scrollTo:()=>{}};
  const main={dataset:{supplierId:'SUP-1'},querySelector:()=>null};
  globalThis.document={querySelector:selector=>selector==='#main'?main:null};
  const flush=()=>{while(frames.length)frames.shift()()};
  try{return run({main,frames,flush})}finally{
    for(const [key,value] of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value}
  }
}

function viewport({top=0,height=2000,client=500,summary=0}={}){
  const summaryEl=summary?{offsetHeight:summary}:null;
  return{scrollHeight:height,clientHeight:client,scrollTop:top,scrollLeft:0,isConnected:true,addEventListener:()=>{},querySelector:selector=>selector===':scope > .supplier-bottom-summary'?summaryEl:null};
}

test('supplier end intent survives an immediate rerender before the first animation frame',()=>withScrollHarness(({main,flush})=>{
  const supplierUi={supplierViewportMemory:new Map()},ui={scrollViewportMemory:new Map()},layout=createUiLayout({ui,supplierUi});
  const first=viewport({summary:200}),second=viewport({summary:200});
  let current=first;main.querySelector=selector=>selector.includes('.table-wrap')?current:null;

  layout.restoreSupplierViewport(null,'SUP-1','end');
  const captured=layout.captureSupplierViewport();
  assert.equal(captured.pendingScrollMode,'end','the uncommitted end position remains a navigation intent, not a false scrollTop=0 snapshot');

  first.isConnected=false;current=second;
  layout.restoreSupplierViewport(captured,'SUP-1','auto');
  flush();

  assert.equal(first.scrollTop,0,'a stale callback never mutates the detached first render');
  assert.equal(second.scrollTop,layout.supplierTransactionsEndTop(second),'the replacement render commits the original end-of-transactions intent');
}));

test('generic reset-to-start intent survives a rerender and stale frames cannot overwrite it',()=>withScrollHarness(({flush})=>{
  const ui={scrollViewportMemory:new Map([['kupa:credit',{top:600,left:0,atEnd:true}]])},supplierUi={supplierViewportMemory:new Map()},layout=createUiLayout({ui,supplierUi});
  const first=viewport({top:600,height:1000,client:400}),second=viewport({top:600,height:1400,client:400});

  layout.restoreScrollViewport('kupa:credit',first,{resetTop:true});
  first.isConnected=false;
  layout.restoreScrollViewport('kupa:credit',second);
  flush();

  assert.equal(first.scrollTop,600,'the detached viewport is ignored');
  assert.equal(second.scrollTop,0,'the explicit navigation target is propagated into the replacement render');
  assert.equal(ui.scrollViewportMemory.get('kupa:credit').top,0,'only the committed replacement viewport becomes scroll memory');
}));
