const PDFJS_VERSION='6.3.289';
const PDFJS_ROOT='../../../vendor/pdfjs/';

export const PDF_SEARCH_RUNTIME=Object.freeze({
  version:PDFJS_VERSION,
  root:PDFJS_ROOT,
  pdf:`${PDFJS_ROOT}build/pdf.mjs`,
  viewer:`${PDFJS_ROOT}web/pdf_viewer.mjs`,
  worker:`${PDFJS_ROOT}build/pdf.worker.min.mjs`,
  css:`${PDFJS_ROOT}web/pdf_viewer.css`,
  cmaps:`${PDFJS_ROOT}cmaps/`,
  iccs:`${PDFJS_ROOT}iccs/`,
  standardFonts:`${PDFJS_ROOT}standard_fonts/`,
  wasm:`${PDFJS_ROOT}wasm/`,
});

let runtimePromise=null;
let stylesheetPromise=null;

function runtimeUrl(relative){return new URL(relative,import.meta.url).href}

function ensureViewerStylesheet(){
  if(stylesheetPromise)return stylesheetPromise;
  const href=runtimeUrl(PDF_SEARCH_RUNTIME.css);
  stylesheetPromise=new Promise((resolve,reject)=>{
    const existing=[...document.querySelectorAll('link[rel="stylesheet"]')].find(link=>link.href===href);
    if(existing?.sheet){resolve();return}
    const link=existing||document.createElement('link');
    const cleanup=()=>{link.removeEventListener('load',loaded);link.removeEventListener('error',failed)};
    const loaded=()=>{cleanup();resolve()};
    const failed=()=>{cleanup();if(!existing)link.remove();reject(new Error('PDF.js stylesheet failed to load.'))};
    link.addEventListener('load',loaded,{once:true});
    link.addEventListener('error',failed,{once:true});
    if(!existing){link.rel='stylesheet';link.href=href;link.dataset.pdfjsRuntime=PDFJS_VERSION;document.head.append(link)}
  }).catch(error=>{stylesheetPromise=null;throw error});
  return stylesheetPromise;
}

export function buildPdfFindRequest(query,{type='',findPrevious=false}={}){
  return {source:null,type,query:String(query||''),phraseSearch:true,caseSensitive:false,entireWord:false,highlightAll:true,findPrevious:!!findPrevious,matchDiacritics:false};
}

async function loadRuntime(){
  if(runtimePromise)return runtimePromise;
  runtimePromise=(async()=>{
    // Keep both imports literal and local: the repository module-graph contract can
    // verify them statically, while the browser still downloads PDF.js lazily only
    // when content-search opens a PDF preview.
    const stylesheetTask=ensureViewerStylesheet();
    // pdf_viewer.mjs reads globalThis.pdfjsLib during module evaluation instead of
    // importing pdf.mjs itself.  Keep CSS parallel, but establish the core runtime
    // first; loading both modules in Promise.all creates a real evaluation race and
    // silently drops the UI back to the native iframe fallback.
    const pdfjsLib=await import('../../../vendor/pdfjs/build/pdf.mjs');
    const viewerTask=import('../../../vendor/pdfjs/web/pdf_viewer.mjs');
    const [pdfjsViewer]=await Promise.all([viewerTask,stylesheetTask]);
    pdfjsLib.GlobalWorkerOptions.workerSrc=runtimeUrl(PDF_SEARCH_RUNTIME.worker);
    return {pdfjsLib,pdfjsViewer};
  })().catch(error=>{runtimePromise=null;throw error});
  return runtimePromise;
}

export function preloadPdfSearchRuntime(){return loadRuntime()}

function normalizeMatchCount(value){
  const current=Math.max(0,Number(value?.current)||0),total=Math.max(0,Number(value?.total)||0);
  return {current:current<=total?current:0,total};
}

async function documentRuntimeOptions({url='',blob=null,data=null}={}){
  const options={
    cMapUrl:runtimeUrl(PDF_SEARCH_RUNTIME.cmaps),
    cMapPacked:true,
    iccUrl:runtimeUrl(PDF_SEARCH_RUNTIME.iccs),
    standardFontDataUrl:runtimeUrl(PDF_SEARCH_RUNTIME.standardFonts),
    wasmUrl:runtimeUrl(PDF_SEARCH_RUNTIME.wasm),
    useWorkerFetch:true,
  };
  if(data)options.data=data instanceof Uint8Array?data:new Uint8Array(data);
  else if(blob?.arrayBuffer)options.data=new Uint8Array(await blob.arrayBuffer());
  else options.url=url;
  return options;
}

export async function createPdfSearchViewer({host,url='',blob=null,data=null,query,onMatchState,runtime=null}={}){
  if(!host)throw new Error('PDF preview host is missing.');
  if(!url&&!blob&&!data)throw new Error('PDF preview source is missing.');
  const needle=String(query||'').trim();
  if(needle.length<2)throw new Error('PDF search query is too short.');
  const {pdfjsLib,pdfjsViewer}=runtime||await loadRuntime();
  host.innerHTML='<div class="document-pdfjs-container" tabindex="0"><div class="pdfViewer"></div></div>';
  const container=host.querySelector('.document-pdfjs-container');
  const eventBus=new pdfjsViewer.EventBus();
  const linkService=new pdfjsViewer.PDFLinkService({eventBus,externalLinkTarget:2});
  const findController=new pdfjsViewer.PDFFindController({eventBus,linkService,updateMatchesCountOnProgress:true});
  const viewerOptions={container,eventBus,linkService,findController};
  if(pdfjsLib.AnnotationEditorType?.DISABLE!==undefined)viewerOptions.annotationEditorMode=pdfjsLib.AnnotationEditorType.DISABLE;
  const pdfViewer=new pdfjsViewer.PDFViewer(viewerOptions);
  linkService.setViewer(pdfViewer);
  let destroyed=false,loadingTask=null,pdfDocument=null,lastCount={current:0,total:0},pagesReady=false,lastFitWidth=0,resizeTimer=null,resizeFrame=null,resizeObserver=null;
  const emit=value=>{const next=normalizeMatchCount(value);if(next.current===lastCount.current&&next.total===lastCount.total)return;lastCount=next;onMatchState?.(next)};
  eventBus.on('updatefindmatchescount',event=>emit(event?.matchesCount));
  eventBus.on('updatefindcontrolstate',event=>emit(event?.matchesCount));
  const dispatch=(type='',findPrevious=false)=>{if(destroyed)return;const request=buildPdfFindRequest(needle,{type,findPrevious});request.source=container;eventBus.dispatch('find',request)};
  const cancelScheduledResize=()=>{if(resizeTimer!==null){clearTimeout(resizeTimer);resizeTimer=null}if(resizeFrame!==null){if(typeof cancelAnimationFrame==='function')cancelAnimationFrame(resizeFrame);else clearTimeout(resizeFrame);resizeFrame=null}};
  const measuredWidth=()=>Math.round(Number(container.clientWidth)||Number(container.getBoundingClientRect?.().width)||0);
  const fitToWidth=({force=false}={})=>{if(destroyed||!pagesReady)return false;const width=measuredWidth();if(width<80)return false;if(!force&&Math.abs(width-lastFitWidth)<2)return false;lastFitWidth=width;pdfViewer.currentScaleValue='page-width';pdfViewer.update?.();return true};
  const queueFrame=callback=>{resizeFrame=typeof requestAnimationFrame==='function'?requestAnimationFrame(()=>{resizeFrame=null;callback()}):setTimeout(()=>{resizeFrame=null;callback()},0)};
  const scheduleResize=({immediate=false}={})=>{if(destroyed)return;cancelScheduledResize();if(immediate){queueFrame(()=>fitToWidth());return}resizeTimer=setTimeout(()=>{resizeTimer=null;queueFrame(()=>fitToWidth())},90)};
  if(typeof ResizeObserver==='function'){resizeObserver=new ResizeObserver(()=>scheduleResize());resizeObserver.observe(container)}
  eventBus.on('pagesinit',()=>{if(destroyed)return;pagesReady=true;lastFitWidth=0;fitToWidth({force:true});dispatch('',false)});
  try{
    loadingTask=pdfjsLib.getDocument(await documentRuntimeOptions({url,blob,data}));
    pdfDocument=await loadingTask.promise;
    if(destroyed){await pdfDocument.destroy?.();throw new Error('PDF preview was closed before loading finished.')}
    pdfViewer.setDocument(pdfDocument);linkService.setDocument(pdfDocument,null);
  }catch(error){host.innerHTML='';throw error}
  return {
    next(){dispatch('again',false)},
    previous(){dispatch('again',true)},
    resize(options={}){scheduleResize(options)},
    matchState(){return {...lastCount}},
    async destroy(){
      if(destroyed)return;destroyed=true;cancelScheduledResize();resizeObserver?.disconnect?.();resizeObserver=null;
      try{pdfViewer.setDocument(null)}catch{}
      try{linkService.setDocument(null,null)}catch{}
      try{await loadingTask?.destroy?.()}catch{}
      try{await pdfDocument?.destroy?.()}catch{}
    },
  };
}
