import {esc} from '../core/values.js';
import {createDocumentResultMenu,deleteLocalDocumentResult} from '../ui/document-result-menu.js';
import {createPdfSearchViewer,preloadPdfSearchRuntime} from '../domains/documents/pdf-search-viewer.js';
import {buildPdfPreviewSrc} from '../domains/documents/pdf-text-fragments.js';
import {createTextSearchViewer} from '../domains/documents/text-search-viewer.js';
import {createDocxSearchViewer,preloadDocxSearchRuntime} from '../domains/documents/docx-search-viewer.js';
import {createSpreadsheetSearchViewer} from '../domains/documents/spreadsheet-search-viewer.js';
import {documentResultsTableHtml,previewDetailsHtml,previewMatchBarPresentation,previewTextLabel,safeCloudViewUrl} from '../ui/document-search-view.js';
import {createDocumentSearchFolderScope} from '../ui/document-search-folder-scope.js';
import {createDocumentFileTypeFilter} from '../ui/document-search-file-type.js';
import {createDocumentIndexRefresh} from '../ui/document-index-refresh.js';
import {globalSearchRefs} from '../ui/global-search-refs.js';
import {createDocumentContentSearchOptions} from '../ui/document-search-content-options.js';
import {appendUniqueDocumentRows,createDocumentSearchLanes} from '../ui/document-search-pipeline.js';
import {DOCUMENT_SORT_FIELDS,nextDocumentSort,normalizeDocumentSort,sortedDocumentRows} from '../domains/documents/document-result-sort.js';

const SITE_RESULT_BATCH=150;
const SITE_RESULT_MAX=5000;
const DOCUMENT_RESULT_BATCH=150;
const DOCUMENT_RESULT_MAX=5000;
const DOCUMENT_LOAD_MORE_THRESHOLD_PX=700;
const RECENT_DOCUMENT_LIMIT=150;
const RECENT_DOCUMENT_TTL_MS=15000;
const DOCUMENT_BRIDGE_WARM_TTL_MS=25000;
const DOCUMENT_PREVIEW_DEFAULT=58;
const DOCUMENT_PREVIEW_MIN=32;
const DOCUMENT_PREVIEW_MAX=72;
const SEARCH_FILTERS=new Set(['all','site','files','content']);


// Global search owns one query and one result surface. Site, file-name and file-content
// sources are searched independently, then composed in a deterministic source order.
export function createGlobalDocumentSearch({documentBridge=null,siteSearch,siteResultMeta=()=>[],navigateSiteItem=()=>false,confirmDialog=null,previewWidthKey='netunim_document_preview_width_v1'}){
  let resultByKey=new Map(),documentResultByKey=new Map(),backdropPointerId=null,filter='all',siteResultLimit=SITE_RESULT_BATCH,documentSequence=0,documentAbort=null,documentPageAbort=null,activeQuery='',selectedDocumentId='',selectedDocumentKey='',selectedDocumentMode='everything',previewSequence=0,previewObjectUrl='',previewAbort=null,previewMatchesAbort=null,previewMatchInfo=null,previewSearchViewer=null,previewSearchState={current:0,total:0},nativePreviewActive=false,nativePreviewWantedId='',nativePreviewGeometryKey='',nativePreviewPoll=null,documentWarmPromise=null,documentWarmAt=0;
  let documentStates={everything:emptyDocumentState('everything'),content:emptyDocumentState('content')},recentDocumentState=emptyRecentDocumentState(),documentSorts={everything:{field:'modified',direction:'desc'},content:{field:'modified',direction:'desc'}},recentDocumentSort={field:'modified',direction:'desc'};
  const byId=id=>document.getElementById(id);
  const refs=globalSearchRefs;
  const documentSearchLanes=createDocumentSearchLanes(runDocumentSearchMode);

  function emptyDocumentState(mode){return{mode,status:'idle',rows:[],error:null,elapsedMs:0,hasMore:false,loadingMore:false}}
  function emptyRecentDocumentState(){return{status:'idle',rows:[],error:null,elapsedMs:0,loadedAt:0}}
  const cancelScheduledDocumentSearches=()=>documentSearchLanes.cancel();
  const abortDocumentModeSearches=()=>documentSearchLanes.abortAll();
  function warmDocumentSearchBridge(){if(!documentBridge?.warm||!documentBridge.getToken?.())return null;const now=Date.now();if(documentWarmPromise)return documentWarmPromise;if(now-documentWarmAt<DOCUMENT_BRIDGE_WARM_TTL_MS)return null;documentWarmAt=now;documentWarmPromise=Promise.resolve(documentBridge.warm()).catch(()=>null).finally(()=>{documentWarmPromise=null});return documentWarmPromise}
  function isGoogleDriveSource(){return documentBridge?.provider==='google-drive'}
  function documentResultProvider(id=selectedDocumentId){return documentBridge?.providerFor?.(id)||(isGoogleDriveSource()?'google-drive':'everything')}
  function isGoogleDriveResult(id=selectedDocumentId){return documentResultProvider(id)==='google-drive'}
  function hasLocalDocumentActions(){return !isGoogleDriveSource()&&typeof documentBridge?.revealDocument==='function'&&typeof documentBridge?.deleteDocument==='function'}
  function documentProviderLabel(){return String(documentBridge?.providerLabel||(isGoogleDriveSource()?'Google Drive':'Everything'))}
  function documentProviderNotice(){return String(documentBridge?.providerNotice||'')}
  function providerNoticeHtml(){const note=documentProviderNotice();return note?`<div class="document-provider-notice"><span>DRIVE</span>${esc(note)}</div>`:''}
  function localBridgePairingReminder(){if(!documentBridge?.supportsLocalPairing||documentBridge?.localToken)return '';return `<div class="document-search-fallback-local document-search-local-pairing-reminder"><span>ה־Document Bridge מותקן, אבל הדפדפן הזה עדיין לא משויך למחשב המקומי.</span><div class="document-search-pair"><input id="globalSearchDocumentToken" type="password" autocomplete="off" spellcheck="false" placeholder="הדבק מפתח Document Bridge"><button type="button" data-document-pair>חבר מחשב</button></div><small>אפשר להמשיך זמנית דרך Google Drive; לאחר הזנת המפתח החיפוש המקומי ב־Everything יחזור להיות המקור הראשי.</small></div>`}
  function documentAuthError(error){const code=String(error?.code||'');return ['DOCUMENT_BRIDGE_NOT_PAIRED','UNAUTHORIZED','google_drive_not_connected','google_drive_reconnect_required','google_drive_auth_required'].includes(code)}
  function sourceLabel(mode){const base=mode==='content'?'חיפוש תוכן':'חיפוש קבצים';return `${base} · ${documentProviderLabel()}`}
  function includesSite(){return filter==='all'||filter==='site'}
  function includesDocumentMode(mode){return filter==='all'||(filter==='files'&&mode==='everything')||(filter==='content'&&mode==='content')}
  function requestedDocumentModes(){return ['everything','content'].filter(includesDocumentMode)}
  function includesRecentDocuments(){return filter==='all'||filter==='files'}
  const documentContentOptions=createDocumentContentSearchOptions({refs,isEnabled:()=>includesDocumentMode('content')&&!isGoogleDriveSource(),onChanged:()=>renderResults(refs().input?.value||'')});
  const documentFolderScope=createDocumentSearchFolderScope({documentBridge,getFilter:()=>filter,refs,onChanged:()=>{recentDocumentState=emptyRecentDocumentState();renderResults(refs().input?.value||'')},onCancelled:()=>renderCombinedResults(refs().input?.value||'')});
  const documentFileType=createDocumentFileTypeFilter({refs,isEnabled:()=>filter!=='site',onChanged:()=>{recentDocumentState=emptyRecentDocumentState();resetDocumentPreview();renderResults(refs().input?.value||'')}});
  let pdfIndexRefresh=null;
  function getPdfIndexRefresh(){if(!pdfIndexRefresh){const {pdfRefreshButton,pdfRefreshStatus}=refs();pdfIndexRefresh=createDocumentIndexRefresh({bridge:documentBridge,button:pdfRefreshButton,status:pdfRefreshStatus,onCompleted:()=>renderResults(refs().input?.value||'')})}return pdfIndexRefresh}
  const documentMenu=createDocumentResultMenu({results:()=>refs().results,available:hasLocalDocumentActions,open:(...args)=>openDocumentResult(...args),reveal:(...args)=>revealDocumentResult(...args),remove:(...args)=>deleteDocumentResult(...args),select:(...args)=>selectDocumentResult(...args)});
  const hideDocumentContextMenu=()=>documentMenu.hide(),showDocumentContextMenu=(...args)=>documentMenu.show(...args);
  function scopeIntro(){const source=isGoogleDriveSource()?'Google Drive':'המחשב הזה';return `<div class="global-search-empty"><div class="global-search-empty-icon">⌕</div><b>חיפוש אחד בכל המאגרים</b><p>הקלדה כאן מחפשת באתר, בשמות קבצים ובתוכן קבצים דרך ${esc(source)}. אפשר לצמצם את התוצאות בעזרת המסננים למעלה.</p><div class="global-search-scopes"><span>האתר</span><span>קבצים</span><span>תוכן קבצים</span></div></div>`}
  function documentPairing({compact=false}={}){if(isGoogleDriveSource()){if(compact)return `<div class="document-search-compact-note">חיפוש התוכן יהיה זמין לאחר חיבור Google Drive.</div>`;const localPair=documentBridge?.supportsLocalPairing?`<div class="document-search-fallback-local"><span>או שחזר את החיבור המקומי ל-Everything</span><div class="document-search-pair"><input id="globalSearchDocumentToken" type="password" autocomplete="off" spellcheck="false" placeholder="הדבק מפתח Document Bridge"><button type="button" data-document-pair>חבר מחשב</button></div></div>`:'';return `<div class="global-search-empty document-search-setup"><div class="global-search-empty-icon">⌕</div><b>חיפוש ותצוגה מקדימה דרך Google Drive</b><p>${documentBridge?.fallbackFromLocal?'הגישה המקומית אינה זמינה כרגע, ולכן האתר יעבור אוטומטית ל-Google Drive.':'במכשיר הזה החיפוש והתצוגה המקדימה משתמשים ישירות ב-Google Drive.'}</p><div class="document-search-pair"><button type="button" data-document-connect>חבר Google Drive</button></div><small>לאחר החיבור אפשר לחפש ולהציג PDF, Word, Excel ומסמכי Google נתמכים ישירות בתוך האתר. Refresh Token נשמר רק ב-Supabase.</small>${localPair}</div>`}if(compact)return `<div class="document-search-compact-note">חיפוש התוכן יהיה זמין לאחר חיבור Document Bridge במחשב זה.</div>`;return `<div class="global-search-empty document-search-setup"><div class="global-search-empty-icon">⌕</div><b>חיפוש מסמכים במחשב זה</b><p>Document Bridge עדיין לא משויך לדפדפן הזה. מתקינים אותו בנפרד בכל מחשב; המפתח שהמתקין מעתיק ללוח נשמר רק בדפדפן המקומי.</p><div class="document-search-pair"><input id="globalSearchDocumentToken" type="password" autocomplete="off" spellcheck="false" placeholder="הדבק מפתח Document Bridge"><button type="button" data-document-pair>חבר מחשב</button></div><small>הקבצים ותוכן החיפוש נשארים במחשב ואינם מועלים לאתר או לענן.</small></div>`}
  function documentIntro(mode){const content=mode==='content';if(isGoogleDriveSource())return `<div class="global-search-empty document-search-intro"><div class="global-search-empty-icon">FILE</div><b>${content?'חיפוש תוכן ב-Google Drive':'חיפוש קבצים ב-Google Drive'}</b><p>${content?'הקלד לפחות שני תווים. Google Drive מחפש מילות אינדקס בתוך שם, מטא-דאטה ותוכן שהוא יודע לאנדקס.':'חיפוש שמות קבצים ותיקיות מתבצע דרך Google Drive API.'}</p></div>`;return `<div class="global-search-empty document-search-intro"><div class="global-search-empty-icon">FILE</div><b>${content?'חיפוש תוכן':'חיפוש קבצים'}</b><p>${content?'הקלד לפחות שני תווים כדי לחפש מילים בתוך תוכן הקבצים דרך Everything.':'חיפוש קבצים ותיקיות דרך אותו אינדקס ותחביר של Everything.'}</p></div>`}

  function resultMeta(item){const parts=siteResultMeta?.(item);return Array.isArray(parts)?parts.filter(Boolean):[]}
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
    const {previewBody,previewMatches}=refs();if(previewMatches){previewMatches.hidden=true;previewMatches.innerHTML=''}if(previewBody){const text=isGoogleDriveSource()?'לחיצה אחת מציגה את הקובץ ישירות כאן; אם הסוג אינו נתמך יופיע כפתור פתיחה ב-Google Drive.':'לחיצה אחת על תוצאת קובץ תציג אותה כאן. לחיצה כפולה תפתח אותה במחשב.';previewBody.innerHTML=`<div class="document-preview-empty"><span>⌕</span><b>תצוגה מקדימה</b><p>${esc(text)}</p></div>`}
  }
  function renderDocumentTable(rows,mode,{label=sourceLabel(mode),hint=isGoogleDriveSource()?'לחיצה אחת לתצוגה מקדימה · לחיצה כפולה לפתיחה ב-Google Drive':'לחיצה אחת לתצוגה · לחיצה כפולה לפתיחה',hasMore=false,sortScope=mode,sort=documentSorts[mode]}={}){
    const title=isGoogleDriveSource()?'לחיצה: תצוגה מקדימה · לחיצה כפולה: פתיחה ב-Google Drive':'לחיצה: תצוגה מקדימה · לחיצה כפולה: פתיחה במחשב';
    return documentResultsTableHtml(rows,mode,{label,hint,title,hasMore,sortScope,sort:normalizeDocumentSort(sort),selectedKey:selectedDocumentKey,register:(key,item)=>documentResultByKey.set(key,item)});
  }
  function clampPreviewWidth(value){const n=Number(value);return Math.max(DOCUMENT_PREVIEW_MIN,Math.min(DOCUMENT_PREVIEW_MAX,Number.isFinite(n)?n:DOCUMENT_PREVIEW_DEFAULT))}
  function savedPreviewWidth(){try{const value=localStorage.getItem(previewWidthKey);return value===null?DOCUMENT_PREVIEW_DEFAULT:clampPreviewWidth(value)}catch{return DOCUMENT_PREVIEW_DEFAULT}}
  function applyPreviewWidth(value,{save=false}={}){const width=clampPreviewWidth(value),{workspace,splitter}=refs();workspace?.style.setProperty('--document-preview-width',`${width}%`);splitter?.setAttribute('aria-valuenow',String(Math.round(width)));if(save)try{localStorage.setItem(previewWidthKey,String(width))}catch{}previewSearchViewer?.resize?.({immediate:save});if(nativePreviewActive)queueMicrotask(()=>syncNativePreviewGeometry({force:true}));return width}
  function setPreviewLayout(visible){const {workspace,preview,splitter}=refs();if(preview)preview.hidden=!visible;if(splitter)splitter.hidden=!visible;workspace?.classList.toggle('preview-active',visible);if(visible)applyPreviewWidth(savedPreviewWidth());else if(nativePreviewActive)deactivateNativePreview({forget:false})}
  function previewContentQuery(){return selectedDocumentMode==='content'?String(refs().input?.value||'').trim():''}
  function showPreviewMatch(index=0,{viewerState=null}={}){
    const {previewMatches}=refs(),presentation=previewMatchBarPresentation(previewMatchInfo,{viewerState:viewerState||previewSearchState||{},index,query:previewContentQuery()});if(!previewMatches||!presentation)return;
    previewMatches.dataset.matchIndex=String(presentation.index);previewMatches.hidden=false;previewMatches.innerHTML=presentation.html;if(nativePreviewActive)queueMicrotask(()=>syncNativePreviewGeometry({force:true}));
  }
  function onPreviewSearchMatchState(state){
    previewSearchState={current:Math.max(0,Number(state?.current)||0),total:Math.max(0,Number(state?.total)||0),snippet:state?.snippet||null,capped:!!state?.capped,location:String(state?.location||'')};
    if(previewSearchState.total&&previewSearchState.snippet){previewMatchInfo={active:true,query:previewContentQuery(),count:previewSearchState.total,capped:previewSearchState.capped,snippets:[previewSearchState.snippet],viewerDriven:true};showPreviewMatch(0,{viewerState:previewSearchState});return}
    if(previewMatchInfo?.count)showPreviewMatch(Math.max(0,previewSearchState.current-1),{viewerState:previewSearchState});
  }
  async function loadPreviewMatches(id,sequence){const {previewMatches}=refs(),query=previewContentQuery();if(isGoogleDriveResult(id)){if(!previewSearchState.total&&!previewMatchInfo?.count&&previewMatches){previewMatches.hidden=true;previewMatches.innerHTML=''}return}previewMatchInfo=null;if(!previewMatches)return;if(selectedDocumentMode!=='content'||query.length<2||!documentBridge?.matches){previewMatches.hidden=true;previewMatches.innerHTML='';return}previewMatches.hidden=false;previewMatches.innerHTML='<div class="document-preview-match-loading">מאתר את ההתאמות בקובץ הנבחר…</div>';previewMatchesAbort?.abort();previewMatchesAbort=new AbortController();try{const info=await documentBridge.matches(id,{signal:previewMatchesAbort.signal});if(sequence!==previewSequence||selectedDocumentId!==String(id))return;await previewSearchViewer?.setExternalMatchInfo?.(info);if(sequence!==previewSequence||selectedDocumentId!==String(id))return;previewMatchInfo=info;if(info?.count||previewSearchState.total)showPreviewMatch(previewSearchState.current?previewSearchState.current-1:0,{viewerState:previewSearchState.total?previewSearchState:null});else{previewMatches.hidden=false;previewMatches.innerHTML='<div class="document-preview-match-loading muted">הקובץ תאם לחיפוש, אך לא ניתן למקם את הטקסט בתצוגה המקדימה.</div>'}if(nativePreviewActive)queueMicrotask(()=>syncNativePreviewGeometry({force:true}))}catch(error){if(sequence!==previewSequence||error?.code==='DOCUMENT_BRIDGE_ABORTED')return;previewMatches.hidden=true;previewMatches.innerHTML=''}}

  async function selectDocumentResult(id,button,mode=button?.dataset.documentSearchMode||'everything'){
    if(!documentBridge||!id)return;deactivateNativePreview();selectedDocumentId=String(id);selectedDocumentMode=mode==='content'?'content':'everything';selectedDocumentKey=button?.dataset.documentResultKey||`${selectedDocumentMode}:${id}`;for(const row of refs().results?.querySelectorAll?.('[data-document-result-key]')||[])row.classList.toggle('selected',row===button);const item=documentResultByKey.get(selectedDocumentKey);const {previewBody,previewMatches}=refs();cleanupPreviewObject();previewSequence+=1;const sequence=previewSequence;previewAbort?.abort();previewAbort=new AbortController();previewMatchesAbort?.abort();previewMatchesAbort=null;previewMatchInfo=null;if(previewMatches){previewMatches.hidden=true;previewMatches.innerHTML=''}if(previewBody)previewBody.innerHTML='<div class="document-preview-loading"><span></span><b>טוען תצוגה מקדימה…</b></div>';
    const contentQuery=previewContentQuery(),contentSearch=selectedDocumentMode==='content'?documentContentOptions.value():{},extension=String(item?.extension||'').toLowerCase();
    const preparePdfRuntime=extension==='pdf'?preloadPdfSearchRuntime().then(runtime=>({runtime}),error=>({error})):null;
    const prepareDocxRuntime=selectedDocumentMode==='content'&&['docx','docm','dotx','dotm'].includes(extension)&&contentQuery.length>=2?preloadDocxSearchRuntime().then(()=>({ok:true}),error=>({error})):null;
    const startPreviewMatches=()=>loadPreviewMatches(id,sequence).catch(()=>{});
    const attachViewer=viewer=>{if(sequence!==previewSequence||selectedDocumentId!==String(id)){viewer?.destroy?.().catch?.(()=>{});return false}previewSearchViewer=viewer;const state=viewer?.matchState?.();if(state?.total)onPreviewSearchMatchState(state);return true};
    try{
      const data=await documentBridge.preview(id);if(sequence!==previewSequence||selectedDocumentId!==String(id))return;
      if(data.kind==='cloud'){if(previewMatches){previewMatches.hidden=true;previewMatches.innerHTML=''}const url=safeCloudViewUrl(data.webViewLink||item?.webViewLink),name=data.name||item?.name||(data.isDirectory?'תיקייה':'קובץ'),action=data.isDirectory?'פתח את התיקייה ב-Google Drive':'פתח את הקובץ ב-Google Drive',reason=String(data.previewReason||'לא ניתן להציג את סוג הקובץ הזה ישירות בתוך האתר.');previewBody.innerHTML=`<div class="document-preview-cloud"><span>DRIVE</span><b>${esc(name)}</b><p>${esc(reason)}</p>${url?`<a class="document-preview-open" data-document-open-link href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(action)}</a>`:'<div class="document-preview-open-error">Google Drive לא החזיר קישור צפייה תקין.</div>'}${previewDetailsHtml(data)}</div>`;return}
      if(data.kind==='folder'){if(previewMatches){previewMatches.hidden=true;previewMatches.innerHTML=''}previewBody.innerHTML=`<div class="document-preview-folder"><div class="document-preview-folder-icon"></div><b>${esc(data.name||item?.name||'תיקייה')}</b><p>לחיצה כפולה על התוצאה תפתח את התיקייה בסייר הקבצים.</p>${previewDetailsHtml(data)}</div>`;return}
      if(data.kind==='native'){startPreviewMatches();previewBody.innerHTML='<div class="document-preview-native"><span>OFFICE</span><b>Windows Preview</b><p>נטענת התצוגה המקורית שמותקנת ב-Windows…</p></div>';await showNativePreview(id,sequence);return}
      if(data.kind==='structured'){
        const blob=await documentBridge.previewFile(id,{signal:previewAbort.signal});if(sequence!==previewSequence||selectedDocumentId!==String(id))return;
        previewBody.innerHTML=`<div class="document-preview-loading"><span></span><b>${data.documentKind==='word'?'מכין מסמך Word עם כל ההתאמות…':'קורא את חוברת Excel ומאתר התאמות…'}</b></div>`;
        try{
          let viewer;if(data.documentKind==='word'){const prepared=prepareDocxRuntime?await prepareDocxRuntime:null;if(prepared?.error)throw prepared.error;viewer=await createDocxSearchViewer({host:previewBody,blob,query:contentQuery,contentSearch,onMatchState:state=>{if(sequence===previewSequence&&selectedDocumentId===String(id))onPreviewSearchMatchState(state)}})}else viewer=await createSpreadsheetSearchViewer({host:previewBody,blob,query:contentQuery,contentSearch,onMatchState:state=>{if(sequence===previewSequence&&selectedDocumentId===String(id))onPreviewSearchMatchState(state)}});
          if(!attachViewer(viewer))return;startPreviewMatches();return;
        }catch(error){if(sequence!==previewSequence)return;previewBody.innerHTML=`<div class="document-preview-empty error"><span>!</span><b>מציג המסמך המקומי לא נטען</b><p>${esc(error?.message||'חבילת התצוגה המקומית אינה מותקנת.')}<br>הרץ npm run document-viewers:install ולאחר מכן רענן את האתר.</p></div>`;if(previewMatches){previewMatches.hidden=false;previewMatches.innerHTML='<div class="document-preview-match-loading muted">התוצאה קיימת באינדקס Everything, אך המציג המקומי אינו זמין.</div>'}return}
      }
      if(data.kind==='binary'){const blob=await documentBridge.previewFile(id,{signal:previewAbort.signal});if(sequence!==previewSequence||selectedDocumentId!==String(id))return;const query=contentQuery;if(data.mime==='application/pdf'){previewBody.innerHTML=`<div class="document-preview-loading"><span></span><b>${selectedDocumentMode==='content'&&query.length>=2?'מכין PDF עם כל ההתאמות…':'מכין תצוגת PDF…'}</b></div>`;try{const prepared=preparePdfRuntime?await preparePdfRuntime:null;if(prepared?.error)throw prepared.error;const viewer=await createPdfSearchViewer({host:previewBody,blob,query,contentSearch,runtime:prepared?.runtime||null,interactiveForms:!isGoogleDriveResult(id),onMatchState:state=>{if(sequence===previewSequence&&selectedDocumentId===String(id))onPreviewSearchMatchState(state)}});if(!attachViewer(viewer))return;startPreviewMatches()}catch(error){if(sequence!==previewSequence)return;previewObjectUrl=URL.createObjectURL(blob);const fallbackSrc=selectedDocumentMode==='content'&&query.length>=2?buildPdfPreviewSrc(previewObjectUrl,{query}):`${previewObjectUrl}#toolbar=0&navpanes=0&view=FitH`;previewBody.innerHTML=`<div class="document-preview-pdf"><iframe class="document-preview-frame" src="${esc(fallbackSrc)}" title="${esc(data.name||'PDF')}"></iframe></div>`;startPreviewMatches();if(selectedDocumentMode==='content'&&query.length>=2&&previewMatches){previewMatches.hidden=false;previewMatches.innerHTML=`<div class="document-preview-match-loading muted">הניווט המדויק בתוך PDF לא נטען · ${esc(error?.message||'PDF.js לא זמין')}</div>`}}return}previewObjectUrl=URL.createObjectURL(blob);startPreviewMatches();previewBody.innerHTML=`<div class="document-preview-image"><img src="${esc(previewObjectUrl)}" alt="${esc(data.name||'תמונה')}"></div>`;return}
      if(data.kind==='text'){
        if(selectedDocumentMode==='content'&&contentQuery.length>=2){const viewer=await createTextSearchViewer({host:previewBody,text:data.text||'',query:contentQuery,contentSearch,label:previewTextLabel(data),truncated:!!data.truncated,onMatchState:state=>{if(sequence===previewSequence&&selectedDocumentId===String(id))onPreviewSearchMatchState(state)}});if(attachViewer(viewer))startPreviewMatches();return}
        const viewer=await createTextSearchViewer({host:previewBody,text:data.text||'',query:'',label:previewTextLabel(data),truncated:!!data.truncated});attachViewer(viewer);return;
      }
      previewBody.innerHTML=`<div class="document-preview-empty"><span>FILE</span><b>אין תצוגה מקדימה זמינה</b><p>אפשר לפתוח את הקובץ בתוכנה המותקנת במחשב בלחיצה כפולה על התוצאה.</p>${previewDetailsHtml(data)}</div>`;
    }catch(error){if(sequence!==previewSequence||error?.code==='DOCUMENT_BRIDGE_ABORTED')return;if(previewBody&&isGoogleDriveResult(id)){const url=safeCloudViewUrl(item?.webViewLink),name=item?.name||'הקובץ',reason=error?.code==='PREVIEW_TOO_LARGE'?'הקובץ גדול מדי לתצוגה מקדימה מהירה בתוך האתר.':`לא ניתן לטעון את התצוגה המקדימה דרך Google Drive${error?.message?`: ${error.message}`:'.'}`;if(previewMatches){previewMatches.hidden=true;previewMatches.innerHTML=''}previewBody.innerHTML=`<div class="document-preview-cloud"><span>DRIVE</span><b>${esc(name)}</b><p>${esc(reason)}</p>${url?`<a class="document-preview-open" data-document-open-link href="${esc(url)}" target="_blank" rel="noopener noreferrer">פתח את הקובץ ב-Google Drive</a>`:''}${previewDetailsHtml(item||{})}</div>`;return}if(previewBody)previewBody.innerHTML=`<div class="document-preview-empty error"><span>!</span><b>התצוגה המקדימה נכשלה</b><p>${esc(error?.message||'לא ניתן להציג את הקובץ.')}</p></div>`}
  }


  function sourceHeader(label,count,{loading=false}={}){return `<header class="global-search-source-head"><b>${esc(label)}</b>${loading?'<span class="global-search-source-loading">מחפש…</span>':`<span>${esc(count)}</span>`}</header>`}
  function renderSiteSource(raw){
    const data=siteSearch?.(raw,{limitPerGroup:siteResultLimit})||{total:0,groups:[]},visibleGroups=(data.groups||[]).filter(group=>group.total>0);
    let hiddenTotal=0;
    const groups=visibleGroups.map(group=>{const rows=group.items.map((item,index)=>{const key=`${group.key}:${item.kind}:${item.id}:${index}`;resultByKey.set(key,item);const metaParts=resultMeta(item);return `<button class="global-search-result" type="button" data-global-result-key="${esc(key)}"><span class="global-search-result-main"><span class="global-search-result-kicker">${esc(item.context||group.label)} · ${esc(item.badge||group.label)}</span><b>${esc(item.title||'תוצאה')}</b>${item.subtitle?`<span class="global-search-result-subtitle">${esc(item.subtitle)}</span>`:''}</span>${metaParts.length?`<span class="global-search-result-meta">${metaParts.map(x=>`<em>${esc(x)}</em>`).join('')}</span>`:''}<span class="global-search-result-arrow" aria-hidden="true">←</span></button>`}).join('');const hidden=Math.max(0,Number(group.total||0)-group.items.length);hiddenTotal+=hidden;return `<section class="global-search-group"><header><b>${esc(group.label)}</b><span>${esc(group.total)}</span></header><div class="global-search-group-results">${rows}</div>${hidden>0?`<div class="global-search-more">מוצגות ${esc(group.items.length)} מתוך ${esc(group.total)} תוצאות בקבוצה.</div>`:''}</section>`}).join('');
    const canLoadMore=hiddenTotal>0&&siteResultLimit<SITE_RESULT_MAX,loadMore=canLoadMore?`<div class="document-search-load-more" data-site-load-more>גלול להמשך תוצאות האתר</div>`:'';
    const body=groups?`${groups}${loadMore}`:'<div class="global-search-source-empty">לא נמצאו תוצאות באתר.</div>';
    return {total:data.total,settledEmpty:data.total===0,hasMore:canLoadMore,html:`<section class="global-search-source-section" data-search-source="site">${sourceHeader('חיפוש באתר',data.total)}<div class="global-search-source-body">${body}</div></section>`};
  }
  function documentErrorHtml(error){const code=String(error?.code||'');if(documentAuthError(error))return documentPairing();const hint=isGoogleDriveSource()?'בדוק שהאתר מחובר לענן, ש-Google Drive API פעיל ושהרשאת Drive לא בוטלה.':code==='DOCUMENT_BRIDGE_UNAVAILABLE'?'ודא ש־Document Bridge מותקן ופועל במחשב זה.':code==='EVERYTHING_EXE_NOT_FOUND'?'ה־Bridge לא מצא את Everything.exe. התקן את Everything 1.5 באמצעות המתקין הרשמי.':'בדוק ש־Everything פועל ושהאינדקס שלו מחזיר את אותה שאילתה בחלון Everything.';return `<div class="global-search-empty document-search-error"><div class="global-search-empty-icon">!</div><b>חיפוש הקבצים אינו זמין</b><p>${esc(error?.message||'לא ניתן להשלים את חיפוש המסמכים.')}<br>${esc(hint)}</p></div>`}
  function renderDocumentSource(mode,raw){
    const state=documentStates[mode],label=sourceLabel(mode),count=state.rows.length,hasRows=state.status==='done'&&count>0;
    let body='';
    if(state.status==='loading')body=`<div class="global-search-source-progress"><span class="document-search-spinner">⌕</span>מחפש דרך ${esc(documentProviderLabel())}…</div>`;
    else if(state.status==='pairing')body=documentPairing({compact:filter==='all'&&mode==='content'});
    else if(state.status==='unavailable'||state.status==='error')body=documentErrorHtml(state.error||{message:'רכיב החיפוש המקומי אינו זמין.'});
    else if(state.status==='short')body=documentIntro(mode);
    else if(state.status==='done'){
      body=hasRows?renderDocumentTable(state.rows,mode,{hasMore:state.hasMore}):`<div class="global-search-source-empty">לא נמצאו תוצאות ב־${label}.</div>`;
      if(hasRows&&(state.loadingMore||state.hasMore))body+=state.loadingMore?'<div class="document-search-load-more loading"><span class="document-search-spinner">⌕</span>טוען עוד תוצאות…</div>':`<div class="document-search-load-more" data-document-load-more="${esc(mode)}">גלול להמשך התוצאות</div>`;
    }else body=raw?'<div class="global-search-source-empty">החיפוש המקומי עדיין לא הופעל.</div>':documentIntro(mode);
    const header=hasRows?'':sourceHeader(label,count,{loading:state.status==='loading'}),notice=providerNoticeHtml();
    return {total:count,settledEmpty:state.status==='done'&&count===0,html:`<section class="global-search-source-section" data-search-source="${esc(mode)}">${header}<div class="global-search-source-body">${notice}${body}</div></section>`};
  }
  function updateMeta(siteTotal,documentTotal,loading){const {meta}=refs();if(!meta)return;const total=siteTotal+documentTotal;if(loading){meta.textContent=total?`${total} תוצאות עד כה · החיפוש דרך ${documentProviderLabel()} ממשיך…`:`מחפש דרך ${documentProviderLabel()}…`;return}meta.textContent=total?`${total} תוצאות`:'לא נמצאו תוצאות'}
  function recentDocumentLabel(){const type=documentFileType.value();return type==='all'?'פריטים אחרונים':type==='folders'?'תיקיות אחרונות':'קבצים אחרונים'}
  function recentDocumentEmptyLabel(){const type=documentFileType.value();return type==='all'?'לא נמצאו פריטים':type==='folders'?'לא נמצאו תיקיות':'לא נמצאו קבצים'}
  function renderRecentDocuments(){
    const {results,meta}=refs();if(!results)return;resultByKey=new Map();documentResultByKey=new Map();
    if(!includesRecentDocuments()){setPreviewLayout(false);if(meta)meta.textContent='';results.innerHTML=filter==='content'?documentIntro('content'):scopeIntro();return}
    const state=recentDocumentState,rows=sortedDocumentRows(state.rows,recentDocumentSort);let body='';
    if(state.status==='loading')body=`<div class="global-search-source-progress"><span class="document-search-spinner">⌕</span>טוען ${esc(recentDocumentLabel())} מ־${esc(documentProviderLabel())}…</div>`;
    else if(state.status==='pairing')body=documentPairing();
    else if(state.status==='unavailable'||state.status==='error')body=documentErrorHtml(state.error||{message:'רכיב החיפוש המקומי אינו זמין.'});
    else if(state.status==='done'&&rows.length)body=renderDocumentTable(rows,'everything',{label:recentDocumentLabel(),hint:'לחיצה על כותרת ממיינת · לחיצה אחת לתצוגה · לחיצה כפולה לפתיחה',sortScope:'recent',sort:recentDocumentSort});
    else if(state.status==='done')body=`<div class="global-search-source-empty">${esc(recentDocumentEmptyLabel())} ב־${esc(documentProviderLabel())}.</div>`;
    else body='<div class="global-search-source-progress"><span class="document-search-spinner">⌕</span>טוען קבצים אחרונים…</div>';
    results.innerHTML=`<section class="global-search-source-section" data-search-source="recent"><div class="global-search-source-body">${providerNoticeHtml()}${state.status==='pairing'?'':localBridgePairingReminder()}${body}</div></section>`;
    setPreviewLayout(rows.length>0);if(selectedDocumentKey&&!documentResultByKey.has(selectedDocumentKey))resetDocumentPreview();
    if(meta)meta.textContent=state.status==='loading'?`טוען ${recentDocumentLabel()}…`:rows.length?`${rows.length} ${recentDocumentLabel()}`:state.status==='done'?recentDocumentEmptyLabel():'';
  }
  function renderCombinedResults(value=''){
    const {results}=refs();if(!results)return;documentContentOptions.update();documentFolderScope.update();const raw=String(value||'').trim();resultByKey=new Map();documentResultByKey=new Map();if(!raw){renderRecentDocuments();return}
    const sections=[];let siteTotal=0,documentTotal=0,loading=false;const hideEmptySources=filter==='all';
    if(includesSite()){const site=renderSiteSource(raw);siteTotal=site.total;if(!hideEmptySources||!site.settledEmpty)sections.push(site.html)}
    const documentModes=requestedDocumentModes(),hasPairingState=documentModes.some(mode=>documentStates[mode].status==='pairing'),localPairingReminder=hasPairingState?'':localBridgePairingReminder();
    if(localPairingReminder)sections.push(`<section class="global-search-source-section document-search-local-pairing-section" data-search-source="local-pairing"><div class="global-search-source-body">${localPairingReminder}</div></section>`);
    for(const mode of documentModes){const source=renderDocumentSource(mode,raw);documentTotal+=source.total;loading=loading||documentStates[mode].status==='loading'||documentStates[mode].loadingMore;if(!hideEmptySources||!source.settledEmpty)sections.push(source.html)}
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
      const data=await documentBridge.recent({limit:RECENT_DOCUMENT_LIMIT,scopePath:documentFolderScope.path,fileType:documentFileType.value(),signal:controller.signal});if(controller.signal.aborted||sequence!==documentSequence||activeQuery||!includesRecentDocuments())return;
      recentDocumentState={status:'done',rows:Array.isArray(data.results)?data.results:[],error:null,elapsedMs:Math.max(0,Number(data.elapsedMs)||0),loadedAt:Date.now()};renderCombinedResults('');
    }catch(error){if(controller.signal.aborted||sequence!==documentSequence||error?.code==='DOCUMENT_BRIDGE_ABORTED'||activeQuery)return;if(String(error?.code)==='UNAUTHORIZED')documentBridge.setToken?.('');recentDocumentState={...emptyRecentDocumentState(),status:documentAuthError(error)?'pairing':'error',error};renderCombinedResults('')}
    finally{if(documentAbort===controller)documentAbort=null}
  }
  async function runDocumentSearchMode(value='',mode='everything'){
    const raw=String(value||'').trim(),sequence=documentSequence;if(!raw||raw!==activeQuery||!includesDocumentMode(mode)||documentStates[mode]?.status!=='loading')return;
    const controller=documentSearchLanes.begin(mode);
    try{
      const data=await documentBridge.search(raw,{mode,contentSearch:mode==='content'?documentContentOptions.value():undefined,scopePath:documentFolderScope.path,fileType:documentFileType.value(),limit:DOCUMENT_RESULT_BATCH,offset:0,sort:documentSorts[mode],signal:controller.signal});if(controller.signal.aborted||sequence!==documentSequence||raw!==activeQuery||!includesDocumentMode(mode))return;const rows=Array.isArray(data.results)?data.results:[];documentStates[mode]={mode,status:'done',rows,error:null,elapsedMs:Math.max(0,Number(data.elapsedMs)||0),hasMore:!!data.hasMore&&rows.length<DOCUMENT_RESULT_MAX,loadingMore:false,partial:!!data.partial};renderCombinedResults(raw);
    }catch(error){if(controller.signal.aborted||sequence!==documentSequence||error?.code==='DOCUMENT_BRIDGE_ABORTED'||raw!==activeQuery)return;if(String(error?.code)==='UNAUTHORIZED')documentBridge.setToken?.('');documentStates[mode]={...emptyDocumentState(mode),status:documentAuthError(error)?'pairing':'error',error};renderCombinedResults(raw)}
    finally{documentSearchLanes.clear(mode,controller)}
  }
  async function loadMoreDocumentResults(requestedMode=''){
    const raw=String(activeQuery||'').trim(),sequence=documentSequence;if(!raw||documentPageAbort)return;const modes=requestedDocumentModes().filter(mode=>(!requestedMode||mode===requestedMode)&&documentStates[mode].status==='done'&&documentStates[mode].hasMore&&!documentStates[mode].loadingMore&&documentStates[mode].rows.length<DOCUMENT_RESULT_MAX);if(!modes.length)return;
    const controller=new AbortController();documentPageAbort=controller;for(const mode of modes)documentStates[mode]={...documentStates[mode],loadingMore:true};renderCombinedResults(raw);
    await Promise.all(modes.map(async mode=>{const before=documentStates[mode],offset=before.rows.length,limit=Math.min(DOCUMENT_RESULT_BATCH,DOCUMENT_RESULT_MAX-offset);try{const data=await documentBridge.search(raw,{mode,contentSearch:mode==='content'?documentContentOptions.value():undefined,scopePath:documentFolderScope.path,fileType:documentFileType.value(),limit,offset,sort:documentSorts[mode],signal:controller.signal});if(controller.signal.aborted||sequence!==documentSequence||raw!==activeQuery||!includesDocumentMode(mode))return;const incoming=Array.isArray(data.results)?data.results:[],rows=appendUniqueDocumentRows(before.rows,incoming),madeProgress=rows.length>before.rows.length;documentStates[mode]={mode,status:'done',rows,error:null,elapsedMs:Math.max(before.elapsedMs||0,Number(data.elapsedMs)||0),hasMore:!!data.hasMore&&madeProgress&&rows.length<DOCUMENT_RESULT_MAX,loadingMore:false};renderCombinedResults(raw)}catch(error){if(controller.signal.aborted||sequence!==documentSequence||error?.code==='DOCUMENT_BRIDGE_ABORTED'||raw!==activeQuery)return;documentStates[mode]={...before,loadingMore:false,hasMore:false,error};renderCombinedResults(raw)}}));
    if(documentPageAbort===controller)documentPageAbort=null;queueMicrotask(()=>maybeLoadMoreDocumentResults());
  }
  function applyDocumentSort(scope,field){
    const target=String(scope||'');if(!DOCUMENT_SORT_FIELDS.has(String(field||'')))return false;
    if(target==='recent'){recentDocumentSort=nextDocumentSort(recentDocumentSort,String(field));renderRecentDocuments();return true}
    if(target!=='everything'&&target!=='content')return false;documentSorts[target]=nextDocumentSort(documentSorts[target],String(field));
    const raw=String(activeQuery||'').trim();if(!raw){renderCombinedResults('');return true}
    documentPageAbort?.abort();documentPageAbort=null;for(const mode of ['everything','content'])if(documentStates[mode])documentStates[mode]={...documentStates[mode],loadingMore:false};
    const previous=documentStates[target]||emptyDocumentState(target);documentStates[target]={...emptyDocumentState(target),status:'loading',partial:previous.partial};renderCombinedResults(raw);documentSearchLanes.schedule(target,raw);return true;
  }
  function loadMoreSiteResults(){if(!activeQuery||!includesSite()||siteResultLimit>=SITE_RESULT_MAX)return false;siteResultLimit=Math.min(SITE_RESULT_MAX,siteResultLimit+SITE_RESULT_BATCH);renderCombinedResults(activeQuery);queueMicrotask(()=>maybeLoadMoreDocumentResults());return true}
  function loadMoreSentinelInRange(results,selector){const rootRect=results.getBoundingClientRect?.();if(!rootRect)return null;const minTop=rootRect.top-DOCUMENT_LOAD_MORE_THRESHOLD_PX,maxTop=rootRect.bottom+DOCUMENT_LOAD_MORE_THRESHOLD_PX;return [...results.querySelectorAll(selector)].find(node=>{const rect=node.getBoundingClientRect?.();return !!rect&&rect.top>=minTop&&rect.top<=maxTop})||null}
  function maybeLoadMoreDocumentResults(){const {results}=refs();if(!results||!activeQuery||documentPageAbort)return;const siteSentinel=loadMoreSentinelInRange(results,'[data-site-load-more]');if(siteSentinel&&loadMoreSiteResults())return;const documentSentinel=loadMoreSentinelInRange(results,'[data-document-load-more]');if(!documentSentinel)return;const mode=String(documentSentinel.dataset.documentLoadMore||'');if(mode)void loadMoreDocumentResults(mode)}
  function updateFilterUi(){
    const {filterAll,filterSite,filterFiles,filterContent,input}=refs();const buttons=[[filterAll,'all'],[filterSite,'site'],[filterFiles,'files'],[filterContent,'content']];for(const [button,key] of buttons){button?.classList.toggle('active',filter===key);button?.setAttribute('aria-selected',filter===key?'true':'false')}
    if(input)input.placeholder=filter==='site'?'חפש באתר…':filter==='files'?'חפש קובץ או תיקייה…':filter==='content'?'חפש טקסט בתוך תוכן הקבצים…':'חפש באתר, בקבצים ובתוכן…';
    documentContentOptions.update();documentFolderScope.update();documentFileType.update();
  }
  function setFilter(next){const normalized=SEARCH_FILTERS.has(next)?next:'all';if(filter===normalized)return;hideDocumentContextMenu();filter=normalized;siteResultLimit=SITE_RESULT_BATCH;cancelScheduledDocumentSearches();documentSequence+=1;documentAbort?.abort();documentAbort=null;abortDocumentModeSearches();documentPageAbort?.abort();documentPageAbort=null;resetDocumentPreview();updateFilterUi();renderResults(refs().input?.value||'');requestAnimationFrame(()=>refs().input?.focus())}
  function setMode(next){setFilter(next==='documents'?'files':'site')}
  function renderResults(value=''){
    hideDocumentContextMenu();
    const raw=String(value||'').trim();cancelScheduledDocumentSearches();documentSequence+=1;documentAbort?.abort();documentAbort=null;abortDocumentModeSearches();documentPageAbort?.abort();documentPageAbort=null;if(raw!==activeQuery){activeQuery=raw;siteResultLimit=SITE_RESULT_BATCH;resetDocumentPreview()}
    if(!raw){documentStates={everything:emptyDocumentState('everything'),content:emptyDocumentState('content')};const shouldLoadRecent=prepareRecentDocuments();renderCombinedResults('');if(shouldLoadRecent)runRecentDocuments(documentSequence);return}
    const shouldSearchDocuments=prepareDocumentStates(raw);renderCombinedResults(raw);if(shouldSearchDocuments){if(documentStates.everything.status==='loading')documentSearchLanes.schedule('everything',raw);if(documentStates.content.status==='loading')documentSearchLanes.schedule('content',raw)}
  }
  function open(){const {backdrop,input,trigger}=refs();if(!backdrop)return;hideDocumentContextMenu();backdrop.hidden=false;backdrop.setAttribute('aria-hidden','false');trigger?.setAttribute('aria-expanded','true');warmDocumentSearchBridge();getPdfIndexRefresh().show();updateFilterUi();renderResults(input?.value||'');requestAnimationFrame(()=>input?.focus())}
  function close({restoreFocus=true}={}){const {backdrop,trigger}=refs();if(!backdrop)return;hideDocumentContextMenu();pdfIndexRefresh?.hide();cancelScheduledDocumentSearches();documentSequence+=1;documentAbort?.abort();documentAbort=null;abortDocumentModeSearches();documentPageAbort?.abort();documentPageAbort=null;resetDocumentPreview();backdrop.hidden=true;backdrop.setAttribute('aria-hidden','true');trigger?.setAttribute('aria-expanded','false');if(restoreFocus)requestAnimationFrame(()=>trigger?.focus())}
  function toggle(){const {backdrop}=refs();if(!backdrop)return;backdrop.hidden?open():close()}
  function flushCurrent(){return documentSearchLanes.flush()}

  function openResult(key){const item=resultByKey.get(key);if(!item)return;close({restoreFocus:false});navigateSiteItem?.(item)}
  async function openDocumentResult(id,button){if(!documentBridge||!id)return;const previous=button?.disabled;if(button)button.disabled=true;try{await documentBridge.openDocument(id)}catch(error){const {meta}=refs();if(meta)meta.textContent=error?.message||'פתיחת הקובץ נכשלה'}finally{if(button)button.disabled=!!previous}}
  async function revealDocumentResult(id,button){if(!documentBridge?.revealDocument||!id)return;const previous=button?.disabled;if(button)button.disabled=true;try{await documentBridge.revealDocument(id)}catch(error){const {meta}=refs();if(meta)meta.textContent=error?.message||'פתיחת מיקום הקובץ נכשלה'}finally{if(button)button.disabled=!!previous}}
  function removeDeletedDocumentResults(ids){
    const removed=new Set((Array.isArray(ids)?ids:[ids]).map(String).filter(Boolean));if(!removed.size)return;cancelScheduledDocumentSearches();documentSequence+=1;documentAbort?.abort();documentAbort=null;abortDocumentModeSearches();
    const strip=rows=>(Array.isArray(rows)?rows:[]).filter(row=>!removed.has(String(row?.id||''))),settle=state=>state.status==='loading'?{...state,status:'done'}:state;
    recentDocumentState=settle({...recentDocumentState,rows:strip(recentDocumentState.rows),loadedAt:0});for(const mode of ['everything','content'])documentStates[mode]=settle({...documentStates[mode],rows:strip(documentStates[mode].rows)});
    if(removed.has(String(selectedDocumentId||'')))resetDocumentPreview();const raw=String(refs().input?.value||'').trim();raw?renderCombinedResults(raw):renderRecentDocuments();
  }
  async function deleteDocumentResult(id,button,mode=button?.dataset.documentSearchMode||'everything'){
    const key=button?.dataset.documentResultKey||`${mode==='content'?'content':'everything'}:${id}`;
    return deleteLocalDocumentResult({id,button,item:documentResultByKey.get(key),bridge:documentBridge,confirmDialog,
      beforeDelete:async()=>{hideDocumentContextMenu();deactivateNativePreview();previewAbort?.abort();previewMatchesAbort?.abort();try{await documentBridge.hideNativePreview?.()}catch{}},
      afterDelete:ids=>{removeDeletedDocumentResults(ids);requestAnimationFrame(()=>refs().results?.querySelector('.global-search-result')?.focus?.()||refs().input?.focus())},
      showStatus:message=>{const {meta}=refs();if(meta)meta.textContent=message}});
  }
  async function connectDocumentSearch(){if(!documentBridge?.beginConnect)return;const {meta}=refs();if(meta)meta.textContent='מעביר להרשאת Google Drive…';try{await documentBridge.beginConnect({returnUrl:globalThis.location?.href||''})}catch(error){if(meta)meta.textContent=error?.message||'חיבור Google Drive נכשל'}}
  async function pairDocumentBridge(){
    if(!documentBridge)return;const token=String(byId('globalSearchDocumentToken')?.value||'').trim();if(!token)return;documentBridge.setToken(token);const {meta,input}=refs();if(meta)meta.textContent='בודק את החיבור המקומי…';
    try{const status=await (documentBridge.localStatus?.()||documentBridge.status());const index=status.index||{},files=Number(index.fileCount)||0,indexed=Number(index.indexedContentCount)||0;if(meta)meta.textContent=`מחובר ל-Everything ${status.everythingVersion||''} · ${files} קבצים באינדקס · ${indexed} עם תוכן מאונדקס`;getPdfIndexRefresh().show();renderResults(input?.value||'')}
    catch(error){if(String(error?.code)==='UNAUTHORIZED')documentBridge.setToken('');for(const mode of requestedDocumentModes())documentStates[mode]={...emptyDocumentState(mode),status:'error',error};renderCombinedResults(input?.value||'')}
  }

  function bind(){
    const {trigger,backdrop,input,results,close:closeButton,filterAll,filterSite,filterFiles,filterContent,folderPick,folderClear,previewMatches,splitter,workspace}=refs();if(!trigger||!backdrop||!input||!results||!closeButton)return;
    trigger.addEventListener('click',toggle);closeButton.addEventListener('click',close);filterAll?.addEventListener('click',()=>setFilter('all'));filterSite?.addEventListener('click',()=>setFilter('site'));filterFiles?.addEventListener('click',()=>setFilter('files'));filterContent?.addEventListener('click',()=>setFilter('content'));folderPick?.addEventListener('click',()=>{void documentFolderScope.choose()});folderClear?.addEventListener('click',documentFolderScope.clear);input.addEventListener('input',()=>renderResults(input.value));
    documentContentOptions.bind();
    documentFileType.bind();
    getPdfIndexRefresh().bind();
    input.addEventListener('keydown',event=>{if(event.key==='ArrowDown'){flushCurrent();const first=results.querySelector('.global-search-result');if(first){event.preventDefault();first.focus()}}});
    results.addEventListener('keydown',event=>{if(!event.target.matches('.global-search-result'))return;if(event.key==='ArrowDown'||event.key==='ArrowUp'){const buttons=[...results.querySelectorAll('.global-search-result')],index=buttons.indexOf(event.target),next=event.key==='ArrowDown'?Math.min(buttons.length-1,index+1):Math.max(0,index-1);event.preventDefault();hideDocumentContextMenu();buttons[next]?.focus();if(buttons[next]?.dataset.documentResultId)selectDocumentResult(buttons[next].dataset.documentResultId,buttons[next],buttons[next].dataset.documentSearchMode)}else if(event.key==='Enter'&&event.target.dataset.documentResultId){event.preventDefault();hideDocumentContextMenu();openDocumentResult(event.target.dataset.documentResultId,event.target)}else if(event.key==='Delete'&&event.target.dataset.documentResultId&&!event.shiftKey&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&hasLocalDocumentActions()){event.preventDefault();void deleteDocumentResult(event.target.dataset.documentResultId,event.target,event.target.dataset.documentSearchMode)}else if((event.key==='ContextMenu'||(event.shiftKey&&event.key==='F10'))&&event.target.dataset.documentResultId&&hasLocalDocumentActions()){event.preventDefault();showDocumentContextMenu(event.target)}else if(event.key==='Escape'){if(hideDocumentContextMenu())event.preventDefault();else close()}});
    results.addEventListener('click',event=>{const connect=event.target.closest('[data-document-connect]');if(connect){connectDocumentSearch();return}const pair=event.target.closest('[data-document-pair]');if(pair){pairDocumentBridge();return}const sortButton=event.target.closest('[data-document-sort-field]');if(sortButton){applyDocumentSort(sortButton.dataset.documentSortScope,sortButton.dataset.documentSortField);return}const documentButton=event.target.closest('[data-document-result-id]');if(documentButton){selectDocumentResult(documentButton.dataset.documentResultId,documentButton,documentButton.dataset.documentSearchMode);return}const button=event.target.closest('[data-global-result-key]');if(button)openResult(button.dataset.globalResultKey)});
    results.addEventListener('dblclick',event=>{const documentButton=event.target.closest('[data-document-result-id]');if(documentButton){event.preventDefault();openDocumentResult(documentButton.dataset.documentResultId,documentButton)}});
    results.addEventListener('contextmenu',event=>{const documentButton=event.target.closest('[data-document-result-id]');if(!documentButton||!hasLocalDocumentActions())return;event.preventDefault();showDocumentContextMenu(documentButton,{clientX:event.clientX,clientY:event.clientY})});
    results.addEventListener('scroll',()=>{hideDocumentContextMenu();maybeLoadMoreDocumentResults()},{passive:true});
    previewMatches?.addEventListener('click',event=>{const snippets=previewMatchInfo?.snippets||[];if(!previewSearchViewer&&!snippets.length)return;const previous=event.target.closest('[data-preview-match-prev]'),next=event.target.closest('[data-preview-match-next]');if(!previous&&!next)return;if(previewSearchViewer){previous?previewSearchViewer.previous():previewSearchViewer.next();return}const current=Number(previewMatches.dataset.matchIndex)||0;if(previous)showPreviewMatch((current-1+snippets.length)%snippets.length);else showPreviewMatch((current+1)%snippets.length)});
    if(splitter&&workspace){let resizing=false;const updateFromPointer=event=>{if(!resizing)return;const rect=workspace.getBoundingClientRect();if(!rect.width)return;applyPreviewWidth((event.clientX-rect.left)/rect.width*100)};const finish=event=>{if(!resizing)return;resizing=false;splitter.classList.remove('dragging');try{splitter.releasePointerCapture?.(event.pointerId)}catch{}const current=parseFloat(workspace.style.getPropertyValue('--document-preview-width'))||DOCUMENT_PREVIEW_DEFAULT;applyPreviewWidth(current,{save:true})};splitter.addEventListener('pointerdown',event=>{if(splitter.hidden)return;resizing=true;splitter.classList.add('dragging');splitter.setPointerCapture?.(event.pointerId);updateFromPointer(event);event.preventDefault()});splitter.addEventListener('pointermove',updateFromPointer);splitter.addEventListener('pointerup',finish);splitter.addEventListener('pointercancel',finish);splitter.addEventListener('keydown',event=>{if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight'&&event.key!=='Home'&&event.key!=='End')return;event.preventDefault();const current=parseFloat(workspace.style.getPropertyValue('--document-preview-width'))||savedPreviewWidth();const next=event.key==='Home'?DOCUMENT_PREVIEW_MIN:event.key==='End'?DOCUMENT_PREVIEW_MAX:current+(event.key==='ArrowRight'?3:-3);applyPreviewWidth(next,{save:true})})}
    results.addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target.id==='globalSearchDocumentToken'){event.preventDefault();pairDocumentBridge()}});
    backdrop.addEventListener('pointerdown',event=>{backdropPointerId=event.target===backdrop?event.pointerId:null});backdrop.addEventListener('pointerup',event=>{const dismiss=backdropPointerId===event.pointerId&&event.target===backdrop;backdropPointerId=null;if(dismiss)close()});backdrop.addEventListener('pointercancel',()=>{backdropPointerId=null});
    warmDocumentSearchBridge();
    window.addEventListener('resize',()=>{hideDocumentContextMenu();syncNativePreviewGeometry({force:true})});window.addEventListener('focus',()=>{if(nativePreviewActive)syncNativePreviewGeometry({force:true})});document.addEventListener('pointerdown',event=>{if(!documentMenu.contains(event.target))hideDocumentContextMenu()});document.addEventListener('visibilitychange',()=>{if(document.hidden){hideDocumentContextMenu();if(nativePreviewActive)deactivateNativePreview({forget:false});return}if(nativePreviewWantedId&&selectedDocumentId===nativePreviewWantedId&&!backdrop.hidden){const sequence=previewSequence;showNativePreview(nativePreviewWantedId,sequence).catch(()=>{})}});document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();hideDocumentContextMenu();open();return}if(event.key==='Escape'&&!backdrop.hidden){if(hideDocumentContextMenu()){event.preventDefault();return}close()}});
  }

  return{bind,open,close,toggle,renderResults,openResult,navigateItem:navigateSiteItem,setMode,setFilter};
}
