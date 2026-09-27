import {createSearchFragmentIndex} from '../shared/search-fragments.js';
import {esc} from '../core/values.js';
import {money} from '../core/money.js';
import {buildOrderSearchFragment,ORDER_SEARCH_FRAGMENTS,searchGlobalEntries} from '../domains/search/model.js';
import {checkIsClosedStatus} from '../domains/checks/model.js';
import {customerDebtProgressData} from '../shared/customer-debt-progress.js';
import {createSearchScheduler} from '../shared/search-scheduler.js';
import {createPdfSearchViewer,preloadPdfSearchRuntime} from '../domains/documents/pdf-search-viewer.js';
import {buildPdfPreviewSrc} from '../domains/documents/pdf-text-fragments.js';
import {createTextSearchViewer} from '../domains/documents/text-search-viewer.js';
import {createDocxSearchViewer,preloadDocxSearchRuntime} from '../domains/documents/docx-search-viewer.js';
import {createSpreadsheetSearchViewer} from '../domains/documents/spreadsheet-search-viewer.js';

const DOCUMENT_SEARCH_DELAY_MS=200;
const RECENT_DOCUMENT_LIMIT=40;
const RECENT_DOCUMENT_TTL_MS=15000;
const DOCUMENT_BRIDGE_WARM_TTL_MS=25000;
const DOCUMENT_PREVIEW_WIDTH_KEY='netunim_orders_document_preview_width_v1';
const DOCUMENT_PREVIEW_DEFAULT=58;
const DOCUMENT_PREVIEW_MIN=32;
const DOCUMENT_PREVIEW_MAX=72;
const SEARCH_FILTERS=new Set(['all','site','files','content']);

// Global search owns one query and one result surface. Site, file-name and file-content
// sources are searched independently, then composed in a deterministic source order.
export function createUiGlobalSearch({documentBridge=null,searchRevision,model,ui,notesUi={},supplierUi,customerUi,serviceUi,warehouseUi,prepareView,render,openInventoryItemModal}){
  let resultByKey=new Map(),documentResultByKey=new Map(),highlightTimer=null,backdropPointerId=null,filter='all',documentSequence=0,documentAbort=null,activeQuery='',selectedDocumentId='',selectedDocumentKey='',selectedDocumentMode='everything',previewSequence=0,previewObjectUrl='',previewAbort=null,previewMatchesAbort=null,previewMatchInfo=null,previewSearchViewer=null,previewSearchState={current:0,total:0},nativePreviewActive=false,nativePreviewWantedId='',nativePreviewGeometryKey='',nativePreviewPoll=null,documentWarmPromise=null,documentWarmAt=0;
  let documentStates={everything:emptyDocumentState('everything'),content:emptyDocumentState('content')},recentDocumentState=emptyRecentDocumentState();
  const byId=id=>document.getElementById(id);
  const refs=()=>({trigger:byId('globalSearchButton'),backdrop:byId('globalSearchBackdrop'),dialog:byId('globalSearchBackdrop')?.querySelector('.global-search-dialog'),workspace:byId('globalSearchWorkspace'),input:byId('globalSearchInput'),results:byId('globalSearchResults'),meta:byId('globalSearchMeta'),close:byId('globalSearchClose'),filterAll:byId('globalSearchFilterAll'),filterSite:byId('globalSearchFilterSite'),filterFiles:byId('globalSearchFilterFiles'),filterContent:byId('globalSearchFilterContent'),preview:byId('globalSearchDocumentPreview'),previewBody:byId('globalSearchPreviewBody'),previewMatches:byId('globalSearchPreviewMatches'),splitter:byId('globalSearchDocumentSplitter')});
  const scheduledDocumentRender=createSearchScheduler(value=>runDocumentSearch(value),{delay:DOCUMENT_SEARCH_DELAY_MS});
  const indexedEntries=createSearchFragmentIndex({fragments:Object.keys(ORDER_SEARCH_FRAGMENTS),revision:name=>name==='notes'&&model.state.notesSheet?null:searchRevision?.(ORDER_SEARCH_FRAGMENTS[name],name),build:name=>buildOrderSearchFragment(model.state,name)});

  function emptyDocumentState(mode){return{mode,status:'idle',rows:[],error:null,elapsedMs:0}}
  function emptyRecentDocumentState(){return{status:'idle',rows:[],error:null,elapsedMs:0,loadedAt:0}}
  function warmDocumentSearchBridge(){if(!documentBridge?.warm||!documentBridge.getToken?.())return null;const now=Date.now();if(documentWarmPromise)return documentWarmPromise;if(now-documentWarmAt<DOCUMENT_BRIDGE_WARM_TTL_MS)return null;documentWarmAt=now;documentWarmPromise=Promise.resolve(documentBridge.warm()).catch(()=>null).finally(()=>{documentWarmPromise=null});return documentWarmPromise}
  function isGoogleDriveSource(){return documentBridge?.provider==='google-drive'}
  function documentProviderLabel(){return String(documentBridge?.providerLabel||(isGoogleDriveSource()?'Google Drive':'Everything'))}
  function documentAuthError(error){const code=String(error?.code||'');return ['DOCUMENT_BRIDGE_NOT_PAIRED','UNAUTHORIZED','google_drive_not_connected','google_drive_reconnect_required','google_drive_auth_required'].includes(code)}
  function sourceLabel(mode){const base=mode==='content'?'חיפוש תוכן':'חיפוש קבצים';return `${base} · ${documentProviderLabel()}`}
  function includesSite(){return filter==='all'||filter==='site'}
  function includesDocumentMode(mode){return filter==='all'||(filter==='files'&&mode==='everything')||(filter==='content'&&mode==='content')}
  function requestedDocumentModes(){return ['everything','content'].filter(includesDocumentMode)}
  function includesRecentDocuments(){return filter==='all'||filter==='files'}
  function scopeIntro(){const source=isGoogleDriveSource()?'Google Drive':'המחשב הזה';return `<div class="global-search-empty"><div class="global-search-empty-icon">⌕</div><b>חיפוש אחד בכל המאגרים</b><p>הקלדה כאן מחפשת באתר, בשמות קבצים ובתוכן קבצים דרך ${esc(source)}. אפשר לצמצם את התוצאות בעזרת המסננים למעלה.</p><div class="global-search-scopes"><span>האתר</span><span>קבצים</span><span>תוכן קבצים</span></div></div>`}
  function documentPairing({compact=false}={}){if(isGoogleDriveSource()){if(compact)return `<div class="document-search-compact-note">חיפוש התוכן יהיה זמין לאחר חיבור Google Drive.</div>`;return `<div class="global-search-empty document-search-setup"><div class="global-search-empty-icon">⌕</div><b>חיפוש ופתיחת מסמכים ב-Google Drive</b><p>באנדרואיד החיפוש משתמש ישירות באינדקס של Google Drive במקום ב-Document Bridge המקומי של Windows.</p><div class="document-search-pair"><button type="button" data-document-connect>חבר Google Drive</button></div><small>לאחר החיבור אפשר לחפש, לבחור תוצאה ולפתוח את הקובץ או התיקייה ב-Google Drive. Refresh Token נשמר רק ב-Supabase.</small></div>`}if(compact)return `<div class="document-search-compact-note">חיפוש התוכן יהיה זמין לאחר חיבור Document Bridge במחשב זה.</div>`;return `<div class="global-search-empty document-search-setup"><div class="global-search-empty-icon">⌕</div><b>חיפוש מסמכים במחשב זה</b><p>Document Bridge עדיין לא משויך לדפדפן הזה. מתקינים אותו בנפרד בכל מחשב; המפתח שהמתקין מעתיק ללוח נשמר רק בדפדפן המקומי.</p><div class="document-search-pair"><input id="globalSearchDocumentToken" type="password" autocomplete="off" spellcheck="false" placeholder="הדבק מפתח Document Bridge"><button type="button" data-document-pair>חבר מחשב</button></div><small>הקבצים ותוכן החיפוש נשארים במחשב ואינם מועלים לאתר או לענן.</small></div>`}
  function documentIntro(mode){const content=mode==='content';if(isGoogleDriveSource())return `<div class="global-search-empty document-search-intro"><div class="global-search-empty-icon">FILE</div><b>${content?'חיפוש תוכן ב-Google Drive':'חיפוש קבצים ב-Google Drive'}</b><p>${content?'הקלד לפחות שני תווים. Google Drive מחפש מילות אינדקס בתוך שם, מטא-דאטה ותוכן שהוא יודע לאנדקס.':'חיפוש שמות קבצים ותיקיות מתבצע דרך Google Drive API.'}</p></div>`;return `<div class="global-search-empty document-search-intro"><div class="global-search-empty-icon">FILE</div><b>${content?'חיפוש תוכן':'חיפוש קבצים'}</b><p>${content?'הקלד לפחות שני תווים כדי לחפש מילים בתוך תוכן הקבצים דרך Everything.':'חיפוש קבצים ותיקיות דרך אותו אינדקס ותחביר של Everything.'}</p></div>`}

  function resultMeta(item){const parts=[...(item.meta||[])];if(item.amount!==undefined&&item.amount!==null&&Number.isFinite(Number(item.amount)))parts.unshift(money(item.amount));return parts.filter(Boolean)}
  function bytes(value){const size=Number(value);if(!Number.isFinite(size)||size<0)return '';if(size<1024)return `${size} B`;if(size<1024*1024)return `${Math.round(size/1024)} KB`;return `${(size/1024/1024).toFixed(size<10*1024*1024?1:0)} MB`}
  function localDate(value){const time=Date.parse(value||'');if(!Number.isFinite(time))return '';try{return new Intl.DateTimeFormat('he-IL',{dateStyle:'short',timeStyle:'short'}).format(new Date(time))}catch{return ''}}
  function safeCloudViewUrl(value){try{const url=new URL(String(value||''));const host=url.hostname.toLowerCase();return url.protocol==='https:'&&(host==='google.com'||host.endsWith('.google.com'))?url.toString():''}catch{return ''}}
  function destroySearchPreviewViewer(){const viewer=previewSearchViewer;previewSearchViewer=null;previewSearchState={current:0,total:0};viewer?.destroy?.().catch?.(()=>{})}
  function cleanupPreviewObject(){destroySearchPreviewViewer();if(previewObjectUrl){URL.revokeObjectURL(previewObjectUrl);previewObjectUrl=''}}
  function nativePreviewGeometry(){
    const {previewBody}=refs();if(!previewBody||previewBody.hidden)return null;const rect=previewBody.getBoundingClientRect();if(rect.width<80||rect.height<80)return null;
    const scale=Math.max(.5,Math.min(5,Number(window.devicePixelRatio)||1));
    const sideInset=Math.max(0,(Number(window.outerWidth)||0)-(Number(window.innerWidth)||0))/2;
    const topInset=Math.max(0,(Number(window.outerHeight)||0)-(Number(window.innerHeight)||0)-sideInset);
    const physical=value=>Math.round(Number(value||0)*scale);
    return {x:physical((Number(window.screenX)||0)+sideInset+rect.left),y:physical((Number(window.screenY)||0)+topInset+rect.top),width:Math.max(1,physical(rect.width)),height:Math.max(1,physical(rect.height)),scale};
  }
  function nativeGeometryKey(value){return value?`${value.x}:${value.y}:${value.width}:${value.height}`:''}
  function stopNativePreviewPolling(){if(nativePreviewPoll){clearInterval(nativePreviewPoll);nativePreviewPoll=null}}
  function deactivateNativePreview({forget=true}={}){nativePreviewActive=false;nativePreviewGeometryKey='';stopNativePreviewPolling();if(forget)nativePreviewWantedId='';documentBridge?.hideNativePreview?.().catch(()=>{})}
  async function syncNativePreviewGeometry({force=false}={}){if(!nativePreviewActive||!documentBridge?.moveNativePreview)return;const geometry=nativePreviewGeometry();if(!geometry)return;const key=nativeGeometryKey(geometry);if(!force&&key===nativePreviewGeometryKey)return;nativePreviewGeometryKey=key;try{await documentBridge.moveNativePreview(geometry)}catch{}}
  function startNativePreviewPolling(){stopNativePreviewPolling();nativePreviewPoll=setInterval(()=>{syncNativePreviewGeometry()},350)}
  async function showNativePreview(id,sequence){if(!documentBridge?.nativePreview)return false;const geometry=nativePreviewGeometry();if(!geometry)throw new Error('אזור התצוגה המקדימה אינו זמין.');nativePreviewWantedId=String(id);await documentBridge.nativePreview(id,geometry);if(sequence!==previewSequence||selectedDocumentId!==String(id)){documentBridge.hideNativePreview?.().catch(()=>{});return false}nativePreviewActive=true;nativePreviewGeometryKey=nativeGeometryKey(geometry);startNativePreviewPolling();return true}
  function resetDocumentPreview(){
    previewSequence+=1;previewAbort?.abort();previewAbort=null;previewMatchesAbort?.abort();previewMatchesAbort=null;previewMatchInfo=null;cleanupPreviewObject();deactivateNativePreview();selectedDocumentId='';selectedDocumentKey='';selectedDocumentMode='everything';
    const {previewBody,previewMatches}=refs();if(previewMatches){previewMatches.hidden=true;previewMatches.innerHTML=''}if(previewBody){const text=isGoogleDriveSource()?'לחיצה אחת מציגה פרטים וכפתור פתיחה ב-Google Drive.':'לחיצה אחת על תוצאת קובץ תציג אותה כאן. לחיצה כפולה תפתח אותה במחשב.';previewBody.innerHTML=`<div class="document-preview-empty"><span>⌕</span><b>תצוגה מקדימה</b><p>${esc(text)}</p></div>`}
  }
  function fileKindLabel(item){if(item?.isDirectory)return 'תיקייה';const ext=String(item?.extension||'').toUpperCase();return ext||'קובץ'}
  function documentIconKind(item){
    if(item?.isDirectory)return 'folder';const ext=String(item?.extension||'').toLowerCase();
    if(ext==='pdf')return 'pdf';if(['doc','docx','docm','dot','dotx','rtf'].includes(ext))return 'word';if(['xls','xlsx','xlsm','xlsb','csv'].includes(ext))return 'excel';if(['ppt','pptx','pptm','pps','ppsx'].includes(ext))return 'powerpoint';if(['txt','md','log','ini','json','xml','html','htm','css','js','mjs','ts','csv'].includes(ext))return 'text';if(['jpg','jpeg','png','gif','bmp','webp','svg','tif','tiff'].includes(ext))return 'image';if(['zip','7z','rar','tar','gz'].includes(ext))return 'archive';return 'file';
  }
  function renderDocumentTable(rows,mode,{label=sourceLabel(mode),hint=isGoogleDriveSource()?'לחיצה אחת לפרטים ולפתיחה ב-Google Drive':'לחיצה אחת לתצוגה · לחיצה כפולה לפתיחה'}={}){
    const header='<div class="document-results-head" aria-hidden="true"><span>שם</span><span>נתיב</span><span>גודל</span><span>עודכן</span></div>';
    const title=isGoogleDriveSource()?'לחיצה: פרטים וכפתור פתיחה ב-Google Drive':'לחיצה: תצוגה מקדימה · לחיצה כפולה: פתיחה במחשב';
    const body=rows.map(item=>{const icon=documentIconKind(item),key=`${mode}:${item.id}`;documentResultByKey.set(key,item);const selected=selectedDocumentKey===key?' selected':'';return `<button class="global-search-result document-search-row${selected}" type="button" data-document-result-id="${esc(item.id)}" data-document-result-key="${esc(key)}" data-document-search-mode="${esc(mode)}" title="${esc(title)}"><span class="document-result-name"><i class="document-result-icon ${esc(icon)}" aria-hidden="true"></i><span><b>${esc(item.name||(item.isDirectory?'תיקייה':'קובץ'))}</b><small>${esc(fileKindLabel(item))}</small></span></span><span class="document-result-path">${esc(item.relativePath||'')}</span><span class="document-result-size">${item.isDirectory?'—':esc(bytes(item.size)||'—')}</span><span class="document-result-date">${esc(localDate(item.modified)||'—')}</span></button>`}).join('');
    return `<section class="document-results-table"><div class="document-results-summary"><b>${esc(label)}</b><span>${esc(rows.length)}</span><small>${esc(hint)}</small></div>${header}<div class="document-results-body">${body}</div></section>`;
  }
  function clampPreviewWidth(value){const n=Number(value);return Math.max(DOCUMENT_PREVIEW_MIN,Math.min(DOCUMENT_PREVIEW_MAX,Number.isFinite(n)?n:DOCUMENT_PREVIEW_DEFAULT))}
  function savedPreviewWidth(){try{const value=localStorage.getItem(DOCUMENT_PREVIEW_WIDTH_KEY);return value===null?DOCUMENT_PREVIEW_DEFAULT:clampPreviewWidth(value)}catch{return DOCUMENT_PREVIEW_DEFAULT}}
  function applyPreviewWidth(value,{save=false}={}){const width=clampPreviewWidth(value),{workspace,splitter}=refs();workspace?.style.setProperty('--document-preview-width',`${width}%`);splitter?.setAttribute('aria-valuenow',String(Math.round(width)));if(save)try{localStorage.setItem(DOCUMENT_PREVIEW_WIDTH_KEY,String(width))}catch{}previewSearchViewer?.resize?.({immediate:save});if(nativePreviewActive)queueMicrotask(()=>syncNativePreviewGeometry({force:true}));return width}
  function setPreviewLayout(visible){const {workspace,preview,splitter}=refs();if(preview)preview.hidden=!visible;if(splitter)splitter.hidden=!visible;workspace?.classList.toggle('preview-active',visible);if(visible)applyPreviewWidth(savedPreviewWidth());else if(nativePreviewActive)deactivateNativePreview({forget:false})}
  function previewDetailsHtml(data){const rows=[[data.isDirectory?'סוג':'סיומת',data.isDirectory?'תיקייה':(String(data.extension||'').toUpperCase()||'קובץ')],['גודל',data.isDirectory?'—':bytes(data.size)],['עודכן',localDate(data.modified)],['נתיב',data.fullPath]].filter(([,value])=>value);return `<dl class="document-preview-details">${rows.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>`}
  function previewContentQuery(){return selectedDocumentMode==='content'?String(refs().input?.value||'').trim():''}
  function previewTextLabel(data){return data.source==='office-text-fallback'?'טקסט שחולץ ממסמך Office':data.source==='everything-content'?'טקסט שחולץ על־ידי Everything':'קובץ טקסט'}
  function compactContext(value,{tail=false,limit=42}={}){const clean=String(value||'').replace(/\s+/g,' ').trim();if(clean.length<=limit)return clean;return tail?`…${clean.slice(-limit).replace(/^\S*\s?/,'')||clean.slice(-limit)}`:`${clean.slice(0,limit).replace(/\s?\S*$/,'')||clean.slice(0,limit)}…`}
  function snippetHtml(snippet){if(!snippet)return '';const before=compactContext(snippet.before,{tail:true,limit:34}),after=compactContext(snippet.after,{limit:42});return `<span class="document-preview-match-before">${snippet.leading&&!before.startsWith('…')?'…':''}${esc(before)}</span><mark class="document-preview-match-term">${esc(snippet.match||previewContentQuery())}</mark><span class="document-preview-match-after">${esc(after)}${snippet.trailing&&!after.endsWith('…')?'…':''}</span>`}
  function showPreviewMatch(index=0,{viewerState=null}={}){
    const {previewMatches}=refs(),info=previewMatchInfo;if(!previewMatches||!info?.active)return;
    const state=viewerState||previewSearchState||{},externalCurrent=Math.max(0,Number(state.current)||0),externalTotal=Math.max(0,Number(state.total)||0),snippets=Array.isArray(info.snippets)?info.snippets:[];
    const requestedIndex=externalCurrent?externalCurrent-1:Number(index)||0,safeIndex=snippets.length?Math.max(0,Math.min(snippets.length-1,requestedIndex)):0,snippet=state.snippet||snippets[safeIndex]||null;
    const visibleTotal=externalTotal||Number(info.count)||snippets.length;if(!visibleTotal){previewMatches.hidden=false;previewMatches.innerHTML='<div class="document-preview-match-loading muted">לא נמצאו התאמות ניתנות להצגה במסמך.</div>';return}
    previewMatches.dataset.matchIndex=String(safeIndex);const countLabel=state.capped||info.capped?`${visibleTotal}+`:String(visibleTotal),position=`${externalCurrent||safeIndex+1}/${visibleTotal}`,location=state.location?`<span class="document-preview-match-location">${esc(state.location)}</span>`:'';
    previewMatches.hidden=false;previewMatches.innerHTML=`<div class="document-preview-match-summary"><b>${esc(countLabel)} התאמות</b>${location}${info.truncated?'<span>בתצוגה החלקית</span>':''}</div><div class="document-preview-match-context">${snippet?snippetHtml(snippet):'<span class="document-preview-match-empty">הקובץ תאם לחיפוש, אך לא ניתן להפיק קטע הקשר.</span>'}</div>${visibleTotal>1?`<div class="document-preview-match-nav"><button type="button" data-preview-match-prev aria-label="התאמה קודמת">‹</button><span>${esc(position)}</span><button type="button" data-preview-match-next aria-label="התאמה הבאה">›</button></div>`:''}`;
    if(nativePreviewActive)queueMicrotask(()=>syncNativePreviewGeometry({force:true}));
  }
  function onPreviewSearchMatchState(state){
    previewSearchState={current:Math.max(0,Number(state?.current)||0),total:Math.max(0,Number(state?.total)||0),snippet:state?.snippet||null,capped:!!state?.capped,location:String(state?.location||'')};
    if(previewSearchState.total&&previewSearchState.snippet){previewMatchInfo={active:true,query:previewContentQuery(),count:previewSearchState.total,capped:previewSearchState.capped,snippets:[previewSearchState.snippet],viewerDriven:true};showPreviewMatch(0,{viewerState:previewSearchState});return}
    if(previewMatchInfo?.count)showPreviewMatch(Math.max(0,previewSearchState.current-1),{viewerState:previewSearchState});
  }
  async function loadPreviewMatches(id,sequence){const {previewMatches}=refs(),query=previewContentQuery();previewMatchInfo=null;if(!previewMatches)return;if(selectedDocumentMode!=='content'||query.length<2||!documentBridge?.matches){previewMatches.hidden=true;previewMatches.innerHTML='';return}previewMatches.hidden=false;previewMatches.innerHTML='<div class="document-preview-match-loading">מאתר את ההתאמות בקובץ הנבחר…</div>';previewMatchesAbort?.abort();previewMatchesAbort=new AbortController();try{const info=await documentBridge.matches(id,{signal:previewMatchesAbort.signal});if(sequence!==previewSequence||selectedDocumentId!==String(id))return;previewMatchInfo=info;if(info?.count)showPreviewMatch(previewSearchState.current?previewSearchState.current-1:0,{viewerState:previewSearchState.total?previewSearchState:null});else{previewMatches.hidden=false;previewMatches.innerHTML='<div class="document-preview-match-loading muted">הקובץ תאם לחיפוש, אך לא ניתן למקם את הטקסט בתצוגה המקדימה.</div>'}if(nativePreviewActive)queueMicrotask(()=>syncNativePreviewGeometry({force:true}))}catch(error){if(sequence!==previewSequence||error?.code==='DOCUMENT_BRIDGE_ABORTED')return;previewMatches.hidden=true;previewMatches.innerHTML=''}}

  async function selectDocumentResult(id,button,mode=button?.dataset.documentSearchMode||'everything'){
    if(!documentBridge||!id)return;deactivateNativePreview();selectedDocumentId=String(id);selectedDocumentMode=mode==='content'?'content':'everything';selectedDocumentKey=button?.dataset.documentResultKey||`${selectedDocumentMode}:${id}`;for(const row of refs().results?.querySelectorAll?.('[data-document-result-key]')||[])row.classList.toggle('selected',row===button);const item=documentResultByKey.get(selectedDocumentKey);const {previewBody,previewMatches}=refs();cleanupPreviewObject();previewSequence+=1;const sequence=previewSequence;previewAbort?.abort();previewAbort=new AbortController();previewMatchesAbort?.abort();previewMatchesAbort=null;previewMatchInfo=null;if(previewMatches){previewMatches.hidden=true;previewMatches.innerHTML=''}if(previewBody)previewBody.innerHTML='<div class="document-preview-loading"><span></span><b>טוען תצוגה מקדימה…</b></div>';
    const contentQuery=previewContentQuery(),extension=String(item?.extension||'').toLowerCase();
    const preparePdfRuntime=selectedDocumentMode==='content'&&extension==='pdf'&&contentQuery.length>=2?preloadPdfSearchRuntime().then(runtime=>({runtime}),error=>({error})):null;
    const prepareDocxRuntime=selectedDocumentMode==='content'&&['docx','docm','dotx','dotm'].includes(extension)&&contentQuery.length>=2?preloadDocxSearchRuntime().then(()=>({ok:true}),error=>({error})):null;
    const startPreviewMatches=()=>loadPreviewMatches(id,sequence).catch(()=>{});
    const attachViewer=viewer=>{if(sequence!==previewSequence||selectedDocumentId!==String(id)){viewer?.destroy?.().catch?.(()=>{});return false}previewSearchViewer=viewer;const state=viewer?.matchState?.();if(state?.total)onPreviewSearchMatchState(state);return true};
    try{
      const data=await documentBridge.preview(id);if(sequence!==previewSequence||selectedDocumentId!==String(id))return;
      if(data.kind==='cloud'){if(previewMatches){previewMatches.hidden=true;previewMatches.innerHTML=''}const url=safeCloudViewUrl(data.webViewLink||item?.webViewLink),name=data.name||item?.name||(data.isDirectory?'תיקייה':'קובץ'),action=data.isDirectory?'פתח את התיקייה ב-Google Drive':'פתח את הקובץ ב-Google Drive';previewBody.innerHTML=`<div class="document-preview-cloud"><span>DRIVE</span><b>${esc(name)}</b><p>${data.isDirectory?'התיקייה נמצאת ב-Google Drive.':'הקובץ נמצא ב-Google Drive וייפתח במציג או בעורך המתאים של Google.'}</p>${url?`<a class="document-preview-open" data-document-open-link href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(action)}</a>`:'<div class="document-preview-open-error">Google Drive לא החזיר קישור צפייה תקין.</div>'}${previewDetailsHtml(data)}</div>`;return}
      if(data.kind==='folder'){if(previewMatches){previewMatches.hidden=true;previewMatches.innerHTML=''}previewBody.innerHTML=`<div class="document-preview-folder"><div class="document-preview-folder-icon"></div><b>${esc(data.name||item?.name||'תיקייה')}</b><p>לחיצה כפולה על התוצאה תפתח את התיקייה בסייר הקבצים.</p>${previewDetailsHtml(data)}</div>`;return}
      if(data.kind==='native'){startPreviewMatches();previewBody.innerHTML='<div class="document-preview-native"><span>OFFICE</span><b>Windows Preview</b><p>נטענת התצוגה המקורית שמותקנת ב-Windows…</p></div>';await showNativePreview(id,sequence);return}
      if(data.kind==='structured'){
        const blob=await documentBridge.previewFile(id,{signal:previewAbort.signal});if(sequence!==previewSequence||selectedDocumentId!==String(id))return;
        previewBody.innerHTML=`<div class="document-preview-loading"><span></span><b>${data.documentKind==='word'?'מכין מסמך Word עם כל ההתאמות…':'קורא את חוברת Excel ומאתר התאמות…'}</b></div>`;
        try{
          let viewer;if(data.documentKind==='word'){const prepared=prepareDocxRuntime?await prepareDocxRuntime:null;if(prepared?.error)throw prepared.error;viewer=await createDocxSearchViewer({host:previewBody,blob,query:contentQuery,onMatchState:state=>{if(sequence===previewSequence&&selectedDocumentId===String(id))onPreviewSearchMatchState(state)}})}else viewer=await createSpreadsheetSearchViewer({host:previewBody,blob,query:contentQuery,onMatchState:state=>{if(sequence===previewSequence&&selectedDocumentId===String(id))onPreviewSearchMatchState(state)}});
          if(!attachViewer(viewer))return;if(!viewer.matchState?.().total&&previewMatches){previewMatchInfo={active:true,query:contentQuery,count:0,snippets:[]};showPreviewMatch(0,{viewerState:viewer.matchState?.()})}return;
        }catch(error){if(sequence!==previewSequence)return;previewBody.innerHTML=`<div class="document-preview-empty error"><span>!</span><b>מציג המסמך המקומי לא נטען</b><p>${esc(error?.message||'חבילת התצוגה המקומית אינה מותקנת.')}<br>הרץ npm run document-viewers:install ולאחר מכן רענן את האתר.</p></div>`;if(previewMatches){previewMatches.hidden=false;previewMatches.innerHTML='<div class="document-preview-match-loading muted">התוצאה קיימת באינדקס Everything, אך המציג המקומי אינו זמין.</div>'}return}
      }
      if(data.kind==='binary'){const blob=await documentBridge.previewFile(id,{signal:previewAbort.signal});if(sequence!==previewSequence||selectedDocumentId!==String(id))return;previewObjectUrl=URL.createObjectURL(blob);const query=contentQuery;if(data.mime==='application/pdf'&&selectedDocumentMode==='content'&&query.length>=2){previewBody.innerHTML='<div class="document-preview-loading"><span></span><b>מכין PDF עם כל ההתאמות…</b></div>';try{const prepared=preparePdfRuntime?await preparePdfRuntime:null;if(prepared?.error)throw prepared.error;const viewer=await createPdfSearchViewer({host:previewBody,url:previewObjectUrl,query,runtime:prepared?.runtime||null,onMatchState:state=>{if(sequence===previewSequence&&selectedDocumentId===String(id))onPreviewSearchMatchState(state)}});if(!attachViewer(viewer))return;startPreviewMatches()}catch(error){if(sequence!==previewSequence)return;previewBody.innerHTML=`<div class="document-preview-pdf"><iframe class="document-preview-frame" src="${esc(buildPdfPreviewSrc(previewObjectUrl,{query}))}" title="${esc(data.name||'PDF')}"></iframe></div>`;startPreviewMatches();if(previewMatches){previewMatches.hidden=false;previewMatches.innerHTML=`<div class="document-preview-match-loading muted">הניווט המדויק בתוך PDF לא נטען · ${esc(error?.message||'PDF.js לא זמין')}</div>`}}return}startPreviewMatches();previewBody.innerHTML=data.mime==='application/pdf'?`<div class="document-preview-pdf"><iframe class="document-preview-frame" src="${esc(`${previewObjectUrl}#toolbar=0&navpanes=0&view=FitH`)}" title="${esc(data.name||'PDF')}"></iframe></div>`:`<div class="document-preview-image"><img src="${esc(previewObjectUrl)}" alt="${esc(data.name||'תמונה')}"></div>`;return}
      if(data.kind==='text'){
        if(selectedDocumentMode==='content'&&contentQuery.length>=2){const viewer=await createTextSearchViewer({host:previewBody,text:data.text||'',query:contentQuery,label:previewTextLabel(data),truncated:!!data.truncated,onMatchState:state=>{if(sequence===previewSequence&&selectedDocumentId===String(id))onPreviewSearchMatchState(state)}});attachViewer(viewer);return}
        const viewer=await createTextSearchViewer({host:previewBody,text:data.text||'',query:'',label:previewTextLabel(data),truncated:!!data.truncated});attachViewer(viewer);return;
      }
      previewBody.innerHTML=`<div class="document-preview-empty"><span>FILE</span><b>אין תצוגה מקדימה זמינה</b><p>אפשר לפתוח את הקובץ בתוכנה המותקנת במחשב בלחיצה כפולה על התוצאה.</p>${previewDetailsHtml(data)}</div>`;
    }catch(error){if(sequence!==previewSequence||error?.code==='DOCUMENT_BRIDGE_ABORTED')return;if(previewBody)previewBody.innerHTML=`<div class="document-preview-empty error"><span>!</span><b>התצוגה המקדימה נכשלה</b><p>${esc(error?.message||'לא ניתן להציג את הקובץ.')}</p></div>`}
  }


  function sourceHeader(label,count,{loading=false}={}){return `<header class="global-search-source-head"><b>${esc(label)}</b>${loading?'<span class="global-search-source-loading">מחפש…</span>':`<span>${esc(count)}</span>`}</header>`}
  function renderSiteSource(raw){
    const data=searchGlobalEntries(indexedEntries(),raw),visibleGroups=data.groups.filter(group=>group.total>0);
    const groups=visibleGroups.map(group=>{const rows=group.items.map((item,index)=>{const key=`${group.key}:${item.kind}:${item.id}:${index}`;resultByKey.set(key,item);const metaParts=resultMeta(item);return `<button class="global-search-result" type="button" data-global-result-key="${esc(key)}"><span class="global-search-result-main"><span class="global-search-result-kicker">${esc(item.context||group.label)} · ${esc(item.badge||group.label)}</span><b>${esc(item.title||'תוצאה')}</b>${item.subtitle?`<span class="global-search-result-subtitle">${esc(item.subtitle)}</span>`:''}</span>${metaParts.length?`<span class="global-search-result-meta">${metaParts.map(x=>`<em>${esc(x)}</em>`).join('')}</span>`:''}<span class="global-search-result-arrow" aria-hidden="true">←</span></button>`}).join('');const hidden=group.total-group.items.length;return `<section class="global-search-group"><header><b>${esc(group.label)}</b><span>${esc(group.total)}</span></header><div class="global-search-group-results">${rows}</div>${hidden>0?`<div class="global-search-more">יש עוד ${esc(hidden)} תוצאות בקבוצה — אפשר לצמצם את החיפוש.</div>`:''}</section>`}).join('');
    const body=groups||'<div class="global-search-source-empty">לא נמצאו תוצאות באתר.</div>';
    return {total:data.total,settledEmpty:data.total===0,html:`<section class="global-search-source-section" data-search-source="site">${sourceHeader('חיפוש באתר',data.total)}<div class="global-search-source-body">${body}</div></section>`};
  }
  function documentErrorHtml(error){const code=String(error?.code||'');if(documentAuthError(error))return documentPairing();const hint=isGoogleDriveSource()?'בדוק שהאתר מחובר לענן, ש-Google Drive API פעיל ושהרשאת Drive לא בוטלה.':code==='DOCUMENT_BRIDGE_UNAVAILABLE'?'ודא ש־Document Bridge מותקן ופועל במחשב זה.':code==='EVERYTHING_EXE_NOT_FOUND'?'ה־Bridge לא מצא את Everything.exe. התקן את Everything 1.5 באמצעות המתקין הרשמי.':'בדוק ש־Everything פועל ושהאינדקס שלו מחזיר את אותה שאילתה בחלון Everything.';return `<div class="global-search-empty document-search-error"><div class="global-search-empty-icon">!</div><b>חיפוש הקבצים אינו זמין</b><p>${esc(error?.message||'לא ניתן להשלים את חיפוש המסמכים.')}<br>${esc(hint)}</p></div>`}
  function renderDocumentSource(mode,raw){
    const state=documentStates[mode],label=sourceLabel(mode),count=state.rows.length,hasRows=state.status==='done'&&count>0;
    let body='';
    if(state.status==='loading')body=`<div class="global-search-source-progress"><span class="document-search-spinner">⌕</span>מחפש דרך ${esc(documentProviderLabel())}…</div>`;
    else if(state.status==='pairing')body=documentPairing({compact:filter==='all'&&mode==='content'});
    else if(state.status==='unavailable'||state.status==='error')body=documentErrorHtml(state.error||{message:'רכיב החיפוש המקומי אינו זמין.'});
    else if(state.status==='short')body=documentIntro(mode);
    else if(state.status==='done')body=hasRows?renderDocumentTable(state.rows,mode):`<div class="global-search-source-empty">לא נמצאו תוצאות ב־${label}.</div>`;
    else body=raw?'<div class="global-search-source-empty">החיפוש המקומי עדיין לא הופעל.</div>':documentIntro(mode);
    const header=hasRows?'':sourceHeader(label,count,{loading:state.status==='loading'});
    return {total:count,settledEmpty:state.status==='done'&&count===0,html:`<section class="global-search-source-section" data-search-source="${esc(mode)}">${header}<div class="global-search-source-body">${body}</div></section>`};
  }
  function updateMeta(siteTotal,documentTotal,loading){const {meta}=refs();if(!meta)return;const total=siteTotal+documentTotal;if(loading){meta.textContent=total?`${total} תוצאות עד כה · החיפוש במחשב ממשיך…`:'מחפש במחשב…';return}meta.textContent=total?`${total} תוצאות`:'לא נמצאו תוצאות'}
  function renderRecentDocuments(){
    const {results,meta}=refs();if(!results)return;resultByKey=new Map();documentResultByKey=new Map();
    if(!includesRecentDocuments()){setPreviewLayout(false);if(meta)meta.textContent='';results.innerHTML=filter==='content'?documentIntro('content'):scopeIntro();return}
    const state=recentDocumentState,rows=Array.isArray(state.rows)?state.rows:[];let body='';
    if(state.status==='loading')body=`<div class="global-search-source-progress"><span class="document-search-spinner">⌕</span>טוען קבצים אחרונים מ־${esc(documentProviderLabel())}…</div>`;
    else if(state.status==='pairing')body=documentPairing();
    else if(state.status==='unavailable'||state.status==='error')body=documentErrorHtml(state.error||{message:'רכיב החיפוש המקומי אינו זמין.'});
    else if(state.status==='done'&&rows.length)body=renderDocumentTable(rows,'everything',{label:'קבצים אחרונים',hint:isGoogleDriveSource()?'לפי תאריך שינוי · לחיצה לפרטים ולפתיחה ב-Google Drive':'לפי תאריך שינוי · לחיצה אחת לתצוגה · לחיצה כפולה לפתיחה'});
    else if(state.status==='done')body=`<div class="global-search-source-empty">לא נמצאו קבצים ב־${esc(documentProviderLabel())}.</div>`;
    else body='<div class="global-search-source-progress"><span class="document-search-spinner">⌕</span>טוען קבצים אחרונים…</div>';
    results.innerHTML=`<section class="global-search-source-section" data-search-source="recent"><div class="global-search-source-body">${body}</div></section>`;
    setPreviewLayout(rows.length>0);if(selectedDocumentKey&&!documentResultByKey.has(selectedDocumentKey))resetDocumentPreview();
    if(meta)meta.textContent=state.status==='loading'?'טוען קבצים אחרונים…':rows.length?`${rows.length} קבצים אחרונים`:state.status==='done'?'אין קבצים להצגה':'';
  }
  function renderCombinedResults(value=''){
    const {results}=refs();if(!results)return;const raw=String(value||'').trim();resultByKey=new Map();documentResultByKey=new Map();if(!raw){renderRecentDocuments();return}
    const sections=[];let siteTotal=0,documentTotal=0,loading=false;const hideEmptySources=filter==='all';
    if(includesSite()){const site=renderSiteSource(raw);siteTotal=site.total;if(!hideEmptySources||!site.settledEmpty)sections.push(site.html)}
    for(const mode of requestedDocumentModes()){const source=renderDocumentSource(mode,raw);documentTotal+=source.total;loading=loading||documentStates[mode].status==='loading';if(!hideEmptySources||!source.settledEmpty)sections.push(source.html)}
    results.innerHTML=sections.join('')||(loading?'<div class="global-search-source-progress"><span class="document-search-spinner">⌕</span>מחפש…</div>':'<div class="global-search-source-empty">לא נמצאו תוצאות.</div>');
    const hasDocumentRows=requestedDocumentModes().some(mode=>documentStates[mode].rows.length>0);setPreviewLayout(hasDocumentRows);
    if(selectedDocumentKey&&!documentResultByKey.has(selectedDocumentKey))resetDocumentPreview();
    updateMeta(siteTotal,documentTotal,loading);
  }
  function prepareDocumentStates(raw){
    documentStates={everything:emptyDocumentState('everything'),content:emptyDocumentState('content')};
    const modes=requestedDocumentModes();if(!modes.length||!raw)return false;
    if(!documentBridge){for(const mode of modes){documentStates[mode]={...emptyDocumentState(mode),status:'unavailable',error:{message:'רכיב חיפוש המסמכים אינו טעון.'}}}return false}
    if(!documentBridge.getToken?.()){for(const mode of modes)documentStates[mode]={...emptyDocumentState(mode),status:'pairing'};return false}
    for(const mode of modes){documentStates[mode]={...emptyDocumentState(mode),status:mode==='content'&&raw.length<2?'short':'loading'}}
    return modes.some(mode=>documentStates[mode].status==='loading');
  }
  function prepareRecentDocuments(){
    if(!includesRecentDocuments())return false;
    if(!documentBridge){recentDocumentState={...emptyRecentDocumentState(),status:'unavailable',error:{message:'רכיב חיפוש המסמכים אינו טעון.'}};return false}
    if(!documentBridge.getToken?.()){recentDocumentState={...emptyRecentDocumentState(),status:'pairing'};return false}
    if(recentDocumentState.status==='done'&&Date.now()-recentDocumentState.loadedAt<RECENT_DOCUMENT_TTL_MS)return false;
    recentDocumentState={...emptyRecentDocumentState(),status:'loading'};return true;
  }
  async function runRecentDocuments(sequence){
    if(!documentBridge?.recent||sequence!==documentSequence||activeQuery)return;const controller=new AbortController();documentAbort=controller;
    try{
      const data=await documentBridge.recent({limit:RECENT_DOCUMENT_LIMIT,signal:controller.signal});if(controller.signal.aborted||sequence!==documentSequence||activeQuery||!includesRecentDocuments())return;
      recentDocumentState={status:'done',rows:Array.isArray(data.results)?data.results:[],error:null,elapsedMs:Math.max(0,Number(data.elapsedMs)||0),loadedAt:Date.now()};renderCombinedResults('');
    }catch(error){if(controller.signal.aborted||sequence!==documentSequence||error?.code==='DOCUMENT_BRIDGE_ABORTED'||activeQuery)return;if(String(error?.code)==='UNAUTHORIZED')documentBridge.setToken?.('');recentDocumentState={...emptyRecentDocumentState(),status:documentAuthError(error)?'pairing':'error',error};renderCombinedResults('')}
    finally{if(documentAbort===controller)documentAbort=null}
  }
  async function runDocumentSearch(value=''){
    const raw=String(value||'').trim(),sequence=documentSequence;if(!raw||raw!==activeQuery)return;const modes=requestedDocumentModes().filter(mode=>documentStates[mode].status==='loading');if(!modes.length)return;
    const controller=new AbortController();documentAbort=controller;
    await Promise.all(modes.map(async mode=>{
      try{
        const data=await documentBridge.search(raw,{mode,limit:60,signal:controller.signal});if(controller.signal.aborted||sequence!==documentSequence||raw!==activeQuery||!includesDocumentMode(mode))return;documentStates[mode]={mode,status:'done',rows:Array.isArray(data.results)?data.results:[],error:null,elapsedMs:Math.max(0,Number(data.elapsedMs)||0)};renderCombinedResults(raw);
      }catch(error){if(controller.signal.aborted||sequence!==documentSequence||error?.code==='DOCUMENT_BRIDGE_ABORTED'||raw!==activeQuery)return;if(String(error?.code)==='UNAUTHORIZED')documentBridge.setToken?.('');documentStates[mode]={...emptyDocumentState(mode),status:documentAuthError(error)?'pairing':'error',error};renderCombinedResults(raw)}
    }));
    if(documentAbort===controller)documentAbort=null;
  }
  function updateFilterUi(){
    const {filterAll,filterSite,filterFiles,filterContent,input}=refs();const buttons=[[filterAll,'all'],[filterSite,'site'],[filterFiles,'files'],[filterContent,'content']];for(const [button,key] of buttons){button?.classList.toggle('active',filter===key);button?.setAttribute('aria-selected',filter===key?'true':'false')}
    if(input)input.placeholder=filter==='site'?'חפש באתר…':filter==='files'?'חפש קובץ או תיקייה…':filter==='content'?'חפש טקסט בתוך תוכן הקבצים…':'חפש באתר, בקבצים ובתוכן…';
  }
  function setFilter(next){const normalized=SEARCH_FILTERS.has(next)?next:'all';if(filter===normalized)return;filter=normalized;scheduledDocumentRender.cancel();documentSequence+=1;documentAbort?.abort();documentAbort=null;resetDocumentPreview();updateFilterUi();renderResults(refs().input?.value||'');requestAnimationFrame(()=>refs().input?.focus())}
  function setMode(next){setFilter(next==='documents'?'files':'site')}
  function renderResults(value=''){
    const raw=String(value||'').trim();scheduledDocumentRender.cancel();documentSequence+=1;documentAbort?.abort();documentAbort=null;if(raw!==activeQuery){activeQuery=raw;resetDocumentPreview()}
    if(!raw){documentStates={everything:emptyDocumentState('everything'),content:emptyDocumentState('content')};const shouldLoadRecent=prepareRecentDocuments();renderCombinedResults('');if(shouldLoadRecent)runRecentDocuments(documentSequence);return}
    const shouldSearchDocuments=prepareDocumentStates(raw);renderCombinedResults(raw);if(shouldSearchDocuments)scheduledDocumentRender(raw);
  }
  function open(){const {backdrop,input,trigger}=refs();if(!backdrop)return;backdrop.hidden=false;backdrop.setAttribute('aria-hidden','false');trigger?.setAttribute('aria-expanded','true');warmDocumentSearchBridge();updateFilterUi();renderResults(input?.value||'');requestAnimationFrame(()=>input?.focus())}
  function close({restoreFocus=true}={}){const {backdrop,trigger}=refs();if(!backdrop)return;scheduledDocumentRender.cancel();documentSequence+=1;documentAbort?.abort();documentAbort=null;resetDocumentPreview();backdrop.hidden=true;backdrop.setAttribute('aria-hidden','true');trigger?.setAttribute('aria-expanded','false');if(restoreFocus)requestAnimationFrame(()=>trigger?.focus())}
  function toggle(){const {backdrop}=refs();if(!backdrop)return;backdrop.hidden?open():close()}
  function flushCurrent(){return scheduledDocumentRender.flush()}

  function findDataElement(attribute,id){return [...document.querySelectorAll(`[${attribute}]`)].find(el=>el.getAttribute(attribute)===String(id))||null}
  function reveal(attribute,id){requestAnimationFrame(()=>{const target=findDataElement(attribute,id);if(!target)return;target.scrollIntoView({block:'center',inline:'nearest',behavior:'smooth'});target.classList.add('global-search-target');if(highlightTimer)clearTimeout(highlightTimer);highlightTimer=setTimeout(()=>target.classList.remove('global-search-target'),2600)})}
  function navigateSupplier(item){prepareView('supplier');supplierUi.currentSupplierId=item.kind==='supplier'?item.id:item.parentId;supplierUi.filterMode='all';supplierUi.searchText='';supplierUi.supplierYearView=item.kind==='supplier-transaction'?'all':'current';render({supplierScrollMode:item.kind==='supplier-transaction'?'start':'end'});if(item.kind==='supplier-transaction')reveal('data-tx-id',item.id)}
  function navigateCustomer(item){customerUi.resultTarget=item.id;const debts=item.kind==='customer-debt';prepareView(debts?'customers':'customer-orders');customerUi.customerTab=debts?'debts':'orders';customerUi.customerSearch='';if(debts){const debt=model.state.customerDebts.find(x=>x.id===item.id),p=customerDebtProgressData(debt||{});customerUi.customerFilter=p.paymentComplete?(p.invoiceComplete?'closed':'invoice'):'all'}else customerUi.customerFilter='all';render();reveal('data-customer-bulk-id',item.id)}
  function navigateService(item){serviceUi.resultTarget=item.id;prepareView('service');serviceUi.serviceSearch='';const call=model.state.serviceCalls.find(x=>x.id===item.id);serviceUi.serviceFilter=call?.closed?'closed':'all';render();reveal('data-service-bulk-id',item.id)}
  function navigateCheck(item){const check=model.state.checks.find(row=>String(row.id)===String(item.id));ui.kupaSubView='checks';prepareView('kupa');ui.checkTab=checkIsClosedStatus(check?.status)?'closed':'open';ui.checkAccount=item.account==='ביתי'?'ביתי':'עסקי';ui.checkYear='all';ui.checkSearchValue='';render();reveal('data-check-id',item.id)}
  function navigateWarehouse(item){warehouseUi.resultTarget=item.id;prepareView('warehouse');warehouseUi.warehouseSearch='';if(item.kind==='inventory-item'){const inventoryItem=model.state.inventoryItems.find(x=>x.id===item.id);if(inventoryItem?.active===false){warehouseUi.warehouseTab='history';render();openInventoryItemModal(item.id);return}warehouseUi.warehouseTab='stock';warehouseUi.inventoryLocation='';warehouseUi.inventoryFilter='';render();reveal('data-stock-bulk-id',item.id);return}if(item.kind==='warehouse-order'){warehouseUi.warehouseTab='orders';warehouseUi.warehouseOrdersPickedOpen=model.state.warehouseOrders.find(row=>row.id===item.id)?.status==='picked';render();reveal('data-warehouse-order-id',item.id);return}warehouseUi.warehouseTab='history';render();reveal('data-inventory-event-id',item.id)}
  function navigateNote(item){notesUi.notesTab=item.kind==='sheet-row'?'sheet':'notes';if(item.kind==='sheet-row'){notesUi.notesSheetId=item.sheetId;notesUi.notesSheetSearchValue=''}prepareView('notes');render();reveal(item.kind==='sheet-row'?'data-sheet-row-id':'data-note-id',item.id)}
  function navigateItem(item){if(!item)return false;if(item.group==='suppliers')navigateSupplier(item);else if(item.group==='customers')navigateCustomer(item);else if(item.group==='service')navigateService(item);else if(item.group==='checks')navigateCheck(item);else if(item.group==='warehouse')navigateWarehouse(item);else if(item.group==='notes')navigateNote(item);else return false;return true}
  function openResult(key){const item=resultByKey.get(key);if(!item)return;close({restoreFocus:false});navigateItem(item)}
  async function openDocumentResult(id,button){if(!documentBridge||!id)return;const previous=button?.disabled;if(button)button.disabled=true;try{await documentBridge.openDocument(id)}catch(error){const {meta}=refs();if(meta)meta.textContent=error?.message||'פתיחת הקובץ נכשלה'}finally{if(button)button.disabled=!!previous}}
  async function connectDocumentSearch(){if(!documentBridge?.beginConnect)return;const {meta}=refs();if(meta)meta.textContent='מעביר להרשאת Google Drive…';try{await documentBridge.beginConnect({returnUrl:globalThis.location?.href||''})}catch(error){if(meta)meta.textContent=error?.message||'חיבור Google Drive נכשל'}}
  async function pairDocumentBridge(){
    if(!documentBridge)return;const token=String(byId('globalSearchDocumentToken')?.value||'').trim();if(!token)return;documentBridge.setToken(token);const {meta,input}=refs();if(meta)meta.textContent='בודק את החיבור המקומי…';
    try{const status=await documentBridge.status();const index=status.index||{},files=Number(index.fileCount)||0,indexed=Number(index.indexedContentCount)||0;if(meta)meta.textContent=`מחובר ל-Everything ${status.everythingVersion||''} · ${files} קבצים באינדקס · ${indexed} עם תוכן מאונדקס`;renderResults(input?.value||'')}
    catch(error){if(String(error?.code)==='UNAUTHORIZED')documentBridge.setToken('');for(const mode of requestedDocumentModes())documentStates[mode]={...emptyDocumentState(mode),status:'error',error};renderCombinedResults(input?.value||'')}
  }

  function bind(){
    const {trigger,backdrop,input,results,close:closeButton,filterAll,filterSite,filterFiles,filterContent,previewMatches,splitter,workspace}=refs();if(!trigger||!backdrop||!input||!results||!closeButton)return;
    trigger.addEventListener('click',toggle);closeButton.addEventListener('click',close);filterAll?.addEventListener('click',()=>setFilter('all'));filterSite?.addEventListener('click',()=>setFilter('site'));filterFiles?.addEventListener('click',()=>setFilter('files'));filterContent?.addEventListener('click',()=>setFilter('content'));input.addEventListener('input',()=>renderResults(input.value));
    input.addEventListener('keydown',event=>{if(event.key==='ArrowDown'){flushCurrent();const first=results.querySelector('.global-search-result');if(first){event.preventDefault();first.focus()}}});
    results.addEventListener('keydown',event=>{if(!event.target.matches('.global-search-result'))return;if(event.key==='ArrowDown'||event.key==='ArrowUp'){const buttons=[...results.querySelectorAll('.global-search-result')],index=buttons.indexOf(event.target),next=event.key==='ArrowDown'?Math.min(buttons.length-1,index+1):Math.max(0,index-1);event.preventDefault();buttons[next]?.focus();if(buttons[next]?.dataset.documentResultId)selectDocumentResult(buttons[next].dataset.documentResultId,buttons[next],buttons[next].dataset.documentSearchMode)}else if(event.key==='Enter'&&event.target.dataset.documentResultId){event.preventDefault();openDocumentResult(event.target.dataset.documentResultId,event.target)}else if(event.key==='Escape')close()});
    results.addEventListener('click',event=>{const connect=event.target.closest('[data-document-connect]');if(connect){connectDocumentSearch();return}const pair=event.target.closest('[data-document-pair]');if(pair){pairDocumentBridge();return}const documentButton=event.target.closest('[data-document-result-id]');if(documentButton){selectDocumentResult(documentButton.dataset.documentResultId,documentButton,documentButton.dataset.documentSearchMode);return}const button=event.target.closest('[data-global-result-key]');if(button)openResult(button.dataset.globalResultKey)});
    results.addEventListener('dblclick',event=>{const documentButton=event.target.closest('[data-document-result-id]');if(documentButton){event.preventDefault();openDocumentResult(documentButton.dataset.documentResultId,documentButton)}});
    previewMatches?.addEventListener('click',event=>{if(!previewMatchInfo?.snippets?.length)return;const previous=event.target.closest('[data-preview-match-prev]'),next=event.target.closest('[data-preview-match-next]');if(!previous&&!next)return;if(previewSearchViewer){previous?previewSearchViewer.previous():previewSearchViewer.next();return}const current=Number(previewMatches.dataset.matchIndex)||0;if(previous)showPreviewMatch((current-1+previewMatchInfo.snippets.length)%previewMatchInfo.snippets.length);else showPreviewMatch((current+1)%previewMatchInfo.snippets.length)});
    if(splitter&&workspace){let resizing=false;const updateFromPointer=event=>{if(!resizing)return;const rect=workspace.getBoundingClientRect();if(!rect.width)return;applyPreviewWidth((event.clientX-rect.left)/rect.width*100)};const finish=event=>{if(!resizing)return;resizing=false;splitter.classList.remove('dragging');try{splitter.releasePointerCapture?.(event.pointerId)}catch{}const current=parseFloat(workspace.style.getPropertyValue('--document-preview-width'))||DOCUMENT_PREVIEW_DEFAULT;applyPreviewWidth(current,{save:true})};splitter.addEventListener('pointerdown',event=>{if(splitter.hidden)return;resizing=true;splitter.classList.add('dragging');splitter.setPointerCapture?.(event.pointerId);updateFromPointer(event);event.preventDefault()});splitter.addEventListener('pointermove',updateFromPointer);splitter.addEventListener('pointerup',finish);splitter.addEventListener('pointercancel',finish);splitter.addEventListener('keydown',event=>{if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight'&&event.key!=='Home'&&event.key!=='End')return;event.preventDefault();const current=parseFloat(workspace.style.getPropertyValue('--document-preview-width'))||savedPreviewWidth();const next=event.key==='Home'?DOCUMENT_PREVIEW_MIN:event.key==='End'?DOCUMENT_PREVIEW_MAX:current+(event.key==='ArrowRight'?3:-3);applyPreviewWidth(next,{save:true})})}
    results.addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target.id==='globalSearchDocumentToken'){event.preventDefault();pairDocumentBridge()}});
    backdrop.addEventListener('pointerdown',event=>{backdropPointerId=event.target===backdrop?event.pointerId:null});backdrop.addEventListener('pointerup',event=>{const dismiss=backdropPointerId===event.pointerId&&event.target===backdrop;backdropPointerId=null;if(dismiss)close()});backdrop.addEventListener('pointercancel',()=>{backdropPointerId=null});
    warmDocumentSearchBridge();
    window.addEventListener('resize',()=>{syncNativePreviewGeometry({force:true})});window.addEventListener('focus',()=>{if(nativePreviewActive)syncNativePreviewGeometry({force:true})});document.addEventListener('visibilitychange',()=>{if(document.hidden){if(nativePreviewActive)deactivateNativePreview({forget:false});return}if(nativePreviewWantedId&&selectedDocumentId===nativePreviewWantedId&&!backdrop.hidden){const sequence=previewSequence;showNativePreview(nativePreviewWantedId,sequence).catch(()=>{})}});document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();open();return}if(event.key==='Escape'&&!backdrop.hidden)close()});
  }

  return{bind,open,close,toggle,renderResults,openResult,navigateItem,setMode,setFilter};
}
