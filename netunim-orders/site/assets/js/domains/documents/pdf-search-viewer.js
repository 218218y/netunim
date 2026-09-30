import {buildTextMatchSnippet,buildViewerFindQuery,findTextMatchOffsets,normalizeContentSearch} from './document-search-navigator.js';
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

function installPdfJsBrowserCompatibility(){
  if(typeof Promise.try!=='function')Object.defineProperty(Promise,'try',{configurable:true,writable:true,value:function(callback,...args){return new Promise(resolve=>resolve(callback(...args)))}});
  if(typeof Uint8Array.prototype.toHex!=='function')Object.defineProperty(Uint8Array.prototype,'toHex',{configurable:true,writable:true,value:function(){return Array.from(this,byte=>byte.toString(16).padStart(2,'0')).join('')}});
  if(typeof Math.sumPrecise!=='function')Object.defineProperty(Math,'sumPrecise',{configurable:true,writable:true,value:function(values){let total=0;for(const value of values)total+=Number(value)||0;return total}});
  if(typeof Map.prototype.getOrInsert!=='function')Object.defineProperty(Map.prototype,'getOrInsert',{configurable:true,writable:true,value:function(key,value){if(this.has(key))return this.get(key);this.set(key,value);return value}});
  if(typeof Map.prototype.getOrInsertComputed!=='function')Object.defineProperty(Map.prototype,'getOrInsertComputed',{configurable:true,writable:true,value:function(key,callback){if(this.has(key))return this.get(key);const value=callback(key);this.set(key,value);return value}});
}

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
    installPdfJsBrowserCompatibility();
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
const PDF_CHOICE_FIELD='Ch';
const PDF_FORM_MATCH_LIMIT=5000;

function normalizedFieldValue(annotation){
  const value=annotation?.fieldValue;
  if(value===null||value===undefined)return '';
  return Array.isArray(value)?value.join(' '):String(value);
}

function searchablePdfField(annotation){return !annotation?.password&&[PDF_TEXT_FIELD,PDF_CHOICE_FIELD].includes(String(annotation?.fieldType||''))&&!!normalizedFieldValue(annotation)}
export function pdfFieldKey(annotation,index=0,pageNumber=1){const id=String(annotation?.id||'').trim();if(id)return `id:${id}`;const rect=normalizedPdfRect(annotation?.rect)||[];return `field:${Math.max(1,Number(pageNumber)||1)}:${Math.max(0,Number(index)||0)}:${String(annotation?.fieldName||'')}:${rect.join(',')}`}
function normalizedPdfRect(rect){if(!Array.isArray(rect)||rect.length!==4)return null;const values=rect.map(Number);return values.every(Number.isFinite)?values:null}
function pdfViewportPoint(viewport,x,y){
  const px=Number(x),py=Number(y);if(!viewport||!Number.isFinite(px)||!Number.isFinite(py))return null;
  if(typeof viewport.convertToViewportPoint==='function'){const point=viewport.convertToViewportPoint(px,py);if(Array.isArray(point)&&point.length>=2&&point.slice(0,2).every(Number.isFinite))return point.slice(0,2)}
  const transform=Array.isArray(viewport.transform)?viewport.transform:null;if(!transform||transform.length<6)return null;
  const values=transform.slice(0,6).map(Number);if(!values.every(Number.isFinite))return null;
  const [a,b,c,d,e,f]=values;return [a*px+c*py+e,b*px+d*py+f];
}
function pdfRectGeometry(rect,viewport){
  const source=normalizedPdfRect(rect);if(!viewport||!source)return null;
  // PDF.js 6.x exposes point conversion, not the removed convertToViewportRectangle API.
  // Mapping the two opposite corners is sufficient because PageViewport only applies
  // scale/translation plus right-angle rotation/axis flips.
  const first=pdfViewportPoint(viewport,source[0],source[1]),second=pdfViewportPoint(viewport,source[2],source[3]);if(!first||!second)return null;
  const width=Math.abs(Number(viewport.width)||0),height=Math.abs(Number(viewport.height)||0);if(width<=0||height<=0)return null;
  const [x1,y1]=first,[x2,y2]=second,left=Math.min(x1,x2),top=Math.min(y1,y2),right=Math.max(x1,x2),bottom=Math.max(y1,y2);
  if(![left,top,right,bottom].every(Number.isFinite)||right<=left||bottom<=top)return null;
  return {left:100*left/width,top:100*top/height,width:100*(right-left)/width,height:100*(bottom-top)/height};
}
function pdfFieldRectModel(annotation,viewport,index=0,pageNumber=1){
  const value=normalizedFieldValue(annotation),geometry=pdfRectGeometry(annotation?.rect,viewport);
  if(!geometry||!searchablePdfField(annotation))return null;
  return {value,fieldKey:pdfFieldKey(annotation,index,pageNumber),fieldType:String(annotation.fieldType||''),multiLine:!!annotation.multiLine,fieldName:String(annotation.fieldName||''),fontSize:Math.max(0,Number(annotation.defaultAppearanceData?.fontSize)||0),...geometry};
}
function pdfFormMatchRectModel(match,viewport){const geometry=pdfRectGeometry(match?.rect,viewport);return geometry?{fieldKey:String(match?.fieldKey||''),...geometry}:null}

export function copyablePdfTextFieldModel(annotation,viewport,index=0){const model=pdfFieldRectModel(annotation,viewport,index);return model?.fieldType===PDF_TEXT_FIELD?model:null}

export function findPdfFormFieldMatches(annotations,pageNumber,query,contentSearch={},maxMatches=PDF_FORM_MATCH_LIMIT){
  const search=normalizeContentSearch(contentSearch),highlightSearch=search.matchMode==='all'?{...search,matchMode:'any'}:search,rows=[];let capped=false;
  const limit=Math.max(1,Math.min(PDF_FORM_MATCH_LIMIT,Number(maxMatches)||PDF_FORM_MATCH_LIMIT));
  for(const [annotationIndex,annotation] of (annotations||[]).entries()){
    if(!searchablePdfField(annotation))continue;
    const value=normalizedFieldValue(annotation),remaining=limit-rows.length;if(remaining<=0){capped=true;break}
    const found=findTextMatchOffsets(value,query,{...highlightSearch,maxMatches:remaining});
    for(const match of found.matches)rows.push({kind:'form',pageNumber:Number(pageNumber)||1,pageIdx:Math.max(0,(Number(pageNumber)||1)-1),annotationIndex,fieldKey:pdfFieldKey(annotation,annotationIndex,pageNumber),fieldName:String(annotation.fieldName||''),fieldType:String(annotation.fieldType||''),rect:normalizedPdfRect(annotation.rect),start:match.start,end:match.end,snippet:buildTextMatchSnippet(value,match),value});
    capped=capped||found.capped;if(rows.length>=limit){capped=true;break}
  }
  return {matches:rows,capped};
}

export async function collectPdfFormSearchMatches(pdfDocument,query,contentSearch={},maxMatches=PDF_FORM_MATCH_LIMIT,{isCancelled=()=>false}={}){
  const matchesByPage=new Map();let remaining=Math.max(1,Math.min(PDF_FORM_MATCH_LIMIT,Number(maxMatches)||PDF_FORM_MATCH_LIMIT)),capped=false;
  const pages=Math.max(0,Number(pdfDocument?.numPages)||0);
  for(let pageNumber=1;pageNumber<=pages&&remaining>0;pageNumber+=1){
    if(isCancelled())break;
    try{
      const page=await pdfDocument.getPage(pageNumber),annotations=await page.getAnnotations({intent:'display'}),found=findPdfFormFieldMatches(annotations,pageNumber,query,contentSearch,remaining);
      if(found.matches.length){
        const fields=new Map();
        for(const match of found.matches){const list=fields.get(match.fieldKey)||[];list.push(match);fields.set(match.fieldKey,list)}
        matchesByPage.set(pageNumber,fields);remaining-=found.matches.length;
      }
      capped=capped||found.capped;
    }catch{}
  }
  if(remaining<=0)capped=true;
  return {matchesByPage,capped};
}

function applyFieldGeometry(element,model){element.style.left=`${model.left}%`;element.style.top=`${model.top}%`;element.style.width=`${model.width}%`;element.style.height=`${model.height}%`}
function createCopyablePdfField(model){
  const field=document.createElement(model.multiLine?'textarea':'input');
  if(!model.multiLine)field.type='text';
  field.className='document-pdf-copy-field';field.dataset.pdfFieldKey=model.fieldKey;field.readOnly=true;field.value=model.value;field.dir='auto';field.tabIndex=0;field.setAttribute('aria-readonly','true');
  if(model.fieldName)field.setAttribute('aria-label',model.fieldName);applyFieldGeometry(field,model);if(model.fontSize>0)field.style.fontSize=`calc(${model.fontSize}px * var(--total-scale-factor))`;return field;
}
function createPdfFormMatchMarker(model,{current=false,count=1}={}){const marker=document.createElement('span');marker.className=`document-pdf-form-match-marker${current?' current':''}`;marker.dataset.pdfFieldKey=model.fieldKey;marker.dataset.matchCount=String(Math.max(1,Number(count)||1));marker.setAttribute('aria-hidden','true');applyFieldGeometry(marker,model);return marker}

function ensurePdfFormOverlay(pageView){
  const page=pageView?.div;if(!page)return null;
  // PDF.js deliberately removes unknown direct children of `.page` whenever a
  // page is reset (scale/fit-width/render lifecycle). Keep our overlay inside
  // canvasWrapper instead: PDF.js owns that layer and preserves it across the
  // common CSS/scale reset path, while our marker remains above the canvas.
  const owner=page.querySelector?.(':scope > .canvasWrapper')||null;if(!owner)return null;
  let overlay=owner.querySelector?.(':scope > .document-pdf-form-overlay')||null;
  if(!overlay){overlay=document.createElement('div');overlay.className='document-pdf-form-overlay';overlay.dataset.pageNumber=String(Number(pageView?.id)||Number(page.dataset?.pageNumber)||'');owner.append(overlay)}
  return overlay;
}

function renderPdfFormMarkers(pageView,{formMatchesByField=null,currentFormFieldKey=''}={}){
  const page=pageView?.div,viewport=pageView?.viewport;if(!page||!viewport)return 0;
  const root=ensurePdfFormOverlay(pageView);if(!root)return 0;
  for(const marker of root.querySelectorAll?.('.document-pdf-form-match-marker')||[])marker.remove?.();
  let added=0;
  for(const [fieldKey,fieldMatches] of formMatchesByField?.entries?.()||[]){
    const markerModel=pdfFormMatchRectModel(fieldMatches?.[0],viewport);if(!markerModel)continue;
    root.append(createPdfFormMatchMarker(markerModel,{current:fieldKey===currentFormFieldKey,count:fieldMatches.length}));added+=1;
  }
  return added;
}

async function renderCopyablePdfFields(pageView,{isCurrent=()=>true,formMatchesByField=null,currentFormFieldKey=''}={}){
  const page=pageView?.div,pdfPage=pageView?.pdfPage,viewport=pageView?.viewport;
  if(!page||!viewport)return 0;
  // Bridge anchors already contain authoritative PDF rectangles. Paint those first
  // and never make their visibility depend on PDF.js successfully rebuilding the
  // interactive annotation layer in this browser. Annotation parsing below is only
  // needed for the transparent copy/select controls.
  const markerCount=renderPdfFormMarkers(pageView,{formMatchesByField,currentFormFieldKey});
  if(!pdfPage?.getAnnotations)return markerCount;
  let annotations;try{annotations=await pdfPage.getAnnotations({intent:'display'})}catch{return markerCount}
  if(!isCurrent()||pageView.div!==page)return markerCount;
  const root=ensurePdfFormOverlay(pageView);if(!root)return markerCount;
  for(const field of root.querySelectorAll?.('.document-pdf-copy-field')||[])field.remove?.();
  const pageNumber=Math.max(1,Number(pageView?.id)||Number(page.dataset?.pageNumber)||1);let added=0;
  for(const [annotationIndex,annotation] of (annotations||[]).entries()){
    const rectModel=pdfFieldRectModel(annotation,viewport,annotationIndex,pageNumber);if(!rectModel||rectModel.fieldType!==PDF_TEXT_FIELD)continue;
    root.append(createCopyablePdfField(rectModel));added+=1;
  }
  return markerCount+added;
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
  // Local files get a separate transparent read-only text layer for selection/copy,
  // plus a search marker layer for AcroForm values that PDF.js text search cannot see.
  const annotationMode=pdfjsLib.AnnotationMode?.ENABLE;
  if(annotationMode!==undefined)viewerOptions.annotationMode=annotationMode;
  if(pdfjsLib.AnnotationEditorType?.DISABLE!==undefined)viewerOptions.annotationEditorMode=pdfjsLib.AnnotationEditorType.DISABLE;
  const pdfViewer=new pdfjsViewer.PDFViewer(viewerOptions);
  linkService.setViewer(pdfViewer);
  let destroyed=false,loadingTask=null,pdfDocument=null,lastState={current:0,total:0},pagesReady=false,lastFitWidth=0,resizeTimer=null,resizeFrame=null,resizeObserver=null,combinedRefreshQueued=false;
  let formSearchReady=!hasFindQuery||!interactiveForms,formSearchCapped=false,combinedReady=false,combinedMatches=[],combinedIndex=-1,externalFormMatchesApplied=false;
  const formMatchesByPage=new Map(),copyFieldGeneration=new Map();
  const removeCopyHandler=installPdfCopyHandler(container,pdfjsLib.normalizeUnicode||((value)=>value));
  const normalizeViewerState=value=>({current:Math.max(0,Number(value?.current)||0),total:Math.max(0,Number(value?.total)||0),snippet:value?.snippet||null,capped:!!value?.capped,location:String(value?.location||'')});
  const emit=value=>{const next=normalizeViewerState(value);if(next.current===lastState.current&&next.total===lastState.total&&next.snippet===lastState.snippet&&next.location===lastState.location&&next.capped===lastState.capped)return;lastState=next;onMatchState?.(next)};
  const hasFormMatches=()=>{for(const fields of formMatchesByPage.values())for(const matches of fields.values())if(matches.length)return true;return false};
  const nativeMatchState=value=>{if(formSearchReady&&hasFormMatches())return;emit(normalizeMatchCount(value))};
  if(hasFindQuery){eventBus.on('updatefindmatchescount',event=>{nativeMatchState(event?.matchesCount);scheduleCombinedRefresh()});eventBus.on('updatefindcontrolstate',event=>{nativeMatchState(event?.matchesCount);scheduleCombinedRefresh()})}
  const currentFormEntry=()=>combinedIndex>=0&&combinedMatches[combinedIndex]?.kind==='form'?combinedMatches[combinedIndex]:null;
  const pageFieldMatches=pageNumber=>formMatchesByPage.get(Number(pageNumber)||0)||null;
  async function refreshRenderedFormLayers(){if(!interactiveForms||!pdfDocument)return;const current=currentFormEntry();for(let pageNumber=1;pageNumber<=pdfDocument.numPages;pageNumber+=1){const pageView=pdfViewer.getPageView?.(pageNumber-1);if(!pageView?.div||!pageView?.pdfPage)continue;const generation=(copyFieldGeneration.get(pageNumber)||0)+1;copyFieldGeneration.set(pageNumber,generation);await renderCopyablePdfFields(pageView,{isCurrent:()=>!destroyed&&copyFieldGeneration.get(pageNumber)===generation,formMatchesByField:pageFieldMatches(pageNumber),currentFormFieldKey:current?.pageNumber===pageNumber?current.fieldKey:''}).catch(()=>{})}}
  const renderFormLayerForEvent=event=>{if(!interactiveForms)return;const pageNumber=Number(event?.pageNumber)||0,pageView=event?.source;if(!pageNumber||!pageView?.div)return;const generation=(copyFieldGeneration.get(pageNumber)||0)+1;copyFieldGeneration.set(pageNumber,generation);const current=currentFormEntry();renderCopyablePdfFields(pageView,{isCurrent:()=>!destroyed&&copyFieldGeneration.get(pageNumber)===generation,formMatchesByField:pageFieldMatches(pageNumber),currentFormFieldKey:current?.pageNumber===pageNumber?current.fieldKey:''}).then(()=>{if(current?.pageNumber===pageNumber)scrollCurrentFormMatch(current,{behavior:'auto'})}).catch(()=>{})};
  if(interactiveForms){eventBus.on('pagerendered',renderFormLayerForEvent);eventBus.on('annotationlayerrendered',renderFormLayerForEvent)}
  const dispatch=(type='',findPrevious=false)=>{if(destroyed||!hasFindQuery)return;const request=buildPdfFindRequest(findQuery,{type,findPrevious});request.source=container;eventBus.dispatch('find',request)};
  const cancelScheduledResize=()=>{if(resizeTimer!==null){clearTimeout(resizeTimer);resizeTimer=null}if(resizeFrame!==null){if(typeof cancelAnimationFrame==='function')cancelAnimationFrame(resizeFrame);else clearTimeout(resizeFrame);resizeFrame=null}};
  const measuredWidth=()=>Math.round(Number(container.clientWidth)||Number(container.getBoundingClientRect?.().width)||0);
  const fitToWidth=({force=false}={})=>{if(destroyed||!pagesReady)return false;const width=measuredWidth();if(width<80)return false;if(!force&&Math.abs(width-lastFitWidth)<2)return false;lastFitWidth=width;pdfViewer.currentScaleValue='page-width';pdfViewer.update?.();return true};
  const queueFrame=callback=>{resizeFrame=typeof requestAnimationFrame==='function'?requestAnimationFrame(()=>{resizeFrame=null;callback()}):setTimeout(()=>{resizeFrame=null;callback()},0)};
  const scheduleResize=({immediate=false}={})=>{if(destroyed)return;cancelScheduledResize();if(immediate){queueFrame(()=>fitToWidth());return}resizeTimer=setTimeout(()=>{resizeTimer=null;queueFrame(()=>fitToWidth())},90)};
  if(typeof ResizeObserver==='function'){resizeObserver=new ResizeObserver(()=>scheduleResize());resizeObserver.observe(container)}
  eventBus.on('pagesinit',()=>{if(destroyed)return;pagesReady=true;lastFitWidth=0;fitToWidth({force:true});dispatch('',false)});
  function formMarkerFor(entry){const pageView=pdfViewer.getPageView?.(entry.pageNumber-1),root=pageView?.div?.querySelector?.('.document-pdf-form-overlay');if(!root)return null;return [...(root.querySelectorAll?.('.document-pdf-form-match-marker')||[])].find(marker=>marker.dataset?.pdfFieldKey===entry.fieldKey)||null}
  function scrollElementToCenter(element,{behavior='smooth'}={}){const rect=element?.getBoundingClientRect?.(),hostRect=container.getBoundingClientRect?.();if(!rect||!hostRect)return false;const top=container.scrollTop+(rect.top-hostRect.top)-(container.clientHeight/2)+(rect.height/2);container.scrollTo?.({top:Math.max(0,top),left:Math.max(0,container.scrollLeft||0),behavior});return true}
  function scrollCurrentFormMatch(entry,{behavior='smooth'}={}){if(!entry||destroyed)return false;const marker=formMarkerFor(entry);if(marker)return scrollElementToCenter(marker,{behavior});linkService.page=entry.pageNumber;return false}
  function refreshFormMarkerCurrent(){const current=currentFormEntry();for(const marker of container.querySelectorAll?.('.document-pdf-form-match-marker')||[]){const pageNumber=Number(marker.closest?.('.page')?.dataset?.pageNumber)||0;marker.classList.toggle('current',!!current&&pageNumber===current.pageNumber&&marker.dataset?.pdfFieldKey===current.fieldKey)}}
  function selectNativeTextMatch(entry){if(!findController?.selected)return false;const selected=findController.selected,previousPage=Number(selected.pageIdx);selected.pageIdx=entry.pageIdx;selected.matchIdx=entry.matchIdx;if('_scrollMatches' in findController)findController._scrollMatches=true;linkService.page=entry.pageNumber;if(previousPage>=0&&previousPage!==entry.pageIdx)eventBus.dispatch('updatetextlayermatches',{source:findController,pageIndex:previousPage});eventBus.dispatch('updatetextlayermatches',{source:findController,pageIndex:entry.pageIdx});return true}
  function clearNativeTextSelection(){if(!findController?.selected)return;const selected=findController.selected,previousPage=Number(selected.pageIdx);selected.pageIdx=-1;selected.matchIdx=-1;if(previousPage>=0)eventBus.dispatch('updatetextlayermatches',{source:findController,pageIndex:previousPage})}
  function combinedState(){const entry=combinedIndex>=0?combinedMatches[combinedIndex]:null;return {current:entry?combinedIndex+1:0,total:combinedMatches.length,snippet:entry?.snippet||null,capped:formSearchCapped,location:entry?`עמוד ${entry.pageNumber}`:''}}
  function goCombined(index,{behavior='smooth'}={}){if(!combinedReady||!combinedMatches.length){emit(combinedState());return combinedState()}combinedIndex=(Number(index)%combinedMatches.length+combinedMatches.length)%combinedMatches.length;const entry=combinedMatches[combinedIndex];if(entry.kind==='form'){clearNativeTextSelection();refreshFormMarkerCurrent();if(!scrollCurrentFormMatch(entry,{behavior}))queueMicrotask(()=>refreshRenderedFormLayers())}else{refreshFormMarkerCurrent();selectNativeTextMatch(entry)}const state=combinedState();emit(state);return state}
  function combinedEntryKey(entry){return entry?.kind==='form'?`form:${entry.pageIdx}:${entry.fieldKey}:${entry.start}:${entry.end}`:entry?.kind==='text'?`text:${entry.pageIdx}:${entry.matchIdx}`:''}
  function buildCombinedMatches(){const rows=[];if(findController&&pdfDocument){for(let pageIdx=0;pageIdx<pdfDocument.numPages;pageIdx+=1){const pageMatches=Array.isArray(findController.pageMatches?.[pageIdx])?findController.pageMatches[pageIdx]:[];for(let matchIdx=0;matchIdx<pageMatches.length;matchIdx+=1)rows.push({kind:'text',pageIdx,pageNumber:pageIdx+1,matchIdx,sortGroup:0,sortIndex:Number(pageMatches[matchIdx])||matchIdx})}}for(const fields of formMatchesByPage.values()){for(const fieldMatches of fields.values())for(const match of fieldMatches)rows.push({...match,sortGroup:1,sortIndex:match.annotationIndex*100000+match.start})}rows.sort((a,b)=>a.pageIdx-b.pageIdx||a.sortGroup-b.sortGroup||a.sortIndex-b.sortIndex);return rows}
  function refreshCombinedNavigation({navigateInitial=false}={}){if(destroyed||!hasFindQuery||!formSearchReady)return false;const previousKey=combinedEntryKey(combinedIndex>=0?combinedMatches[combinedIndex]:null),selected=findController?.selected;combinedMatches=buildCombinedMatches();combinedReady=true;let nextIndex=previousKey?combinedMatches.findIndex(row=>combinedEntryKey(row)===previousKey):-1;if(nextIndex<0&&selected?.pageIdx>=0&&selected?.matchIdx>=0)nextIndex=combinedMatches.findIndex(row=>row.kind==='text'&&row.pageIdx===selected.pageIdx&&row.matchIdx===selected.matchIdx);if(nextIndex<0)nextIndex=combinedMatches.length?0:-1;const currentChanged=nextIndex!==combinedIndex||combinedEntryKey(combinedMatches[nextIndex])!==previousKey;combinedIndex=nextIndex;refreshFormMarkerCurrent();if(navigateInitial&&combinedIndex>=0)goCombined(combinedIndex,{behavior:'auto'});else if(currentChanged||navigateInitial)emit(combinedState());return true}
  function scheduleCombinedRefresh(){if(destroyed||!hasFindQuery||!formSearchReady||combinedRefreshQueued)return;combinedRefreshQueued=true;queueMicrotask(()=>{combinedRefreshQueued=false;refreshCombinedNavigation()})}
  function normalizedExternalFormMatch(anchor,index=0){
    const pageNumber=Math.max(1,Number(anchor?.pageNumber)||1),rect=normalizedPdfRect(anchor?.rect),fieldKey=String(anchor?.fieldKey||'').trim();if(!rect||!fieldKey)return null;
    const start=Math.max(0,Number(anchor?.start)||0),end=Math.max(start,Number(anchor?.end)||start),value=String(anchor?.value||''),snippet=anchor?.snippet&&typeof anchor.snippet==='object'?anchor.snippet:(value?buildTextMatchSnippet(value,{start,end}):null);
    return {kind:'form',pageNumber,pageIdx:pageNumber-1,annotationIndex:Math.max(0,Number(anchor?.annotationIndex)||index),fieldKey,fieldName:String(anchor?.fieldName||''),fieldType:String(anchor?.fieldType||''),rect,start,end,snippet,value};
  }
  function mergeFormMatch(target,match,{preferIncoming=false}={}){
    let fields=target.get(match.pageNumber);if(!fields){fields=new Map();target.set(match.pageNumber,fields)}
    const rows=fields.get(match.fieldKey)||[],index=rows.findIndex(row=>Number(row.start)===Number(match.start)&&Number(row.end)===Number(match.end));
    if(index<0)rows.push(match);else if(preferIncoming)rows[index]=match;fields.set(match.fieldKey,rows);return index<0||preferIncoming;
  }
  async function applyExternalFormMatchInfo(info){
    if(destroyed||!interactiveForms||!hasFindQuery||info?.formAnchorsAuthoritative!==true||!Array.isArray(info?.formAnchors))return false;
    const matches=info.formAnchors.map((raw,index)=>normalizedExternalFormMatch(raw,index)).filter(Boolean);
    // An empty authoritative payload must never erase/cancel the viewer's own
    // annotation scan. Everything can know that text matched even when the
    // Bridge has no geometry for that particular PDF revision.
    if(!matches.length)return false;
    externalFormMatchesApplied=true;for(const match of matches)mergeFormMatch(formMatchesByPage,match,{preferIncoming:true});
    formSearchCapped=formSearchCapped||!!info.formAnchorsCapped;formSearchReady=true;await refreshRenderedFormLayers();refreshCombinedNavigation({navigateInitial:true});scheduleCombinedRefresh();return true;
  }
  async function collectFormSearchMatches(){if(!interactiveForms||!hasFindQuery||!pdfDocument){formSearchReady=true;refreshCombinedNavigation({navigateInitial:true});scheduleCombinedRefresh();return}const scanned=await collectPdfFormSearchMatches(pdfDocument,needle,search,PDF_FORM_MATCH_LIMIT,{isCancelled:()=>destroyed});if(destroyed)return;if(!externalFormMatchesApplied)formMatchesByPage.clear();for(const fields of scanned.matchesByPage.values())for(const matches of fields.values())for(const match of matches)mergeFormMatch(formMatchesByPage,match);formSearchCapped=formSearchCapped||scanned.capped;formSearchReady=true;await refreshRenderedFormLayers();refreshCombinedNavigation({navigateInitial:true});scheduleCombinedRefresh()}
  try{
    loadingTask=pdfjsLib.getDocument(await documentRuntimeOptions({url,blob,data}));
    pdfDocument=await loadingTask.promise;
    if(destroyed){await pdfDocument.destroy?.();throw new Error('PDF preview was closed before loading finished.')}
    pdfViewer.setDocument(pdfDocument);linkService.setDocument(pdfDocument,null);void collectFormSearchMatches();
  }catch(error){host.innerHTML='';throw error}
  return {
    next(){if(combinedReady&&combinedMatches.length)return goCombined(combinedIndex+1);dispatch('again',false)},
    previous(){if(combinedReady&&combinedMatches.length)return goCombined(combinedIndex-1);dispatch('again',true)},
    resize(options={}){scheduleResize(options);if(combinedReady&&currentFormEntry())queueMicrotask(()=>scrollCurrentFormMatch(currentFormEntry(),{behavior:'auto'}))},
    matchState(){return combinedReady&&combinedMatches.length?combinedState():{...lastState}},
    setExternalMatchInfo(info){return applyExternalFormMatchInfo(info)},
    async destroy(){
      if(destroyed)return;destroyed=true;removeCopyHandler();copyFieldGeneration.clear();formMatchesByPage.clear();cancelScheduledResize();resizeObserver?.disconnect?.();resizeObserver=null;
      try{pdfViewer.setDocument(null)}catch{}
      try{linkService.setDocument(null,null)}catch{}
      try{await loadingTask?.destroy?.()}catch{}
      try{await pdfDocument?.destroy?.()}catch{}
    },
  };
}
