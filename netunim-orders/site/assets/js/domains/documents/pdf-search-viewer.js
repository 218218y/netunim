import {buildViewerFindQuery,findTextMatchOffsets,normalizeContentSearch} from './document-search-navigator.js';
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
  const value=Array.isArray(query)?query.map(item=>String(item||'')).filter(Boolean):String(query||'');
  return {source:null,type,query:value,phraseSearch:true,caseSensitive:false,entireWord:false,highlightAll:true,findPrevious:!!findPrevious,matchDiacritics:false};
}

async function loadRuntime(){
  if(runtimePromise)return runtimePromise;
  runtimePromise=(async()=>{
    // Keep both imports literal and local: the repository module-graph contract can
    // verify them statically, while the browser still downloads PDF.js lazily only
    // when a local PDF preview is opened.
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

const PDF_TEXT_FIELD='Tx';

function normalizedFieldValue(annotation){
  const value=annotation?.fieldValue;
  if(value===null||value===undefined)return '';
  return Array.isArray(value)?value.join(' '):String(value);
}

export function copyablePdfTextFieldModel(annotation,viewport){
  const value=normalizedFieldValue(annotation);
  if(!viewport||annotation?.fieldType!==PDF_TEXT_FIELD||annotation?.password||!value||!Array.isArray(annotation.rect)||annotation.rect.length!==4)return null;
  const converted=viewport.convertToViewportRectangle?.(annotation.rect);
  if(!Array.isArray(converted)||converted.length!==4)return null;
  const width=Math.abs(Number(viewport.width)||0),height=Math.abs(Number(viewport.height)||0);
  if(width<=0||height<=0)return null;
  const [x1,y1,x2,y2]=converted.map(Number),left=Math.min(x1,x2),top=Math.min(y1,y2),right=Math.max(x1,x2),bottom=Math.max(y1,y2);
  if(![left,top,right,bottom].every(Number.isFinite)||right<=left||bottom<=top)return null;
  return {
    value,
    multiLine:!!annotation.multiLine,
    fieldName:String(annotation.fieldName||''),
    fontSize:Math.max(0,Number(annotation.defaultAppearanceData?.fontSize)||0),
    left:100*left/width,
    top:100*top/height,
    width:100*(right-left)/width,
    height:100*(bottom-top)/height,
  };
}

function createCopyablePdfField(model){
  const field=document.createElement(model.multiLine?'textarea':'input');
  if(!model.multiLine)field.type='text';
  field.className='document-pdf-copy-field';
  field.readOnly=true;
  field.value=model.value;
  field.dir='auto';
  field.tabIndex=0;
  field.setAttribute('aria-readonly','true');
  if(model.fieldName)field.setAttribute('aria-label',model.fieldName);
  field.style.left=`${model.left}%`;
  field.style.top=`${model.top}%`;
  field.style.width=`${model.width}%`;
  field.style.height=`${model.height}%`;
  if(model.fontSize>0)field.style.fontSize=`calc(${model.fontSize}px * var(--total-scale-factor))`;
  return field;
}

async function renderCopyablePdfFields(pageView,{isCurrent=()=>true}={}){
  const root=pageView?.annotationLayer?.div,pdfPage=pageView?.pdfPage,viewport=pageView?.viewport;
  if(!root||!pdfPage?.getAnnotations||!viewport)return 0;
  const annotations=await pdfPage.getAnnotations({intent:'display'});
  if(!isCurrent()||pageView.annotationLayer?.div!==root)return 0;
  root.querySelectorAll?.('.document-pdf-copy-field').forEach(field=>field.remove());
  let added=0;
  for(const annotation of annotations||[]){
    const model=copyablePdfTextFieldModel(annotation,viewport);
    if(!model)continue;
    root.append(createCopyablePdfField(model));
    added+=1;
  }
  return added;
}

function textBoundaryOffset(root,container,offset){
  if(!root?.contains?.(container)&&root!==container)return null;
  try{
    const range=document.createRange();
    range.selectNodeContents(root);
    range.setEnd(container,offset);
    return range.toString().length;
  }catch{return null}
}

function selectedTextFromDiv(range,div){
  try{if(!range.intersectsNode(div))return ''}catch{return ''}
  const text=String(div.textContent||'');
  if(!text)return '';
  let start=0,end=text.length;
  const startOffset=textBoundaryOffset(div,range.startContainer,range.startOffset);
  const endOffset=textBoundaryOffset(div,range.endContainer,range.endOffset);
  if(startOffset!==null)start=Math.max(0,Math.min(text.length,startOffset));
  if(endOffset!==null)end=Math.max(start,Math.min(text.length,endOffset));
  return text.slice(start,end);
}

function hasExplicitBreakBetween(previous,current){
  if(!previous||!current||previous.ownerDocument!==current.ownerDocument)return false;
  try{
    const range=previous.ownerDocument.createRange();
    range.setStartAfter(previous);range.setEndBefore(current);
    return !!range.cloneContents().querySelector?.('br');
  }catch{return false}
}

function visualLineMatch(previous,current){
  if(!previous?.rect||!current?.rect)return true;
  const a=previous.rect,b=current.rect;
  const ah=Math.max(1,Math.abs(a.bottom-a.top)),bh=Math.max(1,Math.abs(b.bottom-b.top));
  const ac=(a.top+a.bottom)/2,bc=(b.top+b.bottom)/2;
  return Math.abs(ac-bc)<=Math.max(ah,bh)*0.55;
}

function horizontalGap(previous,current){
  if(!previous?.rect||!current?.rect)return 0;
  const a=previous.rect,b=current.rect;
  return Math.max(0,Math.max(a.left,b.left)-Math.min(a.right,b.right));
}

export function joinPdfTextSelectionSegments(segments){
  let result='',previous=null;
  for(const segment of segments||[]){
    const text=String(segment?.text||'');
    if(!text)continue;
    if(previous){
      const explicitBreak=!!segment.breakBefore||segment.pageKey!==previous.pageKey;
      if(explicitBreak||!visualLineMatch(previous,segment)){
        if(!/\s$/.test(result)&&!/^\s/.test(text))result+='\n';
      }else if(!/\s$/.test(result)&&!/^\s/.test(text)){
        const minHeight=Math.min(Math.max(1,Math.abs(previous.rect?.bottom-previous.rect?.top)||1),Math.max(1,Math.abs(segment.rect?.bottom-segment.rect?.top)||1));
        if(horizontalGap(previous,segment)>Math.max(.75,minHeight*.08))result+=' ';
      }
    }
    result+=text;
    previous=segment;
  }
  return result;
}

function selectedPdfText(container,selection){
  if(!selection?.rangeCount||selection.isCollapsed)return '';
  const segments=[];
  for(let rangeIndex=0;rangeIndex<selection.rangeCount;rangeIndex++){
    const range=selection.getRangeAt(rangeIndex);
    let previousNode=null;
    for(const div of container.querySelectorAll?.('.textLayer span[role="presentation"]')||[]){
      const text=selectedTextFromDiv(range,div);
      if(!text)continue;
      const layer=div.closest?.('.textLayer'),page=div.closest?.('.page');
      segments.push({
        text,
        rect:div.getBoundingClientRect?.()||null,
        pageKey:page?.dataset?.pageNumber||layer||null,
        breakBefore:previousNode?hasExplicitBreakBetween(previousNode,div):false,
      });
      previousNode=div;
    }
  }
  return joinPdfTextSelectionSegments(segments);
}

function installPdfCopyHandler(container,normalizeUnicodeFn=value=>value){
  if(typeof document==='undefined'||!document.addEventListener)return ()=>{};
  const handler=event=>{
    const selection=document.getSelection?.();
    if(!selection?.rangeCount||selection.isCollapsed||!event.clipboardData)return;
    const anchor=selection.anchorNode,focus=selection.focusNode;
    if(!container.contains?.(anchor)||!container.contains?.(focus))return;
    const anchorElement=anchor?.nodeType===1?anchor:anchor?.parentElement;
    const focusElement=focus?.nodeType===1?focus:focus?.parentElement;
    if(!anchorElement?.closest?.('.textLayer')||!focusElement?.closest?.('.textLayer'))return;
    const reconstructed=selectedPdfText(container,selection);
    if(!reconstructed)return;
    const normalized=String(normalizeUnicodeFn(reconstructed)||'').replaceAll('\x00','');
    event.clipboardData.setData('text/plain',normalized);
    event.preventDefault();
    event.stopPropagation();
  };
  document.addEventListener('copy',handler,true);
  return ()=>document.removeEventListener('copy',handler,true);
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

export async function createPdfSearchViewer({host,url='',blob=null,data=null,query,contentSearch={},onMatchState,runtime=null,interactiveForms=true}={}){
  if(!host)throw new Error('PDF preview host is missing.');
  if(!url&&!blob&&!data)throw new Error('PDF preview source is missing.');
  const needle=String(query||'').trim(),search=normalizeContentSearch(contentSearch),findQuery=buildViewerFindQuery(needle,search);
  const hasFindQuery=Array.isArray(findQuery)?findQuery.length>0:String(findQuery||'').length>=2;
  const {pdfjsLib,pdfjsViewer}=runtime||await loadRuntime();
  host.innerHTML='<div class="document-pdfjs-container" tabindex="0"><div class="pdfViewer"></div></div>';
  const container=host.querySelector('.document-pdfjs-container');
  const eventBus=new pdfjsViewer.EventBus();
  const linkService=new pdfjsViewer.PDFLinkService({eventBus,externalLinkTarget:2});
  const findController=hasFindQuery?new pdfjsViewer.PDFFindController({eventBus,linkService,updateMatchesCountOnProgress:true}):null;
  if(findController&&search.matchMode==='proximity'){findController.match=(_query,pageContent)=>findTextMatchOffsets(pageContent,needle,{...search,maxMatches:20000}).matches.map(match=>({index:match.start,length:match.end-match.start}))}
  const viewerOptions={container,eventBus,linkService,findController};
  // Preview is never an editor. Always paint the PDF-authored AcroForm appearance
  // streams so custom/legacy Hebrew fonts are rendered exactly as the PDF saved them.
  // Local files get a separate transparent read-only text layer for selection/copy;
  // Drive keeps the same static rendering without exposing form values as controls.
  const annotationMode=pdfjsLib.AnnotationMode?.ENABLE;
  if(annotationMode!==undefined)viewerOptions.annotationMode=annotationMode;
  if(pdfjsLib.AnnotationEditorType?.DISABLE!==undefined)viewerOptions.annotationEditorMode=pdfjsLib.AnnotationEditorType.DISABLE;
  const pdfViewer=new pdfjsViewer.PDFViewer(viewerOptions);
  linkService.setViewer(pdfViewer);
  let destroyed=false,loadingTask=null,pdfDocument=null,lastCount={current:0,total:0},pagesReady=false,lastFitWidth=0,resizeTimer=null,resizeFrame=null,resizeObserver=null;
  const copyFieldGeneration=new Map();
  const removeCopyHandler=installPdfCopyHandler(container,pdfjsLib.normalizeUnicode||((value)=>value));
  const emit=value=>{const next=normalizeMatchCount(value);if(next.current===lastCount.current&&next.total===lastCount.total)return;lastCount=next;onMatchState?.(next)};
  if(hasFindQuery){
    eventBus.on('updatefindmatchescount',event=>emit(event?.matchesCount));
    eventBus.on('updatefindcontrolstate',event=>emit(event?.matchesCount));
  }
  if(interactiveForms)eventBus.on('annotationlayerrendered',event=>{
    const pageNumber=Number(event?.pageNumber)||0,generation=(copyFieldGeneration.get(pageNumber)||0)+1;
    copyFieldGeneration.set(pageNumber,generation);
    renderCopyablePdfFields(event?.source,{isCurrent:()=>!destroyed&&copyFieldGeneration.get(pageNumber)===generation}).catch(()=>{});
  });
  const dispatch=(type='',findPrevious=false)=>{if(destroyed||!hasFindQuery)return;const request=buildPdfFindRequest(findQuery,{type,findPrevious});request.source=container;eventBus.dispatch('find',request)};
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
      if(destroyed)return;destroyed=true;removeCopyHandler();copyFieldGeneration.clear();cancelScheduledResize();resizeObserver?.disconnect?.();resizeObserver=null;
      try{pdfViewer.setDocument(null)}catch{}
      try{linkService.setDocument(null,null)}catch{}
      try{await loadingTask?.destroy?.()}catch{}
      try{await pdfDocument?.destroy?.()}catch{}
    },
  };
}
