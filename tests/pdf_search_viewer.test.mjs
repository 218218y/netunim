import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildPdfFindRequest,createPdfSearchViewer,makePdfReadOnlyTextFieldsCopyable,PDF_SEARCH_RUNTIME} from '../netunim-orders/site/assets/js/domains/documents/pdf-search-viewer.js';

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
  return {state,runtime:{pdfjsLib:{AnnotationMode:{ENABLE:1,ENABLE_FORMS:2},AnnotationEditorType:{DISABLE:-1},getDocument:options=>{state.documentOptions=options;return loadingTask}},pdfjsViewer:{EventBus,PDFLinkService,PDFFindController,PDFViewer}}};
}

function fakeHost(fields=[]){
  const container={clientWidth:640,getBoundingClientRect(){return {width:this.clientWidth}},querySelectorAll(){return fields.filter(field=>field.disabled)}};
  return {container,innerHTML:'',querySelector(selector){assert.equal(selector,'.document-pdfjs-container');return container}};
}

const tick=()=>new Promise(resolve=>setTimeout(resolve,8));


test('PDF find requests keep all matches highlighted and distinguish next from previous',()=>{
  assert.deepEqual(buildPdfFindRequest('needle'),{source:null,type:'',query:'needle',phraseSearch:true,caseSensitive:false,entireWord:false,highlightAll:true,findPrevious:false,matchDiacritics:false});
  assert.equal(buildPdfFindRequest('needle',{type:'again',findPrevious:true}).findPrevious,true);
  assert.equal(buildPdfFindRequest('needle',{type:'again'}).type,'again');
  assert.deepEqual(buildPdfFindRequest(['מה','שלומך']).query,['מה','שלומך']);
});

test('read-only PDF text widgets use readonly semantics so selected text remains copyable',()=>{
  const attributes=new Map();
  const field={disabled:true,readOnly:false,dataset:{},setAttribute(name,value){attributes.set(name,String(value))}};
  const root={querySelectorAll(selector){assert.equal(selector,'.textWidgetAnnotation input[type="text"]:disabled, .textWidgetAnnotation textarea:disabled');return [field]}};
  assert.equal(makePdfReadOnlyTextFieldsCopyable(root),1);
  assert.equal(field.disabled,false);
  assert.equal(field.readOnly,true);
  assert.equal(field.dataset.pdfCopyableReadonly,'true');
  assert.equal(attributes.get('aria-readonly'),'true');
});

test('controlled PDF preview works without a search query and unlocks copying from read-only text fields',async()=>{
  const field={disabled:true,readOnly:false,dataset:{},setAttribute(){}};
  const {state,runtime}=fakeRuntime(),host=fakeHost([field]);
  const controller=await createPdfSearchViewer({host,data:new Uint8Array([37,80,68,70]),query:'',runtime});
  assert.equal(state.findController,null,'plain preview does not create unnecessary find machinery');
  state.eventBus.dispatch('annotationlayerrendered',{});
  assert.equal(field.disabled,false,'read-only text field is no longer disabled');
  assert.equal(field.readOnly,true,'field stays non-editable while allowing selection/copy');
  state.eventBus.dispatch('pagesinit',{});
  assert.equal(state.eventBus.dispatched.filter(event=>event.name==='find').length,0,'plain preview never dispatches a find request');
  controller.next();controller.previous();
  assert.equal(state.eventBus.dispatched.filter(event=>event.name==='find').length,0,'match navigation is inert without a search query');
  await controller.destroy();
});

test('controlled PDF viewer uses PDFFindController, local support assets and real arrow navigation',async()=>{
  const {state,runtime}=fakeRuntime(),host=fakeHost(),updates=[];
  const input=new Blob([new Uint8Array([37,80,68,70])],{type:'application/pdf'});
  const controller=await createPdfSearchViewer({host,blob:input,query:'needle',runtime,onMatchState:value=>updates.push(value)});
  assert.ok(state.findController,'find controller is created');
  assert.equal(state.viewer.options.annotationMode,2,'local/default preview preserves interactive form widgets');
  assert.equal(state.setDocumentCalls,1,'PDF document is attached to the viewer');
  assert.ok(state.documentOptions.data instanceof Uint8Array,'PDF bytes are passed directly to PDF.js');
  assert.deepEqual([...state.documentOptions.data],[37,80,68,70]);
  assert.equal('url' in state.documentOptions,false,'controlled PDF preview does not fetch its blob URL through connect-src');
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

test('preview PDF renders AcroForm fields from PDF appearances instead of editable HTML controls',async()=>{
  const state={options:null};
  const runtime={
    pdfjsLib:{
      AnnotationMode:{ENABLE:1,ENABLE_FORMS:2},AnnotationEditorType:{DISABLE:-1},
      getDocument:()=>({promise:Promise.resolve({destroy:async()=>{}}),destroy:async()=>{}}),
    },
    pdfjsViewer:{
      EventBus:class{handlers=new Map();on(name,fn){this.handlers.set(name,fn)}dispatch(){}},
      PDFLinkService:class{setViewer(){}setDocument(){}},
      PDFViewer:class{constructor(options){state.options=options;this.currentScaleValue='';}setDocument(){}update(){}},
    },
  };
  const viewer=await createPdfSearchViewer({host:fakeHost(),data:new Uint8Array([37,80,68,70]),runtime,interactiveForms:false});
  assert.equal(state.options.annotationMode,1,'preview must use AnnotationMode.ENABLE so form appearance streams stay in the PDF canvas');
  assert.equal(state.options.annotationEditorMode,-1);
  await viewer.destroy();
});

test('PDF.js runtime is pinned to one local same-origin vendor tree',()=>{
  assert.equal(PDF_SEARCH_RUNTIME.version,'6.3.289');
  for(const key of ['pdf','viewer','worker','css','cmaps','iccs','standardFonts','wasm']){
    assert.match(PDF_SEARCH_RUNTIME[key],/^\.\.\/\.\.\/\.\.\/vendor\/pdfjs\//);
    assert.doesNotMatch(PDF_SEARCH_RUNTIME[key],/^https?:/);
  }
  assert.match(PDF_SEARCH_RUNTIME.worker,/pdf\.worker\.min\.mjs$/);
});


test('global search routes ordinary local PDFs through the controlled PDF.js viewer',()=>{
  const source=fs.readFileSync(new URL('../shared/global-document-search.js',import.meta.url),'utf8');
  assert.match(source,/if\(data\.mime==='application\/pdf'\)\{[^\r\n]*createPdfSearchViewer/);
  assert.doesNotMatch(source,/data\.mime==='application\/pdf'&&selectedDocumentMode==='content'/);
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


test('controlled PDF preview uses term arrays for AND/OR and an exact ordered-proximity matcher',async()=>{
  const all=fakeRuntime(),allHost=fakeHost();
  const allViewer=await createPdfSearchViewer({host:allHost,data:new Uint8Array([37,80,68,70]),query:'מה שלומך',contentSearch:{matchMode:'all'},runtime:all.runtime});
  all.state.eventBus.dispatch('pagesinit',{});
  const allFind=all.state.eventBus.dispatched.find(event=>event.name==='find');
  assert.deepEqual(allFind.payload.query,['מה','שלומך']);
  await allViewer.destroy();

  const proximity=fakeRuntime(),proximityHost=fakeHost();
  const proximityViewer=await createPdfSearchViewer({host:proximityHost,data:new Uint8Array([37,80,68,70]),query:'מה שלומך',contentSearch:{matchMode:'proximity',proximityWords:2},runtime:proximity.runtime});
  assert.equal(typeof proximity.state.findController.match,'function');
  assert.deepEqual(proximity.state.findController.match(null,'פתיחה מה אחד שני שלומך סוף',0),[{index:6,length:16}]);
  assert.deepEqual(proximity.state.findController.match(null,'פתיחה מה אחד שני שלישי שלומך סוף',0),[]);
  await proximityViewer.destroy();
});
