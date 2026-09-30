import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildPdfFindRequest,copyablePdfTextFieldModel,createPdfSearchViewer,findPdfFormFieldMatches,joinPdfTextSelectionSegments,PDF_SEARCH_RUNTIME} from '../netunim-orders/site/assets/js/domains/documents/pdf-search-viewer.js';

class FakeEventBus{
  constructor(){this.listeners=new Map();this.dispatched=[]}
  on(name,handler){const list=this.listeners.get(name)||[];list.push(handler);this.listeners.set(name,list)}
  dispatch(name,payload){this.dispatched.push({name,payload});for(const handler of this.listeners.get(name)||[])handler(payload)}
}

function fakeRuntime(){
  const state={eventBus:null,viewer:null,linkService:null,findController:null,setDocumentCalls:0,scaleValues:[],updateCalls:0,documentOptions:null};
  class EventBus extends FakeEventBus{constructor(){super();state.eventBus=this}}
  class PDFLinkService{constructor(){state.linkService=this}setViewer(viewer){this.viewer=viewer}setDocument(document){this.document=document}}
  class PDFFindController{constructor(options){this.options=options;this.pageMatches=[];this.pageMatchesLength=[];this.selected={pageIdx:-1,matchIdx:-1};this._scrollMatches=false;state.findController=this}}
  class PDFViewer{constructor(options){this.options=options;state.viewer=this}setDocument(document){this.document=document;state.setDocumentCalls+=1}getPageView(){return null}set currentScaleValue(value){this.scale=value;state.scaleValues.push(value)}update(){state.updateCalls+=1}}
  const pdfDocument={numPages:1,getPage:async()=>({getAnnotations:async()=>[]}),destroy:async()=>{state.documentDestroyed=true}};
  const loadingTask={promise:Promise.resolve(pdfDocument),destroy:async()=>{state.loadingDestroyed=true}};
  return {state,runtime:{pdfjsLib:{AnnotationMode:{ENABLE:1,ENABLE_FORMS:2},AnnotationEditorType:{DISABLE:-1},getDocument:options=>{state.documentOptions=options;return loadingTask}},pdfjsViewer:{EventBus,PDFLinkService,PDFFindController,PDFViewer}}};
}

function fakeHost(fields=[]){
  const container={clientWidth:640,getBoundingClientRect(){return {width:this.clientWidth}},querySelectorAll(){return fields.filter(field=>field.disabled)}};
  return {container,innerHTML:'',querySelector(selector){assert.equal(selector,'.document-pdfjs-container');return container}};
}

const tick=()=>new Promise(resolve=>setTimeout(resolve,8));



class TinyElement{
  constructor(className=''){this.className=className;this.children=[];this.parentElement=null;this.style={};this.dataset={};this.attributes=new Map();this.clientWidth=640;this.clientHeight=800;this.scrollTop=0;this.scrollLeft=0;this.value=''}
  append(child){child.parentElement=this;this.children.push(child);return child}
  replaceChildren(...children){for(const child of this.children)child.parentElement=null;this.children=[];for(const child of children)this.append(child)}
  remove(){if(!this.parentElement)return;this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.parentElement=null}
  setAttribute(name,value){this.attributes.set(name,String(value))}
  getBoundingClientRect(){return {left:0,top:0,right:this.clientWidth,bottom:this.clientHeight,width:this.clientWidth,height:this.clientHeight}}
  scrollTo({top=0,left=0}={}){this.scrollTop=top;this.scrollLeft=left}
  matchesClass(name){return String(this.className||'').split(/\s+/).includes(name)}
  querySelector(selector){if(selector===':scope > .document-pdf-form-overlay')return this.children.find(child=>child.matchesClass('document-pdf-form-overlay'))||null;return this.querySelectorAll(selector)[0]||null}
  querySelectorAll(selector){const wanted=selector.split(',').map(part=>part.trim().replace(/^\./,'')).filter(Boolean),rows=[];const visit=node=>{for(const child of node.children){if(wanted.some(name=>child.matchesClass(name)))rows.push(child);visit(child)}};visit(this);return rows}
  closest(selector){if(selector!=='.page')return null;for(let node=this;node;node=node.parentElement)if(node.matchesClass('page'))return node;return null}
  classList={toggle:(name,on)=>{const set=new Set(String(this.className||'').split(/\s+/).filter(Boolean));on?set.add(name):set.delete(name);this.className=[...set].join(' ')},contains:name=>this.matchesClass(name),add:name=>{if(!this.matchesClass(name))this.className=`${this.className} ${name}`.trim()}};
}

function fakeInteractiveRuntime(annotations){
  const state={eventBus:null,findController:null};
  const pageRoot=new TinyElement('page');pageRoot.dataset.pageNumber='1';pageRoot.clientWidth=600;pageRoot.clientHeight=800;
  const viewport={width:600,height:800,convertToViewportRectangle:rect=>[rect[0],800-rect[1],rect[2],800-rect[3]]};
  const pdfPage={getAnnotations:async()=>annotations};
  const pageView={id:1,div:pageRoot,pdfPage,viewport};
  class EventBus extends FakeEventBus{constructor(){super();state.eventBus=this}}
  class PDFLinkService{constructor(){this.page=1}setViewer(viewer){this.viewer=viewer}setDocument(document){this.document=document}}
  class PDFFindController{constructor(){this.pageMatches=[];this.selected={pageIdx:-1,matchIdx:-1};state.findController=this}}
  class PDFViewer{constructor({container}){container.append(pageRoot);this.container=container}setDocument(document){this.document=document}getPageView(index){return index===0?pageView:null}set currentScaleValue(value){this.scale=value}update(){}}
  const pdfDocument={numPages:1,getPage:async()=>pdfPage,destroy:async()=>{}};
  const loadingTask={promise:Promise.resolve(pdfDocument),destroy:async()=>{}};
  return {state,pageRoot,runtime:{pdfjsLib:{AnnotationMode:{ENABLE:1},AnnotationEditorType:{DISABLE:-1},getDocument:()=>loadingTask,normalizeUnicode:value=>value},pdfjsViewer:{EventBus,PDFLinkService,PDFFindController,PDFViewer}}};
}

test('PDF find requests keep all matches highlighted and distinguish next from previous',()=>{
  assert.deepEqual(buildPdfFindRequest('needle'),{source:null,type:'',query:'needle',phraseSearch:true,caseSensitive:false,entireWord:false,highlightAll:true,findPrevious:false,matchDiacritics:false});
  assert.equal(buildPdfFindRequest('needle',{type:'again',findPrevious:true}).findPrevious,true);
  assert.equal(buildPdfFindRequest('needle',{type:'again'}).type,'again');
  assert.deepEqual(buildPdfFindRequest(['מה','שלומך']).query,['מה','שלומך']);
});

test('local PDF form copy layer maps text widgets without changing their authored appearance',()=>{
  const viewport={width:600,height:800,convertToViewportRectangle:rect=>[rect[0],800-rect[1],rect[2],800-rect[3]]};
  const model=copyablePdfTextFieldModel({fieldType:'Tx',fieldValue:'ליבי מאיר',fieldName:'שם',rect:[300,700,500,730],multiLine:false,defaultAppearanceData:{fontSize:14}},viewport);
  assert.equal(model.value,'ליבי מאיר');
  assert.equal(model.fieldName,'שם');
  assert.equal(model.multiLine,false);
  assert.equal(model.fontSize,14);
  assert.deepEqual([model.left,model.top,model.width,model.height].map(value=>Math.round(value*100)/100),[50,8.75,33.33,3.75]);
  assert.equal(copyablePdfTextFieldModel({fieldType:'Btn',fieldValue:'x',rect:[0,0,10,10]},viewport),null,'non-text widgets are never exposed as text controls');
  assert.equal(copyablePdfTextFieldModel({fieldType:'Tx',fieldValue:'secret',password:true,rect:[0,0,10,10]},viewport),null,'password fields are never exposed');
});



test('interactive PDF form values participate in highlight navigation without changing the PDF appearance',()=>{
  const annotations=[
    {id:'name',fieldType:'Tx',fieldName:'שם',fieldValue:'ליבי מאיר ליבי',rect:[10,10,100,30]},
    {id:'details',fieldType:'Tx',fieldName:'פרוט',fieldValue:'מיטה אלגנס ומזרונים',rect:[10,40,200,100],multiLine:true},
    {id:'choice',fieldType:'Ch',fieldName:'בחירה',fieldValue:['זהב','לבן'],rect:[10,110,100,130]},
    {id:'secret',fieldType:'Tx',fieldValue:'ליבי',password:true,rect:[10,140,100,160]},
  ];
  const phrase=findPdfFormFieldMatches(annotations,1,'ליבי',{matchMode:'phrase'});
  assert.equal(phrase.matches.length,2,'every occurrence inside an AcroForm text value becomes a navigable match');
  assert.deepEqual(phrase.matches.map(row=>[row.fieldKey,row.start,row.end]),[['id:name',0,4],['id:name',10,14]]);
  assert.equal(phrase.matches[0].snippet.match,'ליבי');
  const all=findPdfFormFieldMatches(annotations,1,'מיטה מזרונים',{matchMode:'all'});
  assert.deepEqual(all.matches.map(row=>row.snippet.match),['מיטה','מזרונים'],'all-words search highlights each contributing term after the document qualifies');
  const choice=findPdfFormFieldMatches(annotations,1,'זהב',{matchMode:'phrase'});
  assert.equal(choice.matches.length,1,'choice field values are searchable too');
  assert.equal(findPdfFormFieldMatches(annotations,1,'secret',{matchMode:'phrase'}).matches.length,0,'password fields never enter search/highlight results');
});

test('AcroForm matches become visible and navigable without waiting for native PDF text search',async()=>{
  const originalDocument=globalThis.document;
  const listeners=new Map();
  globalThis.document={
    createElement:()=>new TinyElement(),
    addEventListener:(name,handler)=>listeners.set(name,handler),
    removeEventListener:name=>listeners.delete(name),
    getSelection:()=>null,
  };
  try{
    const annotations=[{id:'name',fieldType:'Tx',fieldName:'שם',fieldValue:'ליבי מאיר ליבי',rect:[100,600,300,640]}];
    const {state,pageRoot,runtime}=fakeInteractiveRuntime(annotations),host=fakeHost();
    host.container.append=TinyElement.prototype.append.bind(host.container);
    host.container.children=[];host.container.className='document-pdfjs-container';host.container.querySelectorAll=TinyElement.prototype.querySelectorAll.bind(host.container);host.container.getBoundingClientRect=()=>({left:0,top:0,width:640,height:800,right:640,bottom:800});host.container.clientHeight=800;host.container.scrollTop=0;host.container.scrollLeft=0;host.container.scrollTo=()=>{};
    const viewer=await createPdfSearchViewer({host,data:new Uint8Array([37,80,68,70]),query:'ליבי',runtime});
    await tick();await tick();
    assert.deepEqual(state.findController.pageMatches,[],'native text search is intentionally still unresolved in this regression fixture');
    assert.equal(viewer.matchState().total,2,'form matches are available immediately instead of waiting for PDFFindController page matches');
    assert.equal(pageRoot.querySelectorAll('.document-pdf-form-match-marker').length,1,'a stable page-owned overlay marks the matching AcroForm field');
    assert.equal(pageRoot.querySelectorAll('.document-pdf-copy-field').length,1,'the copy layer shares the stable page-owned overlay');
    const before=viewer.matchState().current;viewer.next();assert.notEqual(viewer.matchState().current,before,'next navigation advances between AcroForm occurrences');
    await viewer.destroy();
  }finally{globalThis.document=originalDocument}
});

test('PDF text copy reconstructs visual word gaps without inserting spaces between glyph fragments',()=>{
  const rect=(left,right,top=10,bottom=22)=>({left,right,top,bottom});
  assert.equal(joinPdfTextSelectionSegments([
    {text:'שלום',rect:rect(100,140),pageKey:'1'},
    {text:'עולם',rect:rect(70,94),pageKey:'1'},
  ]),'שלום עולם','a geometric gap on one RTL line becomes a clipboard space');
  assert.equal(joinPdfTextSelectionSegments([
    {text:'ש',rect:rect(130,140),pageKey:'1'},
    {text:'ל',rect:rect(120,130),pageKey:'1'},
    {text:'ו',rect:rect(110,120),pageKey:'1'},
    {text:'ם',rect:rect(100,110),pageKey:'1'},
  ]),'שלום','touching glyph fragments remain one word');
  assert.equal(joinPdfTextSelectionSegments([
    {text:'שורה',rect:rect(100,140,10,22),pageKey:'1'},
    {text:'שנייה',rect:rect(100,145,35,47),pageKey:'1'},
    {text:'עמוד',rect:rect(100,140,10,22),pageKey:'2'},
  ]),'שורה\nשנייה\nעמוד','line and page boundaries remain explicit in copied text');
  assert.equal(joinPdfTextSelectionSegments([
    {text:'hello ',rect:rect(10,50),pageKey:'1'},
    {text:'world',rect:rect(60,100),pageKey:'1'},
  ]),'hello world','existing PDF whitespace is not duplicated');
});

test('controlled PDF preview works without a search query and stays in static-appearance mode',async()=>{
  const {state,runtime}=fakeRuntime(),host=fakeHost();
  const controller=await createPdfSearchViewer({host,data:new Uint8Array([37,80,68,70]),query:'',runtime});
  assert.equal(state.findController,null,'plain preview does not create unnecessary find machinery');
  assert.equal(state.viewer.options.annotationMode,1,'local preview paints authored AcroForm appearance streams instead of regenerating field glyphs');
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
  assert.equal(state.viewer.options.annotationMode,1,'local/default preview preserves the PDF-authored static form appearance');
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
  assert.deepEqual(updates.at(-1),{current:3,total:8,snippet:null,capped:false,location:''});
  assert.deepEqual(controller.matchState(),{current:3,total:8,snippet:null,capped:false,location:''});
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
