import {createSearchFragmentIndex} from '../shared/search-fragments.js';
import {esc} from '../core/values.js';
import {money} from '../core/money.js';
import {buildOrderSearchFragment,ORDER_SEARCH_FRAGMENTS,searchGlobalEntries} from '../domains/search/model.js';
import {checkIsClosedStatus} from '../domains/checks/model.js';
import {customerDebtProgressData} from '../shared/customer-debt-progress.js';
import {createSearchScheduler} from '../shared/search-scheduler.js';

const DOCUMENT_SEARCH_DELAY_MS=200;

// Global search is a UI coordinator. Site data stays in domains/search/model.js.
// Local PDF content search is deliberately isolated behind Document Bridge and is
// activated only in its dedicated scope, so it never blocks the normal site search.
export function createUiGlobalSearch({documentBridge=null,searchRevision,model,ui,notesUi={},supplierUi,customerUi,serviceUi,warehouseUi,prepareView,render,openInventoryItemModal}){
  let resultByKey=new Map(),highlightTimer=null,backdropPointerId=null,mode='site',documentSequence=0,documentAbort=null;
  const byId=id=>document.getElementById(id);
  const refs=()=>({trigger:byId('globalSearchButton'),backdrop:byId('globalSearchBackdrop'),input:byId('globalSearchInput'),results:byId('globalSearchResults'),meta:byId('globalSearchMeta'),close:byId('globalSearchClose'),siteMode:byId('globalSearchSiteMode'),documentsMode:byId('globalSearchDocumentsMode')});
  const scheduledSiteRender=createSearchScheduler(value=>renderSiteResults(value));
  const scheduledDocumentRender=createSearchScheduler(value=>renderDocumentResults(value),{delay:DOCUMENT_SEARCH_DELAY_MS});
  const indexedEntries=createSearchFragmentIndex({fragments:Object.keys(ORDER_SEARCH_FRAGMENTS),revision:name=>name==='notes'&&model.state.notesSheet?null:searchRevision?.(ORDER_SEARCH_FRAGMENTS[name],name),build:name=>buildOrderSearchFragment(model.state,name)});

  function scopeIntro(){return `<div class="global-search-empty"><div class="global-search-empty-icon">⌕</div><b>חיפוש בכל מאגר ניהול ההזמנות</b><p>אפשר לחפש שם ספק או לקוח, מספר הזמנה, טלפון, מספר צ'ק, סכום, הערה, מיקום, תוכן שירות ועוד.</p><div class="global-search-scopes"><span>ספקים</span><span>לקוחות</span><span>שירות</span><span>צ'קים</span><span>מחסן ומלאי</span><span>הערות</span></div></div>`}
  function documentPairing(){return `<div class="global-search-empty document-search-setup"><div class="global-search-empty-icon">⌕</div><b>חיפוש מסמכים במחשב זה</b><p>Document Bridge עדיין לא משויך לדפדפן הזה. מתקינים אותו בנפרד בכל מחשב; המפתח שהמתקין מעתיק ללוח נשמר רק בדפדפן המקומי.</p><div class="document-search-pair"><input id="globalSearchDocumentToken" type="password" autocomplete="off" spellcheck="false" placeholder="הדבק מפתח Document Bridge"><button type="button" data-document-pair>חבר מחשב</button></div><small>ה־PDF והטקסט המאונדקס אינם מועלים לאתר או לענן.</small></div>`}
  function documentIntro(){return `<div class="global-search-empty document-search-intro"><div class="global-search-empty-icon">PDF</div><b>חיפוש בתוכן ה־PDF במחשב זה</b><p>החיפוש נשלח רק ל־Everything המקומי במחשב הזה ומוגבל לתיקיות שהוגדרו ב־Document Bridge. הקלד שתי אותיות לפחות.</p><div class="global-search-scopes"><span>OCR / תוכן</span><span>PDF בלבד</span><span>אינדקס מקומי</span></div></div>`}

  function resultMeta(item){const parts=[...(item.meta||[])];if(item.amount!==undefined&&item.amount!==null&&Number.isFinite(Number(item.amount)))parts.unshift(money(item.amount));return parts.filter(Boolean)}
  function bytes(value){const size=Number(value);if(!Number.isFinite(size)||size<0)return '';if(size<1024)return `${size} B`;if(size<1024*1024)return `${Math.round(size/1024)} KB`;return `${(size/1024/1024).toFixed(size<10*1024*1024?1:0)} MB`}
  function localDate(value){const time=Date.parse(value||'');if(!Number.isFinite(time))return '';try{return new Intl.DateTimeFormat('he-IL',{dateStyle:'short',timeStyle:'short'}).format(new Date(time))}catch{return ''}}

  function renderSiteResults(value=''){
    if(mode!=='site')return;
    const {results,meta}=refs();if(!results||!meta)return;
    const raw=String(value||'').trim();resultByKey=new Map();
    if(!raw){meta.textContent='כל המאגרים במקום אחד';results.innerHTML=scopeIntro();return}
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
    const hint=code==='DOCUMENT_BRIDGE_UNAVAILABLE'?'ודא ש־Document Bridge פועל במחשב זה.':code==='EVERYTHING_NOT_RUNNING'?'פתח את Everything במחשב והשאר אותו פועל ברקע.':code==='ROOTS_NOT_CONFIGURED'?'הרץ configure_document_bridge.bat במחשב והגדר את תיקיות ה־PDF.':'בדוק את הגדרת Everything ואת אינדוקס תוכן ה־PDF במחשב זה.';
    return `<div class="global-search-empty document-search-error"><div class="global-search-empty-icon">!</div><b>חיפוש המסמכים אינו זמין</b><p>${esc(error?.message||'לא ניתן להשלים את החיפוש המקומי.')}<br>${esc(hint)}</p></div>`
  }

  async function renderDocumentResults(value=''){
    if(mode!=='documents')return;
    const {results,meta}=refs();if(!results||!meta)return;
    const raw=String(value||'').trim();resultByKey=new Map();
    documentSequence+=1;const sequence=documentSequence;documentAbort?.abort();documentAbort=null;
    if(!documentBridge){meta.textContent='Document Bridge אינו זמין';results.innerHTML=documentErrorHtml({message:'רכיב החיפוש המקומי אינו טעון.'});return}
    if(!documentBridge.getToken?.()){meta.textContent='נדרש חיבור חד־פעמי במחשב זה';results.innerHTML=documentPairing();return}
    if(!raw){meta.textContent='חיפוש תוכן באינדקס Everything המקומי';results.innerHTML=documentIntro();return}
    if(raw.length<2){meta.textContent='הקלד לפחות שני תווים';results.innerHTML=documentIntro();return}
    const controller=new AbortController();documentAbort=controller;meta.textContent='מחפש בתוכן ה־PDF במחשב זה…';results.innerHTML='<div class="global-search-empty"><div class="global-search-empty-icon document-search-spinner">⌕</div><b>מחפש באינדקס Everything המקומי…</b><p>המסמכים עצמם נשארים במחשב.</p></div>';
    try{
      const data=await documentBridge.search(raw,{limit:40,signal:controller.signal});if(mode!=='documents'||sequence!==documentSequence)return;
      const rows=Array.isArray(data.results)?data.results:[];const suffix=data.partial?' · חלק מהתיקיות לא היו זמינות':'';meta.textContent=rows.length?`${rows.length} תוצאות מקומיות · ${Math.max(0,Number(data.elapsedMs)||0)}ms${suffix}`:`לא נמצאו מסמכים${suffix}`;
      if(!rows.length){results.innerHTML=`<div class="global-search-empty"><div class="global-search-empty-icon">∅</div><b>לא נמצא PDF מתאים</b><p>החיפוש בוצע בתוכן המאונדקס של תיקיות המסמכים שהוגדרו במחשב זה.</p></div>`;return}
      results.innerHTML=`<section class="global-search-group document-search-group"><header><b>מסמכים במחשב</b><span>${esc(rows.length)}</span></header>${data.partial?'<div class="document-search-warning">חלק מהתיקיות לא החזירו תשובה. התוצאות הזמינות מוצגות.</div>':''}<div class="global-search-group-results">${rows.map(item=>{const metaParts=[item.rootLabel,item.modified?`עודכן ${localDate(item.modified)}`:'',bytes(item.size)].filter(Boolean);return `<button class="global-search-result document-search-result" type="button" data-document-result-id="${esc(item.id)}"><span class="global-search-result-main"><span class="global-search-result-kicker">תוכן PDF${item.rootLabel?` · ${esc(item.rootLabel)}`:''}</span><b>${esc(item.name||'מסמך PDF')}</b>${item.relativePath?`<span class="global-search-result-subtitle">${esc(item.relativePath)}</span>`:''}</span>${metaParts.length?`<span class="global-search-result-meta">${metaParts.map(x=>`<em>${esc(x)}</em>`).join('')}</span>`:''}<span class="global-search-result-arrow" aria-hidden="true">↗</span></button>`}).join('')}</div></section>`;
    }catch(error){if(controller.signal.aborted||sequence!==documentSequence||mode!=='documents')return;meta.textContent='חיפוש המסמכים נכשל';results.innerHTML=documentErrorHtml(error)}finally{if(documentAbort===controller)documentAbort=null}
  }

  function updateModeUi(){
    const {siteMode,documentsMode,input}=refs();const documents=mode==='documents';
    siteMode?.classList.toggle('active',!documents);siteMode?.setAttribute('aria-selected',documents?'false':'true');documentsMode?.classList.toggle('active',documents);documentsMode?.setAttribute('aria-selected',documents?'true':'false');
    if(input)input.placeholder=documents?'חפש מילים בתוך תוכן ה־PDF במחשב…':'שם, הזמנה, טלפון, צ׳ק, סכום, הערה, מיקום…';
  }
  function setMode(next){
    const normalized=next==='documents'?'documents':'site';if(mode===normalized)return;mode=normalized;scheduledSiteRender.cancel();scheduledDocumentRender.cancel();documentSequence+=1;documentAbort?.abort();documentAbort=null;updateModeUi();const {input}=refs();renderResults(input?.value||'');requestAnimationFrame(()=>input?.focus())
  }
  function renderResults(value=''){if(mode==='documents')return renderDocumentResults(value);return renderSiteResults(value)}

  function open(){const {backdrop,input,trigger,results,meta}=refs();if(!backdrop)return;scheduledSiteRender.cancel();scheduledDocumentRender.cancel();documentSequence+=1;documentAbort?.abort();documentAbort=null;backdrop.hidden=false;backdrop.setAttribute('aria-hidden','false');trigger?.setAttribute('aria-expanded','true');updateModeUi();const value=input?.value||'';if(String(value).trim()){resultByKey=new Map();if(meta)meta.textContent='מעדכן תוצאות…';if(results)results.innerHTML='<div class="global-search-empty"><div class="global-search-empty-icon">⌕</div><b>מעדכן את החיפוש…</b></div>';scheduleCurrent(value)}else renderResults('');requestAnimationFrame(()=>input?.focus())}
  function close({restoreFocus=true}={}){const {backdrop,trigger}=refs();if(!backdrop)return;scheduledSiteRender.cancel();scheduledDocumentRender.cancel();documentSequence+=1;documentAbort?.abort();documentAbort=null;backdrop.hidden=true;backdrop.setAttribute('aria-hidden','true');trigger?.setAttribute('aria-expanded','false');if(restoreFocus)requestAnimationFrame(()=>trigger?.focus())}
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
  async function openDocumentResult(id,button){if(!documentBridge||!id)return;const previous=button?.disabled;if(button)button.disabled=true;try{await documentBridge.openDocument(id);close({restoreFocus:false})}catch(error){const {meta}=refs();if(meta)meta.textContent=error?.message||'פתיחת המסמך נכשלה';if(button)button.disabled=!!previous}}
  async function pairDocumentBridge(){
    if(!documentBridge)return;const token=String(byId('globalSearchDocumentToken')?.value||'').trim();if(!token)return;documentBridge.setToken(token);const {results,meta,input}=refs();if(meta)meta.textContent='בודק את החיבור המקומי…';
    try{const status=await documentBridge.status();if(mode!=='documents')return;if(meta)meta.textContent=`מחובר ל-Everything ${status.everythingVersion||''} · ${Array.isArray(status.roots)?status.roots.length:0} תיקיות`;renderDocumentResults(input?.value||'')}
    catch(error){if(String(error?.code)==='UNAUTHORIZED')documentBridge.setToken('');if(results)results.innerHTML=documentErrorHtml(error);if(meta)meta.textContent='החיבור המקומי נכשל'}
  }

  function bind(){
    const {trigger,backdrop,input,results,close:closeButton,siteMode,documentsMode}=refs();if(!trigger||!backdrop||!input||!results||!closeButton)return;
    trigger.addEventListener('click',toggle);closeButton.addEventListener('click',close);siteMode?.addEventListener('click',()=>setMode('site'));documentsMode?.addEventListener('click',()=>setMode('documents'));input.addEventListener('input',()=>scheduleCurrent(input.value));
    input.addEventListener('keydown',event=>{if(event.key==='ArrowDown'){flushCurrent();const first=results.querySelector('.global-search-result');if(first){event.preventDefault();first.focus()}}});
    results.addEventListener('keydown',event=>{if(!event.target.matches('.global-search-result'))return;if(event.key==='ArrowDown'||event.key==='ArrowUp'){const buttons=[...results.querySelectorAll('.global-search-result')],index=buttons.indexOf(event.target),next=event.key==='ArrowDown'?Math.min(buttons.length-1,index+1):Math.max(0,index-1);event.preventDefault();buttons[next]?.focus()}else if(event.key==='Escape')close()});
    results.addEventListener('click',event=>{const pair=event.target.closest('[data-document-pair]');if(pair){pairDocumentBridge();return}const documentButton=event.target.closest('[data-document-result-id]');if(documentButton){openDocumentResult(documentButton.dataset.documentResultId,documentButton);return}const button=event.target.closest('[data-global-result-key]');if(button)openResult(button.dataset.globalResultKey)});
    results.addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target.id==='globalSearchDocumentToken'){event.preventDefault();pairDocumentBridge()}});
    backdrop.addEventListener('pointerdown',event=>{backdropPointerId=event.target===backdrop?event.pointerId:null});backdrop.addEventListener('pointerup',event=>{const dismiss=backdropPointerId===event.pointerId&&event.target===backdrop;backdropPointerId=null;if(dismiss)close()});backdrop.addEventListener('pointercancel',()=>{backdropPointerId=null});
    document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();open();return}if(event.key==='Escape'&&!backdrop.hidden)close()});
  }

  return{bind,open,close,toggle,renderResults,openResult,navigateItem,setMode}
}
