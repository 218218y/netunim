import {createSearchFragmentIndex} from '../shared/search-fragments.js';
import {esc} from '../core/values.js';
import {money} from '../core/money.js';
import {buildOrderSearchFragment,ORDER_SEARCH_FRAGMENTS,searchGlobalEntries} from '../domains/search/model.js';
import {checkIsClosedStatus} from '../domains/checks/model.js';
import {customerDebtProgressData} from '../shared/customer-debt-progress.js';
import {createSearchScheduler} from '../shared/search-scheduler.js';

const DOCUMENT_SEARCH_DELAY_MS=200;
const DOCUMENT_PREVIEW_WIDTH_KEY='netunim_orders_document_preview_width_v1';
const DOCUMENT_PREVIEW_DEFAULT=58;
const DOCUMENT_PREVIEW_MIN=32;
const DOCUMENT_PREVIEW_MAX=72;

// Global search is a UI coordinator. Site data stays in domains/search/model.js.
// Local file/content search is deliberately isolated behind Document Bridge and is
// activated only in its dedicated scope, so it never blocks the normal site search.
export function createUiGlobalSearch({documentBridge=null,searchRevision,model,ui,notesUi={},supplierUi,customerUi,serviceUi,warehouseUi,prepareView,render,openInventoryItemModal}){
  let resultByKey=new Map(),documentResultById=new Map(),highlightTimer=null,backdropPointerId=null,mode='site',documentSearchMode='everything',documentSequence=0,documentAbort=null,selectedDocumentId='',previewSequence=0,previewObjectUrl='',previewAbort=null,nativePreviewActive=false,nativePreviewWantedId='',nativePreviewGeometryKey='',nativePreviewPoll=null;
  const byId=id=>document.getElementById(id);
  const refs=()=>({trigger:byId('globalSearchButton'),backdrop:byId('globalSearchBackdrop'),dialog:byId('globalSearchBackdrop')?.querySelector('.global-search-dialog'),workspace:byId('globalSearchWorkspace'),input:byId('globalSearchInput'),results:byId('globalSearchResults'),meta:byId('globalSearchMeta'),close:byId('globalSearchClose'),siteMode:byId('globalSearchSiteMode'),documentsMode:byId('globalSearchDocumentsMode'),documentModebar:byId('globalSearchDocumentModebar'),documentContentMode:byId('globalSearchDocumentContentMode'),documentNameMode:byId('globalSearchDocumentNameMode'),preview:byId('globalSearchDocumentPreview'),previewTitle:byId('globalSearchPreviewTitle'),previewMeta:byId('globalSearchPreviewMeta'),previewBody:byId('globalSearchPreviewBody'),previewOpen:byId('globalSearchPreviewOpen'),splitter:byId('globalSearchDocumentSplitter')});
  const scheduledSiteRender=createSearchScheduler(value=>renderSiteResults(value));
  const scheduledDocumentRender=createSearchScheduler(value=>renderDocumentResults(value),{delay:DOCUMENT_SEARCH_DELAY_MS});
  const indexedEntries=createSearchFragmentIndex({fragments:Object.keys(ORDER_SEARCH_FRAGMENTS),revision:name=>name==='notes'&&model.state.notesSheet?null:searchRevision?.(ORDER_SEARCH_FRAGMENTS[name],name),build:name=>buildOrderSearchFragment(model.state,name)});

  function scopeIntro(){return `<div class="global-search-empty"><div class="global-search-empty-icon">⌕</div><b>חיפוש בכל מאגר ניהול ההזמנות</b><p>אפשר לחפש שם ספק או לקוח, מספר הזמנה, טלפון, מספר צ'ק, סכום, הערה, מיקום, תוכן שירות ועוד.</p><div class="global-search-scopes"><span>ספקים</span><span>לקוחות</span><span>שירות</span><span>צ'קים</span><span>מחסן ומלאי</span><span>הערות</span></div></div>`}
  function documentPairing(){return `<div class="global-search-empty document-search-setup"><div class="global-search-empty-icon">⌕</div><b>חיפוש מסמכים במחשב זה</b><p>Document Bridge עדיין לא משויך לדפדפן הזה. מתקינים אותו בנפרד בכל מחשב; המפתח שהמתקין מעתיק ללוח נשמר רק בדפדפן המקומי.</p><div class="document-search-pair"><input id="globalSearchDocumentToken" type="password" autocomplete="off" spellcheck="false" placeholder="הדבק מפתח Document Bridge"><button type="button" data-document-pair>חבר מחשב</button></div><small>הקבצים ותוכן החיפוש נשארים במחשב ואינם מועלים לאתר או לענן.</small></div>`}
  function documentIntro(){const content=documentSearchMode==='content';return `<div class="global-search-empty document-search-intro"><div class="global-search-empty-icon">FILE</div><b>${content?'חיפוש תוכן':'חיפוש קבצים'}</b><p>${content?'חיפוש מילים בתוך תוכן הקבצים דרך Everything.':'חיפוש קבצים ותיקיות דרך אותו אינדקס ותחביר של Everything.'}</p><div class="global-search-scopes"><span>${content?'חיפוש תוכן':'חיפוש קבצים'}</span><span>כל האינדקס</span><span>Unicode מלא</span></div></div>`}

  function resultMeta(item){const parts=[...(item.meta||[])];if(item.amount!==undefined&&item.amount!==null&&Number.isFinite(Number(item.amount)))parts.unshift(money(item.amount));return parts.filter(Boolean)}
  function bytes(value){const size=Number(value);if(!Number.isFinite(size)||size<0)return '';if(size<1024)return `${size} B`;if(size<1024*1024)return `${Math.round(size/1024)} KB`;return `${(size/1024/1024).toFixed(size<10*1024*1024?1:0)} MB`}
  function localDate(value){const time=Date.parse(value||'');if(!Number.isFinite(time))return '';try{return new Intl.DateTimeFormat('he-IL',{dateStyle:'short',timeStyle:'short'}).format(new Date(time))}catch{return ''}}
  function cleanupPreviewObject(){if(previewObjectUrl){URL.revokeObjectURL(previewObjectUrl);previewObjectUrl=''}}
  function nativePreviewGeometry(){
    const {previewBody}=refs();if(!previewBody||previewBody.hidden)return null;const rect=previewBody.getBoundingClientRect();if(rect.width<80||rect.height<80)return null;
    const sideInset=Math.max(0,(Number(window.outerWidth)||0)-(Number(window.innerWidth)||0))/2;
    const topInset=Math.max(0,(Number(window.outerHeight)||0)-(Number(window.innerHeight)||0)-sideInset);
    return {x:Math.round((Number(window.screenX)||0)+sideInset+rect.left),y:Math.round((Number(window.screenY)||0)+topInset+rect.top),width:Math.round(rect.width),height:Math.round(rect.height)};
  }
  function nativeGeometryKey(value){return value?`${value.x}:${value.y}:${value.width}:${value.height}`:''}
  function stopNativePreviewPolling(){if(nativePreviewPoll){clearInterval(nativePreviewPoll);nativePreviewPoll=null}}
  function deactivateNativePreview({forget=true}={}){
    nativePreviewActive=false;nativePreviewGeometryKey='';stopNativePreviewPolling();if(forget)nativePreviewWantedId='';
    documentBridge?.hideNativePreview?.().catch(()=>{});
  }
  async function syncNativePreviewGeometry({force=false}={}){
    if(!nativePreviewActive||!documentBridge?.moveNativePreview)return;const geometry=nativePreviewGeometry();if(!geometry)return;const key=nativeGeometryKey(geometry);if(!force&&key===nativePreviewGeometryKey)return;
    nativePreviewGeometryKey=key;try{await documentBridge.moveNativePreview(geometry)}catch{}
  }
  function startNativePreviewPolling(){stopNativePreviewPolling();nativePreviewPoll=setInterval(()=>{syncNativePreviewGeometry()},350)}
  async function showNativePreview(id,sequence){
    if(!documentBridge?.nativePreview)return false;const geometry=nativePreviewGeometry();if(!geometry)throw new Error('אזור התצוגה המקדימה אינו זמין.');nativePreviewWantedId=String(id);
    await documentBridge.nativePreview(id,geometry);if(sequence!==previewSequence||selectedDocumentId!==String(id)){documentBridge.hideNativePreview?.().catch(()=>{});return false}
    nativePreviewActive=true;nativePreviewGeometryKey=nativeGeometryKey(geometry);startNativePreviewPolling();return true
  }
  function resetDocumentPreview(){
    previewSequence+=1;previewAbort?.abort();previewAbort=null;cleanupPreviewObject();deactivateNativePreview();selectedDocumentId='';
    const {previewTitle,previewMeta,previewBody,previewOpen}=refs();if(previewTitle)previewTitle.textContent='תצוגה מקדימה';if(previewMeta)previewMeta.textContent='בחר תוצאה לצפייה';if(previewOpen)previewOpen.disabled=true;if(previewBody)previewBody.innerHTML='<div class="document-preview-empty"><span>⌕</span><b>תצוגה מקדימה</b><p>לחיצה אחת על תוצאה תציג אותה כאן. לחיצה כפולה תפתח אותה במחשב.</p></div>';
  }
  function fileKindLabel(item){if(item?.isDirectory)return 'תיקייה';const ext=String(item?.extension||'').toUpperCase();return ext||'קובץ'}
  function documentIconKind(item){
    if(item?.isDirectory)return 'folder';
    const ext=String(item?.extension||'').toLowerCase();
    if(ext==='pdf')return 'pdf';
    if(['doc','docx','docm','dot','dotx','rtf'].includes(ext))return 'word';
    if(['xls','xlsx','xlsm','xlsb','csv'].includes(ext))return 'excel';
    if(['ppt','pptx','pptm','pps','ppsx'].includes(ext))return 'powerpoint';
    if(['txt','md','log','ini','json','xml','html','htm','css','js','mjs','ts','csv'].includes(ext))return 'text';
    if(['jpg','jpeg','png','gif','bmp','webp','svg','tif','tiff'].includes(ext))return 'image';
    if(['zip','7z','rar','tar','gz'].includes(ext))return 'archive';
    return 'file';
  }
  function renderDocumentTable(rows){
    documentResultById=new Map(rows.map(item=>[String(item.id),item]));
    const header='<div class="document-results-head" aria-hidden="true"><span>שם</span><span>נתיב</span><span>גודל</span><span>עודכן</span></div>';
    const body=rows.map(item=>{const icon=documentIconKind(item);return `<button class="global-search-result document-search-row" type="button" data-document-result-id="${esc(item.id)}" title="לחיצה: תצוגה מקדימה · לחיצה כפולה: פתיחה במחשב"><span class="document-result-name"><i class="document-result-icon ${esc(icon)}" aria-hidden="true"></i><span><b>${esc(item.name||(item.isDirectory?'תיקייה':'קובץ'))}</b><small>${esc(fileKindLabel(item))}</small></span></span><span class="document-result-path">${esc(item.relativePath||'')}</span><span class="document-result-size">${item.isDirectory?'—':esc(bytes(item.size)||'—')}</span><span class="document-result-date">${esc(localDate(item.modified)||'—')}</span></button>`}).join('');
    return `<section class="document-results-table"><div class="document-results-summary"><b>תוצאות Everything</b><span>${esc(rows.length)}</span><small>לחיצה אחת לתצוגה · לחיצה כפולה לפתיחה</small></div>${header}<div class="document-results-body">${body}</div></section>`
  }
  function clampPreviewWidth(value){const n=Number(value);return Math.max(DOCUMENT_PREVIEW_MIN,Math.min(DOCUMENT_PREVIEW_MAX,Number.isFinite(n)?n:DOCUMENT_PREVIEW_DEFAULT))}
  function savedPreviewWidth(){try{const value=localStorage.getItem(DOCUMENT_PREVIEW_WIDTH_KEY);return value===null?DOCUMENT_PREVIEW_DEFAULT:clampPreviewWidth(value)}catch{return DOCUMENT_PREVIEW_DEFAULT}}
  function applyPreviewWidth(value,{save=false}={}){const width=clampPreviewWidth(value),{workspace,splitter}=refs();workspace?.style.setProperty('--document-preview-width',`${width}%`);splitter?.setAttribute('aria-valuenow',String(Math.round(width)));if(save)try{localStorage.setItem(DOCUMENT_PREVIEW_WIDTH_KEY,String(width))}catch{}if(nativePreviewActive)queueMicrotask(()=>syncNativePreviewGeometry({force:true}));return width}
  function previewDetailsHtml(data){const rows=[[data.isDirectory?'סוג':'סיומת',data.isDirectory?'תיקייה':(String(data.extension||'').toUpperCase()||'קובץ')],['גודל',data.isDirectory?'—':bytes(data.size)],['עודכן',localDate(data.modified)],['נתיב',data.fullPath]].filter(([,value])=>value);return `<dl class="document-preview-details">${rows.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>`}
  async function selectDocumentResult(id,button){
    if(!documentBridge||!id)return;deactivateNativePreview();selectedDocumentId=String(id);for(const row of refs().results?.querySelectorAll?.('[data-document-result-id]')||[])row.classList.toggle('selected',row===button);const item=documentResultById.get(String(id));const {previewTitle,previewMeta,previewBody,previewOpen}=refs();if(previewTitle)previewTitle.textContent=item?.name||'תצוגה מקדימה';if(previewMeta)previewMeta.textContent=item?.relativePath||'';if(previewOpen)previewOpen.disabled=false;cleanupPreviewObject();previewSequence+=1;const sequence=previewSequence;previewAbort?.abort();previewAbort=new AbortController();if(previewBody)previewBody.innerHTML='<div class="document-preview-loading"><span></span><b>טוען תצוגה מקדימה…</b></div>';
    try{
      const data=await documentBridge.preview(id);if(sequence!==previewSequence||selectedDocumentId!==String(id))return;if(previewTitle)previewTitle.textContent=data.name||item?.name||'תצוגה מקדימה';if(previewMeta)previewMeta.textContent=data.path||item?.relativePath||'';
      if(data.kind==='folder'){previewBody.innerHTML=`<div class="document-preview-folder"><div class="document-preview-folder-icon"></div><b>${esc(data.name||'תיקייה')}</b><p>לחיצה כפולה על התוצאה או הכפתור למעלה תפתח את התיקייה בסייר הקבצים.</p>${previewDetailsHtml(data)}</div>`;return}
      if(data.kind==='native'){previewBody.innerHTML='<div class="document-preview-native"><span>OFFICE</span><b>Windows Preview</b><p>נטענת התצוגה המקורית שמותקנת ב-Windows…</p></div>';await showNativePreview(id,sequence);return}
      if(data.kind==='binary'){
        const blob=await documentBridge.previewFile(id,{signal:previewAbort.signal});if(sequence!==previewSequence||selectedDocumentId!==String(id))return;previewObjectUrl=URL.createObjectURL(blob);previewBody.innerHTML=data.mime==='application/pdf'?`<div class="document-preview-pdf"><iframe class="document-preview-frame" src="${esc(previewObjectUrl)}#toolbar=0&navpanes=0&view=FitH" title="${esc(data.name||'PDF')}"></iframe></div>`:`<div class="document-preview-image"><img src="${esc(previewObjectUrl)}" alt="${esc(data.name||'תמונה')}"></div>`;return
      }
      if(data.kind==='text'){const source=data.source==='office-text-fallback'?'תצוגת Office מעוצבת לא הייתה זמינה · מוצג טקסט שחולץ':data.source==='everything-content'?'טקסט שחולץ על־ידי Everything':'קובץ טקסט';previewBody.innerHTML=`<div class="document-preview-text-head"><span>${esc(source)}</span>${data.truncated?'<em>תצוגה חלקית</em>':''}</div><pre class="document-preview-text">${esc(data.text||'')}</pre>`;return}
      previewBody.innerHTML=`<div class="document-preview-empty"><span>FILE</span><b>אין תצוגה מקדימה זמינה</b><p>אפשר לפתוח את הקובץ בתוכנה המותקנת במחשב בלחיצה כפולה או בכפתור “פתח במחשב”.</p>${previewDetailsHtml(data)}</div>`
    }catch(error){if(sequence!==previewSequence||error?.code==='DOCUMENT_BRIDGE_ABORTED')return;if(previewBody)previewBody.innerHTML=`<div class="document-preview-empty error"><span>!</span><b>התצוגה המקדימה נכשלה</b><p>${esc(error?.message||'לא ניתן להציג את הקובץ.')}</p></div>`}
  }

  function renderSiteResults(value=''){
    if(mode!=='site')return;
    const {results,meta}=refs();if(!results||!meta)return;
    const raw=String(value||'').trim();resultByKey=new Map();
    if(!raw){meta.textContent='';results.innerHTML=scopeIntro();return}
    const data=searchGlobalEntries(indexedEntries(),raw),visibleGroups=data.groups.filter(group=>group.total>0);meta.textContent=data.total?`${data.total} תוצאות בכל המאגרים`:'לא נמצאו תוצאות';
    if(!visibleGroups.length){results.innerHTML=`<div class="global-search-empty"><div class="global-search-empty-icon">∅</div><b>לא נמצאו תוצאות</b><p>החיפוש נבדק בכל ספקים, לקוחות, שירות, צ'קים, מחסן והערות.</p></div>`;return}
    results.innerHTML=visibleGroups.map(group=>{
      const rows=group.items.map((item,index)=>{const key=`${group.key}:${item.kind}:${item.id}:${index}`;resultByKey.set(key,item);const metaParts=resultMeta(item);return `<button class="global-search-result" type="button" data-global-result-key="${esc(key)}"><span class="global-search-result-main"><span class="global-search-result-kicker">${esc(item.context||group.label)} · ${esc(item.badge||group.label)}</span><b>${esc(item.title||'תוצאה')}</b>${item.subtitle?`<span class="global-search-result-subtitle">${esc(item.subtitle)}</span>`:''}</span>${metaParts.length?`<span class="global-search-result-meta">${metaParts.map(x=>`<em>${esc(x)}</em>`).join('')}</span>`:''}<span class="global-search-result-arrow" aria-hidden="true">←</span></button>`}).join('');
      const hidden=group.total-group.items.length;return `<section class="global-search-group"><header><b>${esc(group.label)}</b><span>${esc(group.total)}</span></header><div class="global-search-group-results">${rows}</div>${hidden>0?`<div class="global-search-more">יש עוד ${esc(hidden)} תוצאות בקבוצה — אפשר לצמצם את החיפוש.</div>`:''}</section>`
    }).join('')
  }

  function documentErrorHtml(error){
    const code=String(error?.code||'');
    if(code==='DOCUMENT_BRIDGE_NOT_PAIRED'||code==='UNAUTHORIZED')return documentPairing();
    const hint=code==='DOCUMENT_BRIDGE_UNAVAILABLE'?'ודא ש־Document Bridge מותקן ופועל במחשב זה.':code==='EVERYTHING_EXE_NOT_FOUND'?'ה־Bridge לא מצא את Everything.exe. התקן את Everything 1.5 באמצעות המתקין הרשמי.':'בדוק ש־Everything פועל ושהאינדקס שלו מחזיר את אותה שאילתה בחלון Everything.';
    return `<div class="global-search-empty document-search-error"><div class="global-search-empty-icon">!</div><b>חיפוש הקבצים אינו זמין</b><p>${esc(error?.message||'לא ניתן להשלים את החיפוש המקומי.')}<br>${esc(hint)}</p></div>`
  }

  async function renderDocumentResults(value=''){
    if(mode!=='documents')return;
    const {results,meta}=refs();if(!results||!meta)return;
    const raw=String(value||'').trim();resultByKey=new Map();documentResultById=new Map();resetDocumentPreview();
    documentSequence+=1;const sequence=documentSequence;documentAbort?.abort();documentAbort=null;
    if(!documentBridge){meta.textContent='Document Bridge אינו זמין';results.innerHTML=documentErrorHtml({message:'רכיב החיפוש המקומי אינו טעון.'});return}
    if(!documentBridge.getToken?.()){meta.textContent='נדרש חיבור חד־פעמי במחשב זה';results.innerHTML=documentPairing();return}
    if(!raw){meta.textContent=documentSearchMode==='content'?'חיפוש תוכן':'חיפוש קבצים דרך Everything';results.innerHTML=documentIntro();return}
    if((documentSearchMode==='content'&&raw.length<2)||!raw.length){meta.textContent=documentSearchMode==='content'?'הקלד לפחות שני תווים':'הקלד חיפוש';results.innerHTML=documentIntro();return}
    const controller=new AbortController();documentAbort=controller;const content=documentSearchMode==='content';meta.textContent=content?'מחפש בתוכן הקבצים…':'מחפש קבצים דרך Everything…';results.innerHTML='<div class="global-search-empty"><div class="global-search-empty-icon document-search-spinner">⌕</div><b>מחפש דרך Everything המקומי…</b><p>הקבצים עצמם נשארים במחשב.</p></div>';
    try{
      const data=await documentBridge.search(raw,{mode:documentSearchMode,limit:60,signal:controller.signal});if(mode!=='documents'||sequence!==documentSequence)return;
      const rows=Array.isArray(data.results)?data.results:[];meta.textContent=rows.length?`${rows.length} תוצאות · ${Math.max(0,Number(data.elapsedMs)||0)}ms · אינדקס Everything`:'לא נמצאו תוצאות ב־Everything';
      if(!rows.length){results.innerHTML=`<div class="global-search-empty"><div class="global-search-empty-icon">∅</div><b>Everything לא החזיר תוצאה</b><p>${documentSearchMode==='content'?'החיפוש נשלח כ־content: לכל אינדקס Everything.':'החיפוש נשלח ל־Everything ללא הגבלת תיקיות נוספת.'}</p></div>`;return}
      results.innerHTML=renderDocumentTable(rows);
    }catch(error){if(controller.signal.aborted||sequence!==documentSequence||mode!=='documents')return;meta.textContent='חיפוש הקבצים נכשל';results.innerHTML=documentErrorHtml(error)}finally{if(documentAbort===controller)documentAbort=null}
  }

  function updateModeUi(){
    const {backdrop,siteMode,documentsMode,documentModebar,documentContentMode,documentNameMode,input,dialog,workspace,preview,splitter}=refs();const documents=mode==='documents',content=documentSearchMode==='content';
    siteMode?.classList.toggle('active',!documents);siteMode?.setAttribute('aria-selected',documents?'false':'true');documentsMode?.classList.toggle('active',documents);documentsMode?.setAttribute('aria-selected',documents?'true':'false');
    if(documentModebar)documentModebar.hidden=!documents;if(preview)preview.hidden=!documents;if(splitter)splitter.hidden=!documents;backdrop?.classList.toggle('document-search-active',documents);dialog?.classList.toggle('document-search-active',documents);workspace?.classList.toggle('document-search-active',documents);
    if(documents)applyPreviewWidth(savedPreviewWidth());
    documentContentMode?.classList.toggle('active',content);documentContentMode?.setAttribute('aria-selected',content?'true':'false');documentNameMode?.classList.toggle('active',!content);documentNameMode?.setAttribute('aria-selected',content?'false':'true');
    if(input)input.placeholder=documents?(content?'חפש טקסט בתוך תוכן הקבצים…':'חפש קובץ או תיקייה…'):'שם, הזמנה, טלפון, צ׳ק, סכום, הערה, מיקום…';
  }
  function setDocumentSearchMode(next){
    const normalized=next==='content'?'content':'everything';if(documentSearchMode===normalized)return;documentSearchMode=normalized;scheduledDocumentRender.cancel();documentSequence+=1;documentAbort?.abort();documentAbort=null;resetDocumentPreview();updateModeUi();const {input}=refs();renderDocumentResults(input?.value||'');requestAnimationFrame(()=>input?.focus())
  }
  function setMode(next){
    const normalized=next==='documents'?'documents':'site';if(mode===normalized)return;mode=normalized;scheduledSiteRender.cancel();scheduledDocumentRender.cancel();documentSequence+=1;documentAbort?.abort();documentAbort=null;if(mode!=='documents')resetDocumentPreview();updateModeUi();const {input}=refs();renderResults(input?.value||'');requestAnimationFrame(()=>input?.focus())
  }
  function renderResults(value=''){if(mode==='documents')return renderDocumentResults(value);return renderSiteResults(value)}

  function open(){const {backdrop,input,trigger,results,meta}=refs();if(!backdrop)return;scheduledSiteRender.cancel();scheduledDocumentRender.cancel();documentSequence+=1;documentAbort?.abort();documentAbort=null;backdrop.hidden=false;backdrop.setAttribute('aria-hidden','false');trigger?.setAttribute('aria-expanded','true');updateModeUi();const value=input?.value||'';if(String(value).trim()){resultByKey=new Map();if(meta)meta.textContent='מעדכן תוצאות…';if(results)results.innerHTML='<div class="global-search-empty"><div class="global-search-empty-icon">⌕</div><b>מעדכן את החיפוש…</b></div>';scheduleCurrent(value)}else renderResults('');requestAnimationFrame(()=>input?.focus())}
  function close({restoreFocus=true}={}){const {backdrop,trigger}=refs();if(!backdrop)return;scheduledSiteRender.cancel();scheduledDocumentRender.cancel();documentSequence+=1;documentAbort?.abort();documentAbort=null;resetDocumentPreview();backdrop.hidden=true;backdrop.setAttribute('aria-hidden','true');trigger?.setAttribute('aria-expanded','false');if(restoreFocus)requestAnimationFrame(()=>trigger?.focus())}
  function toggle(){const {backdrop}=refs();if(!backdrop)return;backdrop.hidden?open():close()}
  function scheduleCurrent(value){return mode==='documents'?scheduledDocumentRender(value):scheduledSiteRender(value)}
  function flushCurrent(){return mode==='documents'?scheduledDocumentRender.flush():scheduledSiteRender.flush()}

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
  async function openDocumentResult(id,button){if(!documentBridge||!id)return;const previous=button?.disabled;if(button)button.disabled=true;try{const opened=await documentBridge.openDocument(id);const {meta}=refs();if(meta)meta.textContent=opened?.type==='folder'?'התיקייה נפתחה בסייר הקבצים':'הקובץ נפתח במחשב'}catch(error){const {meta}=refs();if(meta)meta.textContent=error?.message||'פתיחת הקובץ נכשלה'}finally{if(button)button.disabled=!!previous}}
  async function pairDocumentBridge(){
    if(!documentBridge)return;const token=String(byId('globalSearchDocumentToken')?.value||'').trim();if(!token)return;documentBridge.setToken(token);const {results,meta,input}=refs();if(meta)meta.textContent='בודק את החיבור המקומי…';
    try{const status=await documentBridge.status();if(mode!=='documents')return;const index=status.index||{},files=Number(index.fileCount)||0,indexed=Number(index.indexedContentCount)||0;if(meta)meta.textContent=`מחובר ל-Everything ${status.everythingVersion||''} · ${files} קבצים באינדקס · ${indexed} עם תוכן מאונדקס`;renderDocumentResults(input?.value||'')}
    catch(error){if(String(error?.code)==='UNAUTHORIZED')documentBridge.setToken('');if(results)results.innerHTML=documentErrorHtml(error);if(meta)meta.textContent='החיבור המקומי נכשל'}
  }

  function bind(){
    const {trigger,backdrop,input,results,close:closeButton,siteMode,documentsMode,documentContentMode,documentNameMode,previewOpen,splitter,workspace}=refs();if(!trigger||!backdrop||!input||!results||!closeButton)return;
    trigger.addEventListener('click',toggle);closeButton.addEventListener('click',close);siteMode?.addEventListener('click',()=>setMode('site'));documentsMode?.addEventListener('click',()=>setMode('documents'));documentContentMode?.addEventListener('click',()=>setDocumentSearchMode('content'));documentNameMode?.addEventListener('click',()=>setDocumentSearchMode('everything'));input.addEventListener('input',()=>scheduleCurrent(input.value));
    input.addEventListener('keydown',event=>{if(event.key==='ArrowDown'){flushCurrent();const first=results.querySelector('.global-search-result');if(first){event.preventDefault();first.focus()}}});
    results.addEventListener('keydown',event=>{if(!event.target.matches('.global-search-result'))return;if(event.key==='ArrowDown'||event.key==='ArrowUp'){const buttons=[...results.querySelectorAll('.global-search-result')],index=buttons.indexOf(event.target),next=event.key==='ArrowDown'?Math.min(buttons.length-1,index+1):Math.max(0,index-1);event.preventDefault();buttons[next]?.focus();if(buttons[next]?.dataset.documentResultId)selectDocumentResult(buttons[next].dataset.documentResultId,buttons[next])}else if(event.key==='Enter'&&event.target.dataset.documentResultId){event.preventDefault();openDocumentResult(event.target.dataset.documentResultId,event.target)}else if(event.key==='Escape')close()});
    results.addEventListener('click',event=>{const pair=event.target.closest('[data-document-pair]');if(pair){pairDocumentBridge();return}const documentButton=event.target.closest('[data-document-result-id]');if(documentButton){selectDocumentResult(documentButton.dataset.documentResultId,documentButton);return}const button=event.target.closest('[data-global-result-key]');if(button)openResult(button.dataset.globalResultKey)});
    results.addEventListener('dblclick',event=>{const documentButton=event.target.closest('[data-document-result-id]');if(documentButton){event.preventDefault();openDocumentResult(documentButton.dataset.documentResultId,documentButton)}});
    previewOpen?.addEventListener('click',()=>{if(!selectedDocumentId)return;const button=[...results.querySelectorAll('[data-document-result-id]')].find(row=>row.dataset.documentResultId===selectedDocumentId)||null;openDocumentResult(selectedDocumentId,button)});
    if(splitter&&workspace){let resizing=false;const updateFromPointer=event=>{if(!resizing)return;const rect=workspace.getBoundingClientRect();if(!rect.width)return;applyPreviewWidth((event.clientX-rect.left)/rect.width*100)};const finish=event=>{if(!resizing)return;resizing=false;splitter.classList.remove('dragging');try{splitter.releasePointerCapture?.(event.pointerId)}catch{}const current=parseFloat(workspace.style.getPropertyValue('--document-preview-width'))||DOCUMENT_PREVIEW_DEFAULT;applyPreviewWidth(current,{save:true})};splitter.addEventListener('pointerdown',event=>{if(mode!=='documents')return;resizing=true;splitter.classList.add('dragging');splitter.setPointerCapture?.(event.pointerId);updateFromPointer(event);event.preventDefault()});splitter.addEventListener('pointermove',updateFromPointer);splitter.addEventListener('pointerup',finish);splitter.addEventListener('pointercancel',finish);splitter.addEventListener('keydown',event=>{if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight'&&event.key!=='Home'&&event.key!=='End')return;event.preventDefault();const current=parseFloat(workspace.style.getPropertyValue('--document-preview-width'))||savedPreviewWidth();const next=event.key==='Home'?DOCUMENT_PREVIEW_MIN:event.key==='End'?DOCUMENT_PREVIEW_MAX:current+(event.key==='ArrowRight'?3:-3);applyPreviewWidth(next,{save:true})})}
    results.addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target.id==='globalSearchDocumentToken'){event.preventDefault();pairDocumentBridge()}});
    backdrop.addEventListener('pointerdown',event=>{backdropPointerId=event.target===backdrop?event.pointerId:null});backdrop.addEventListener('pointerup',event=>{const dismiss=backdropPointerId===event.pointerId&&event.target===backdrop;backdropPointerId=null;if(dismiss)close()});backdrop.addEventListener('pointercancel',()=>{backdropPointerId=null});
    window.addEventListener('resize',()=>{syncNativePreviewGeometry({force:true})});
    document.addEventListener('visibilitychange',()=>{if(document.hidden){if(nativePreviewActive)deactivateNativePreview({forget:false});return}if(mode==='documents'&&nativePreviewWantedId&&selectedDocumentId===nativePreviewWantedId){const sequence=previewSequence;showNativePreview(nativePreviewWantedId,sequence).catch(()=>{})}});
    document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();open();return}if(event.key==='Escape'&&!backdrop.hidden)close()});
  }

  return{bind,open,close,toggle,renderResults,openResult,navigateItem,setMode}
}
