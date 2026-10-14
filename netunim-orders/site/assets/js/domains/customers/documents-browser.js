import {createRuntimeTaskOwner} from '../../shared/runtime-task-owner.js';
import {esc} from '../../core/values.js';
import {$} from '../../state/constants.js';
import {MORNING_DOCUMENT_TYPES,morningDocumentLabel} from '../../core/morning-document-types.js';
import {createMorningDisplayLifetime,clearMorningDisplay} from './morning-display-lifetime.js';

const CACHE_TTL_MS=90_000;
const TYPES=MORNING_DOCUMENT_TYPES;
const SEARCH_TYPE_CODES=Object.freeze([10,20,100,200,210,300,305,320,330,400]);
const SEARCH_TYPES=Object.freeze(Object.fromEntries(SEARCH_TYPE_CODES.map(type=>[type,TYPES[type]])));
const STATUSES=Object.freeze({0:'פתוח',1:'סגור',2:'נסגר ידנית',3:'מבוטל',4:'מבטל'});
function localDate(date){return new Date(date.getTime()-date.getTimezoneOffset()*60_000).toISOString().slice(0,10)}
export function defaultDocumentSearch(now=new Date()){
  const from=new Date(now);from.setDate(from.getDate()-90);
  return {fromDate:localDate(from),toDate:localDate(now),page:0,pageSize:25,sort:'documentDate',order:'DESC',type:[],status:[],clientName:''};
}
function options(values){return '<option value="">הכל</option>'+Object.entries(values).map(([value,label])=>`<option value="${value}">${esc(label)}</option>`).join('')}
function amount(value,currency){return new Intl.NumberFormat('he-IL',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(value)||0)+' '+String(currency||'')}

export function createDomainsCustomersDocumentsBrowser({operationScope,subscribeAccountScope=()=>()=>{},modal,toast,request,documentMedia,dateEditorMarkup,onDebtDocumentMetadataResolved=()=>false}){
  if(typeof operationScope?.captureRead!=='function')throw new TypeError('morning_operation_scope_required');
  if(typeof request?.json!=='function'||typeof request?.pdf!=='function')throw new TypeError('morning_request_required');
  if(typeof documentMedia?.create!=='function')throw new TypeError('morning_media_composition_required');
  let disposed=false,browserAssert=null;const scopeChanged=error=>error?.code==='MORNING_OPERATION_SCOPE_CHANGED';
  function captureScope(){const assertAuth=operationScope.captureRead();return ()=>{if(disposed)throw Object.assign(new Error('Morning נעצר'),{code:'MORNING_OPERATION_SCOPE_CHANGED'});assertAuth()}}
  const cache=new Map(),operationMetadataCache=new Map();let query=defaultDocumentSearch(),sequence=0,picker=false,busy=false,lastItems=[];
  const downloads=new Map();let ownedSurface=null;
  const work=createRuntimeTaskOwner();
  const media=documentMedia.create({capture:captureScope,onStandalone:surface=>{ownedSurface=surface}});
  const display=createMorningDisplayLifetime({subscribeAccountScope,onInvalidate:()=>{
    const owned=ownedSurface;ownedSurface=null;
    sequence++;browserAssert=null;busy=false;lastItems=[];query=defaultDocumentSearch();invalidateCache();media.cancelPending();
    for(const [anchor,timer] of downloads){clearTimeout(timer);anchor.remove()}downloads.clear();
    clearMorningDisplay(owned,modal);
  }});
  const backend=(action,payload={},assertCurrent=captureScope())=>request.json(action,payload,assertCurrent);
  async function verifiedOperationMetadata(operationId){
    const operation=String(operationId||'').trim();if(!operation)return null;
    const assertCurrent=captureScope(),cached=operationMetadataCache.get(operation);
    if(cached){try{cached.assertCurrent();return cached.promise}catch{operationMetadataCache.delete(operation)}}
    let entry;const forget=()=>{if(operationMetadataCache.get(operation)===entry)operationMetadataCache.delete(operation)};
    const pending=backend('status',{operation_id:operation},assertCurrent).then(async data=>{
      assertCurrent();const row=data?.operation;if(row?.state!=='created'||!row.verified_at||!row.document_id)return null;
      const metadata={documentId:String(row.document_id),documentNumber:String(row.document_number||''),documentType:Number(row.document_type)||0,verifiedAt:String(row.verified_at||'')};
      if(!metadata.documentNumber||!metadata.documentType){
        try{const detail=await backend('get_document',{document_id:metadata.documentId},assertCurrent);assertCurrent();const document=detail?.document||{};metadata.documentNumber=String(document.number||metadata.documentNumber);metadata.documentType=Number(document.type)||metadata.documentType}
        catch{forget();return null}
      }
      if(!metadata.documentNumber||!metadata.documentType){forget();return null}
      return metadata;
    }).catch(()=>{forget();return null});
    entry={promise:pending,assertCurrent};operationMetadataCache.set(operation,entry);return pending;
  }
  async function hydrateDebtDocumentLinks(root=globalThis.document){
    let assertCurrent;try{assertCurrent=captureScope()}catch{return 0}
    const buttons=Array.from(root?.querySelectorAll?.('[data-morning-debt-operation]')||[]);
    await Promise.all(buttons.map(async button=>{try{
      const operationId=String(button?.dataset?.morningDebtOperation||'').trim(),metadata=await verifiedOperationMetadata(operationId);assertCurrent();if(!metadata)return;
      if(button?.isConnected===false&&globalThis.document?.contains?.(button)===false)return;
      let committed=false;
      try{committed=await onDebtDocumentMetadataResolved({operationId,...metadata})===true}catch(error){assertCurrent();console.error('morning debt metadata persistence',error)}
      assertCurrent();
      if(button.dataset.morningDebtOperation!==operationId||button?.isConnected===false&&globalThis.document?.contains?.(button)===false)return;
      button.dataset.clickArg0=metadata.documentId;button.title=`צפה במסמך Morning ${metadata.documentNumber}`;
      const label=button.querySelector?.('[data-morning-debt-label]');if(label)label.textContent=morningDocumentLabel(metadata)+(committed?'':' · לא נשמר בחוב');
      if(committed){delete button.dataset.morningDebtOperation;delete button.dataset.morningDebtPersistence}
      else{button.dataset.morningDebtPersistence='unconfirmed';button.title+=' — המסמך מאומת ב-Morning; פרטי הקישור בחוב לא אושרו לשמירה. יש לבדוק את אזהרת השמירה המקומית לפני רענון.'}
    }catch(error){if(!scopeChanged(error))console.error('Morning debt metadata',error)}}));
    return buttons.length;
  }
  function invalidateCache(){cache.clear();operationMetadataCache.clear()}
  function root(){return $('#morningDocumentsBrowser')}
  function markup(){return `<section id="morningDocumentsBrowser" class="morning-documents-browser" dir="rtl">
    <div class="morning-browser-filters">
      <label>שם לקוח<input id="morningSearchClient" maxlength="160" data-keydown="morning-search-enter" value="${esc(query.clientName)}" placeholder="שם הלקוח"></label>
      <label>מתאריך${dateEditorMarkup('morningSearchFrom',query.fromDate,{label:'מתאריך',compact:true})}</label>
      <label>עד תאריך${dateEditorMarkup('morningSearchTo',query.toDate,{label:'עד תאריך',compact:true})}</label>
      <label>סוג מסמך<select id="morningSearchType" ${picker?'disabled':''}>${picker?'<option value="305">חשבונית מס</option>':options(SEARCH_TYPES)}</select></label>
      <label>סטטוס<select id="morningSearchStatus" ${picker?'disabled':''}>${picker?'<option value="0">פתוח</option>':options(STATUSES)}</select></label>
      <div class="morning-browser-filter-actions"><button class="btn primary" data-action="morning-search">חפש</button><button class="btn" data-action="morning-refresh">רענן</button></div>
    </div>
    <div id="morningBrowserStatus" role="status" aria-live="polite"></div>
    <div id="morningBrowserResults"></div><div id="morningBrowserDetails" hidden></div>
    <div id="morningBrowserPreview" class="morning-preview-box" hidden><div class="morning-preview-head"><b>תצוגת מסמך</b><span>PDF זמני שנשלף מ-Morning ואינו נשמר באתר</span></div><iframe id="morningBrowserPreviewFrame" title="תצוגת מסמך Morning"></iframe></div>
    <nav class="morning-browser-pagination" aria-label="עמודי מסמכים"><button class="btn" id="morningPrevious" data-action="morning-page" data-click-arg0="-1" disabled>הקודם</button><span id="morningPageLabel">עמוד 1</span><button class="btn" id="morningNext" data-action="morning-page" data-click-arg0="1" disabled>הבא</button></nav>
  </section>`}
  function clearBrowserPreview(){media.cancelPending();const box=$('#morningBrowserPreview');if(box)box.hidden=true}
  async function openDocuments(){try{browserAssert=captureScope()}catch(error){if(!scopeChanged(error))toast(error.message);return}media.cancelPending();picker=false;sequence++;query=defaultDocumentSearch();invalidateCache();modal('הצגה וחיפוש במסמכי Morning',markup(),'<button class="btn" data-action="close-modal">סגור</button>');ownedSurface=root();return runSearch()}
  async function openInvoicePicker(){
    try{browserAssert=captureScope()}catch(error){if(!scopeChanged(error))toast(error.message);return}
    const panel=$('#morningInvoicePicker');if(!panel)return;
    media.cancelPending();picker=true;sequence++;invalidateCache();query={...defaultDocumentSearch(),type:[305],status:[0],clientName:$('#morningClientName')?.value||''};
    panel.hidden=false;panel.innerHTML=markup();ownedSurface=root();return runSearch();
  }
  function readFilters(){
    const fromDate=$('#morningSearchFrom')?.value||'',toDate=$('#morningSearchTo')?.value||'';
    if(!fromDate||!toDate||fromDate>toDate)throw new Error('יש לבחור טווח תאריכים תקין');
    const type=$('#morningSearchType')?.value,status=$('#morningSearchStatus')?.value;
    return {...query,fromDate,toDate,clientName:($('#morningSearchClient')?.value||'').trim(),type:type===''?[]:[Number(type)],status:status===''?[]:[Number(status)]};
  }
  function setBusy(value){busy=value;root()?.setAttribute('aria-busy',String(value));for(const id of ['morningPrevious','morningNext']){const button=$('#'+id);if(button&&value)button.disabled=true}root()?.querySelectorAll('[data-action="morning-search"],[data-action="morning-refresh"]').forEach(button=>{button.disabled=value})}
  async function runSearch({refresh=false}={}){
    let assertCurrent;try{browserAssert?.();assertCurrent=captureScope()}catch(error){if(!scopeChanged(error))toast(error.message);return}
    const ticket=++sequence,element=root();if(!element)return;setBusy(true);clearBrowserPreview();
    $('#morningBrowserStatus').textContent='מחפש ב-Morning…';$('#morningBrowserResults').replaceChildren();$('#morningBrowserDetails').hidden=true;
    try{
      const key=JSON.stringify(query);let cached=cache.get(key);if(cached){try{cached.assertCurrent()}catch{cached=null;invalidateCache()}}
      const data=!refresh&&cached&&cached.expires>Date.now()?cached.data:await backend('search_documents',query,assertCurrent);assertCurrent();
      if(ticket!==sequence||root()!==element)return;
      if(cache.size>=20)cache.delete(cache.keys().next().value);cache.set(key,{data,assertCurrent,expires:Date.now()+CACHE_TTL_MS});
      lastItems=data.items||[];renderResults(lastItems);
      $('#morningBrowserStatus').textContent=lastItems.length?`${data.total} מסמכים נמצאו`:'לא נמצאו מסמכים בטווח ובמסננים שנבחרו';
      $('#morningPageLabel').textContent=`עמוד ${query.page+1}${data.pages?' מתוך '+data.pages:''}`;
      $('#morningPrevious').disabled=query.page===0;$('#morningNext').disabled=query.page+1>=data.pages;
    }catch(error){if(ticket===sequence&&root()===element){$('#morningBrowserStatus').textContent=error.message;$('#morningPrevious').disabled=query.page===0}}
    finally{if(ticket===sequence&&root()===element)setBusy(false)}
  }
  async function search(refresh=false){try{query={...readFilters(),page:0};return await runSearch({refresh})}catch(error){if(!scopeChanged(error))toast(error.message)}}
  function page(delta){if(busy)return;query={...query,page:Math.max(0,query.page+Number(delta))};return runSearch()}
  function allocationMarkup(value){
    const allocation=String(value||'').trim();if(!allocation)return '<span class="morning-browser-allocation empty">—</span>';
    const preview=allocation.length>7?allocation.slice(0,7)+'…':allocation;
    return `<span class="morning-browser-allocation assigned" title="${esc(allocation)}" aria-label="מספר הקצאה ${esc(allocation)}"><span class="morning-browser-allocation-mark" aria-hidden="true">✓</span><span class="morning-browser-allocation-text">${esc(preview)}</span></span>`;
  }
  function renderResults(items){
    const headers=['תאריך','סוג','מספר מסמך','לקוח','סכום','מטבע','סטטוס','מספר הקצאה','פעולות'];
    $('#morningBrowserResults').innerHTML=`<table class="morning-browser-table"><thead><tr>${headers.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${items.map(doc=>{
      const fields=[doc.date,TYPES[doc.type]||doc.type,doc.number,doc.clientName,amount(doc.amount,''),doc.currency,STATUSES[doc.status]??doc.status];
      return `<tr>${fields.map((value,index)=>`<td data-label="${headers[index]}" title="${esc(value)}"><span class="morning-browser-cell-text">${esc(value)}</span></td>`).join('')}<td class="morning-browser-allocation-cell" data-label="מספר הקצאה">${allocationMarkup(doc.allocationNumber)}</td><td data-label="פעולות"><div class="morning-browser-actions">${picker?`<button class="btn small" data-action="morning-select-invoice" data-click-arg0="${esc(doc.id)}">בחר</button>`:''}<button class="btn small" data-action="morning-browser-view" data-click-arg0="${esc(doc.id)}">צפה</button><button class="btn small" data-action="morning-download" data-click-arg0="${esc(doc.id)}">הורד</button><button class="btn small" data-action="morning-details" data-click-arg0="${esc(doc.id)}">פרטים</button></div></td></tr>`;
    }).join('')}</tbody></table>`;
  }
  function selectInvoice(id){
    try{browserAssert?.();captureScope()()}catch(error){toast(error.message);return false}
    const doc=lastItems.find(item=>item.id===id),select=$('#morningLinkedDocument');if(!doc||!select)return;
    select.innerHTML=`<option value="">ללא קישור</option><option value="${esc(id)}">${esc(doc.number)} · ${esc(doc.clientName)} · ${esc(amount(doc.amount,doc.currency))}</option>`;select.value=id;
    sequence++;media.cancelPending();$('#morningInvoicePicker').hidden=true;$('#morningInvoicePicker').replaceChildren();
  }
  async function details(id,button){
    let assertCurrent;try{browserAssert?.();assertCurrent=captureScope()}catch(error){if(!scopeChanged(error))toast(error.message);return}if(button)button.disabled=true;const element=root();try{const data=await backend('get_document',{document_id:id},assertCurrent);assertCurrent();if(root()!==element)return;const doc=data.document,panel=$('#morningBrowserDetails');panel.hidden=false;panel.innerHTML=`<div class="morning-form-card"><b>${esc(TYPES[doc.type]||doc.type)} ${esc(doc.number)}</b><p>${esc(doc.description)}</p><p>${esc(doc.clientName)} · ${esc(amount(doc.amount,doc.currency))}</p><p>מספר הקצאה: ${esc(doc.allocationNumber||'—')}</p></div>`}catch(error){if(!scopeChanged(error))toast(error.message)}finally{if(button)button.disabled=false}}
  async function viewDocument(id,button,{quiet=false,assertCurrent}={}){
    try{if(root())browserAssert?.();assertCurrent??=captureScope();assertCurrent()}catch(error){if(!quiet&&!scopeChanged(error))toast(error.message);return false}
    if(button)button.disabled=true;
    try{return await media.viewDocument(String(id),{quiet,assertCurrent,isCurrent:()=>button?.isConnected!==false})}
    finally{if(button)button.disabled=false}
  }
  async function viewVerifiedOperation(operationId,button){
    if(button)button.disabled=true;
    try{return await media.viewVerifiedOperation(String(operationId),{isCurrent:()=>button?.isConnected!==false})}
    finally{if(button)button.disabled=false}
  }
  async function downloadDocument(id,button){
    let assertCurrent;try{if(root())browserAssert?.();assertCurrent=captureScope()}catch(error){if(!scopeChanged(error))toast(error.message);return}
    if(button)button.disabled=true;
    try{const data=await backend('document_links',{document_id:String(id)},assertCurrent);assertCurrent();const url=new URL(data.url);if(url.protocol!=='https:')throw new Error('קישור מסמך אינו תקין');
      const anchor=document.createElement('a');anchor.href=url.href;anchor.target='_blank';anchor.rel='noopener noreferrer';anchor.download='morning-document.pdf';anchor.className='btn small';anchor.textContent='לחץ כאן אם ההורדה לא התחילה';
      const host=$('#morningBrowserStatus')||$('#morningOperationResult');if(host)host.appendChild(anchor);else document.body.appendChild(anchor);
      const timer=setTimeout(()=>{downloads.delete(anchor);anchor.remove()},60_000);downloads.set(anchor,timer);anchor.click();
    }catch(error){if(!scopeChanged(error))toast(error.message||'הורדת המסמך נכשלה')}finally{if(button)button.disabled=false}
  }
  function dispose(){if(disposed)return false;disposed=true;work.close();media.dispose();display.dispose();return true}
  async function drain(){do{await Promise.all([work.drain(),media.drain()])}while(work.isPending()||media.isPending())}
  function command(run,args){return disposed?Promise.resolve(false):work.run(()=>run(...args))}
  const runtime={dispose,drain,isPending:()=>work.isPending()||media.isPending(),cancelPending:media.cancelPending};
  return {dispose,runtime,openDocuments:(...args)=>command(openDocuments,args),openInvoicePicker:(...args)=>command(openInvoicePicker,args),search:(...args)=>command(search,args),page:(...args)=>command(page,args),selectInvoice,details:(...args)=>command(details,args),invalidateCache,
    viewDocument:(...args)=>command(viewDocument,args),viewVerifiedOperation:(...args)=>command(viewVerifiedOperation,args),downloadDocument:(...args)=>command(downloadDocument,args),hydrateDebtDocumentLinks:(...args)=>command(hydrateDebtDocumentLinks,args),previewDraft:(...args)=>command((payload,options)=>media.previewDraft(payload,options),args)};
}
