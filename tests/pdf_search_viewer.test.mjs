import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildPdfFindRequest,createPdfSearchViewer,PDF_SEARCH_RUNTIME} from '../netunim-orders/site/assets/js/domains/documents/pdf-search-viewer.js';

class FakeEventBus{
  constructor(){this.listeners=new Map();this.dispatched=[]}
  on(name,handler){const list=this.listeners.get(name)||[];list.push(handler);this.listeners.set(name,list)}
  dispatch(name,payload){this.dispatched.push({name,payload});for(const handler of this.listeners.get(name)||[])handler(payload)}
}

function fakeRuntime(){
  const state={eventBus:null,viewer:null,linkService:null,findController:null,setDocumentCalls:0,scaleValues:[],updateCalls:0,documentOptions:null};
  class EventBus extends FakeEventBus{constructor(){super();state.eventBus=this}}
  class PDFLinkService{constructor(){state.linkService=this}setViewer(viewer){this.viewer=viewer}setDocument(document){this.document=document}}
  class PDFFindController{constructor(options){this.options=options;state.findController=this}}
  class PDFViewer{constructor(options){this.options=options;state.viewer=this}setDocument(document){this.document=document;state.setDocumentCalls+=1}set currentScaleValue(value){this.scale=value;state.scaleValues.push(value)}update(){state.updateCalls+=1}}
  const pdfDocument={destroy:async()=>{state.documentDestroyed=true}};
  const loadingTask={promise:Promise.resolve(pdfDocument),destroy:async()=>{state.loadingDestroyed=true}};
  return {state,runtime:{pdfjsLib:{AnnotationEditorType:{DISABLE:-1},getDocument:options=>{state.documentOptions=options;return loadingTask}},pdfjsViewer:{EventBus,PDFLinkService,PDFFindController,PDFViewer}}};
}

function fakeHost(){
  const container={clientWidth:640,getBoundingClientRect(){return {width:this.clientWidth}}};
  return {container,innerHTML:'',querySelector(selector){assert.equal(selector,'.document-pdfjs-container');return container}};
}

const tick=()=>new Promise(resolve=>setTimeout(resolve,8));


test('PDF find requests keep all matches highlighted and distinguish next from previous',()=>{
  assert.deepEqual(buildPdfFindRequest('needle'),{source:null,type:'',query:'needle',phraseSearch:true,caseSensitive:false,entireWord:false,highlightAll:true,findPrevious:false,matchDiacritics:false});
  assert.equal(buildPdfFindRequest('needle',{type:'again',findPrevious:true}).findPrevious,true);
  assert.equal(buildPdfFindRequest('needle',{type:'again'}).type,'again');
});

test('controlled PDF viewer uses PDFFindController, local support assets and real arrow navigation',async()=>{
  const {state,runtime}=fakeRuntime(),host=fakeHost(),updates=[];
  const controller=await createPdfSearchViewer({host,url:'blob:test',query:'needle',runtime,onMatchState:value=>updates.push(value)});
  assert.ok(state.findController,'find controller is created');
  assert.equal(state.setDocumentCalls,1,'PDF document is attached to the viewer');
  assert.equal(state.documentOptions.url,'blob:test');
  assert.equal(state.documentOptions.cMapPacked,true);
  assert.equal(state.documentOptions.useWorkerFetch,true);
  assert.match(state.documentOptions.cMapUrl,/assets\/vendor\/pdfjs\/cmaps\/$/);
  assert.match(state.documentOptions.iccUrl,/assets\/vendor\/pdfjs\/iccs\/$/);
  assert.match(state.documentOptions.standardFontDataUrl,/assets\/vendor\/pdfjs\/standard_fonts\/$/);
  assert.match(state.documentOptions.wasmUrl,/assets\/vendor\/pdfjs\/wasm\/$/);
  state.eventBus.dispatch('pagesinit',{});
  assert.equal(state.scaleValues.at(-1),'page-width','initial page width fit is applied');
  assert.equal(state.updateCalls,1,'viewer is updated after initial fit');
  host.container.clientWidth=820;
  controller.resize({immediate:true});
  await tick();
  assert.equal(state.scaleValues.length,2,'splitter resize recalculates page width');
  assert.equal(state.updateCalls,2,'splitter resize updates rendered pages');
  let findEvents=state.eventBus.dispatched.filter(event=>event.name==='find');
  assert.equal(findEvents.length,1);
  assert.equal(findEvents[0].payload.query,'needle');
  assert.equal(findEvents[0].payload.highlightAll,true);
  controller.next();controller.previous();
  findEvents=state.eventBus.dispatched.filter(event=>event.name==='find');
  assert.equal(findEvents.at(-2).payload.type,'again');
  assert.equal(findEvents.at(-2).payload.findPrevious,false);
  assert.equal(findEvents.at(-1).payload.findPrevious,true);
  state.eventBus.dispatch('updatefindmatchescount',{matchesCount:{current:3,total:8}});
  assert.deepEqual(updates.at(-1),{current:3,total:8});
  assert.deepEqual(controller.matchState(),{current:3,total:8});
  await controller.destroy();
  assert.equal(state.loadingDestroyed,true);
  assert.equal(state.documentDestroyed,true);
});

test('PDF.js runtime is pinned to one local same-origin vendor tree',()=>{
  assert.equal(PDF_SEARCH_RUNTIME.version,'6.3.289');
  for(const key of ['pdf','viewer','worker','css','cmaps','iccs','standardFonts','wasm']){
    assert.match(PDF_SEARCH_RUNTIME[key],/^\.\.\/\.\.\/\.\.\/vendor\/pdfjs\//);
    assert.doesNotMatch(PDF_SEARCH_RUNTIME[key],/^https?:/);
  }
  assert.match(PDF_SEARCH_RUNTIME.worker,/pdf\.worker\.min\.mjs$/);
});


test('PDF runtime loading keeps the application module graph static, local and dependency-ordered',()=>{
  const source=fs.readFileSync(new URL('../netunim-orders/site/assets/js/domains/documents/pdf-search-viewer.js',import.meta.url),'utf8');
  const vendorViewer=fs.readFileSync(new URL('../netunim-orders/site/assets/vendor/pdfjs/web/pdf_viewer.mjs',import.meta.url),'utf8');
  const coreImport="await import('../../../vendor/pdfjs/build/pdf.mjs')";
  const viewerImport="import('../../../vendor/pdfjs/web/pdf_viewer.mjs')";
  assert.match(source,/import\('\.\.\/\.\.\/\.\.\/vendor\/pdfjs\/build\/pdf\.mjs'\)/);
  assert.match(source,/import\('\.\.\/\.\.\/\.\.\/vendor\/pdfjs\/web\/pdf_viewer\.mjs'\)/);
  assert.ok(source.indexOf(coreImport)>=0&&source.indexOf(viewerImport)>source.indexOf(coreImport),'pdf.mjs must finish before pdf_viewer.mjs starts');
  assert.match(vendorViewer,/globalThis\.pdfjsLib/,'the pinned viewer really depends on the pdfjsLib global during evaluation');
  assert.doesNotMatch(source,/Promise\.all\(\[\s*import\('\.\.\/\.\.\/\.\.\/vendor\/pdfjs\/build\/pdf\.mjs'\)[\s\S]*?import\('\.\.\/\.\.\/\.\.\/vendor\/pdfjs\/web\/pdf_viewer\.mjs'\)/,'core and viewer must never be started in parallel');
  assert.doesNotMatch(source,/cdnjs|jsdelivr|https:\/\//i);
  assert.doesNotMatch(source,/script\.src|loadRuntimeScript/);
  assert.match(source,/link\.rel='stylesheet'/,'PDF.js CSS is loaded as a native local stylesheet');
});
