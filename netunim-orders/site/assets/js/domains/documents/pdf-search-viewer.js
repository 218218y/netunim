const PDFJS_VERSION='6.3.289';
const PDFJS_CDN=`https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}`;
const PDFJS_JSDELIVR=`https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}`;

export const PDF_SEARCH_RUNTIMES=[
  {version:PDFJS_VERSION,pdf:`${PDFJS_CDN}/pdf.min.mjs`,viewer:`${PDFJS_CDN}/pdf_viewer.mjs`,worker:`${PDFJS_CDN}/pdf.worker.min.mjs`,css:`${PDFJS_CDN}/pdf_viewer.css`},
  {version:PDFJS_VERSION,pdf:`${PDFJS_JSDELIVR}/build/pdf.min.mjs`,viewer:`${PDFJS_JSDELIVR}/web/pdf_viewer.mjs`,worker:`${PDFJS_JSDELIVR}/build/pdf.worker.min.mjs`,css:`${PDFJS_JSDELIVR}/web/pdf_viewer.css`},
];
export const PDF_SEARCH_RUNTIME=PDF_SEARCH_RUNTIMES[0];

let runtimePromise=null;
let stylesheetPromise=null;
const runtimeScriptPromises=new Map();

function absoluteCssUrls(cssText,baseUrl){
  return String(cssText||'').replace(/url\(\s*(["\']?)(?!data:|blob:|https?:|\/)([^"\')]+)\1\s*\)/gi,(_,quote,value)=>`url("${new URL(value.trim(),baseUrl).href}")`);
}

function ensureViewerStylesheet(runtime){
  if(stylesheetPromise)return stylesheetPromise;
  stylesheetPromise=(async()=>{
    const response=await fetch(runtime.css,{cache:'force-cache'});
    if(!response.ok)throw new Error(`PDF.js stylesheet failed to load (${response.status}).`);
    const sheet=new CSSStyleSheet();
    await sheet.replace(absoluteCssUrls(await response.text(),runtime.css));
    document.adoptedStyleSheets=[...document.adoptedStyleSheets,sheet];
  })().catch(error=>{stylesheetPromise=null;throw error});
  return stylesheetPromise;
}

export function buildPdfFindRequest(query,{type='',findPrevious=false}={}){
  return {source:null,type,query:String(query||''),phraseSearch:true,caseSensitive:false,entireWord:false,highlightAll:true,findPrevious:!!findPrevious,matchDiacritics:false};
}

function runtimeGlobal(name){
  const value=globalThis[name];
  return value&&typeof value==='object'?value:null;
}

function loadRuntimeScript(url,globalName){
  const ready=runtimeGlobal(globalName);
  if(ready)return Promise.resolve(ready);
  const key=`${globalName}:${url}`;
  if(runtimeScriptPromises.has(key))return runtimeScriptPromises.get(key);
  const task=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.type='module';
    script.async=true;
    script.src=url;
    script.onload=()=>{
      const value=runtimeGlobal(globalName);
      script.remove();
      if(value)resolve(value);
      else reject(new Error(`PDF.js module loaded without ${globalName}.`));
    };
    script.onerror=()=>{script.remove();reject(new Error(`PDF.js module failed to load (${url}).`))};
    document.head.append(script);
  }).catch(error=>{runtimeScriptPromises.delete(key);throw error});
  runtimeScriptPromises.set(key,task);
  return task;
}

async function loadRuntime(){
  if(runtimePromise)return runtimePromise;
  runtimePromise=(async()=>{
    const errors=[];
    for(const runtime of PDF_SEARCH_RUNTIMES){
      try{
        // Keep the application module graph local/static. PDF.js is an explicitly
        // pinned external runtime, loaded as module scripts under the site's CSP.
        // CSS and the display layer start together to avoid serial first-open waits.
        const stylesheetTask=ensureViewerStylesheet(runtime);
        const pdfjsLib=await loadRuntimeScript(runtime.pdf,'pdfjsLib');
        const viewerTask=loadRuntimeScript(runtime.viewer,'pdfjsViewer');
        await stylesheetTask;
        const pdfjsViewer=await viewerTask;
        pdfjsLib.GlobalWorkerOptions.workerSrc=runtime.worker;
        return {pdfjsLib,pdfjsViewer};
      }catch(error){errors.push(error);stylesheetPromise=null}
    }
    throw new Error(`PDF.js runtime is unavailable (${errors.at(-1)?.message||'network error'}).`);
  })().catch(error=>{runtimePromise=null;throw error});
  return runtimePromise;
}

export function preloadPdfSearchRuntime(){return loadRuntime()}

function normalizeMatchCount(value){
  const current=Math.max(0,Number(value?.current)||0),total=Math.max(0,Number(value?.total)||0);
  return {current:current<=total?current:0,total};
}

export async function createPdfSearchViewer({host,url,query,onMatchState,runtime=null}={}){
  if(!host)throw new Error('PDF preview host is missing.');
  if(!url)throw new Error('PDF preview URL is missing.');
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
    loadingTask=pdfjsLib.getDocument({url});
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
