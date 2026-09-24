import {esc} from '../../core/values.js';
import {$} from '../../state/constants.js';

const BACKEND_PATH='/functions/v1/morning-documents';
const CACHE_TTL_MS=90_000;
const TYPES=Object.freeze({10:'הצעת מחיר',20:'הזמנה / אישור הזמנה',100:'הזמנה',200:'תעודת משלוח',210:'תעודת החזרה',300:'חשבון עסקה',305:'חשבונית מס',320:'חשבונית מס / קבלה',330:'חשבונית זיכוי',400:'קבלה',405:'קבלה על תרומה',410:'קבלת פיקדון',500:'תעודת חיוב',600:'הזמנת רכש',610:'הצעת רכש'});
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

export function createDomainsCustomersDocumentsBrowser({modal,toast,supaFetch,dateEditorMarkup}){
  const cache=new Map();let query=defaultDocumentSearch(),sequence=0,picker=false,busy=false,lastItems=[],previewObjectUrl='';
  async function backend(action,payload={}){
    const response=await supaFetch(BACKEND_PATH,{method:'POST',networkRetry:false,body:JSON.stringify({action,...payload})});
    const data=await response.json();if(!response.ok||data.ok===false)throw new Error(data.message||'לא ניתן לקרוא מסמכים מ-Morning');return data;
  }
  function invalidateCache(){cache.clear()}
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
  function releasePreviewUrl(){if(previewObjectUrl){URL.revokeObjectURL(previewObjectUrl);previewObjectUrl=''}}
  function clearBrowserPreview(){releasePreviewUrl();const box=$('#morningBrowserPreview'),frame=$('#morningBrowserPreviewFrame');if(frame)frame.removeAttribute('src');if(box)box.hidden=true}
  async function openDocuments(){releasePreviewUrl();picker=false;sequence++;query=defaultDocumentSearch();invalidateCache();modal('הצגה וחיפוש במסמכי Morning',markup(),'<button class="btn" data-action="close-modal">סגור</button>');return runSearch()}
  async function openInvoicePicker(){
    const panel=$('#morningInvoicePicker');if(!panel)return;
    releasePreviewUrl();picker=true;sequence++;invalidateCache();query={...defaultDocumentSearch(),type:[305],status:[0],clientName:$('#morningClientName')?.value||''};
    panel.hidden=false;panel.innerHTML=markup();return runSearch();
  }
  function readFilters(){
    const fromDate=$('#morningSearchFrom')?.value||'',toDate=$('#morningSearchTo')?.value||'';
    if(!fromDate||!toDate||fromDate>toDate)throw new Error('יש לבחור טווח תאריכים תקין');
    const type=$('#morningSearchType')?.value,status=$('#morningSearchStatus')?.value;
    return {...query,fromDate,toDate,clientName:($('#morningSearchClient')?.value||'').trim(),type:type===''?[]:[Number(type)],status:status===''?[]:[Number(status)]};
  }
  function setBusy(value){busy=value;root()?.setAttribute('aria-busy',String(value));for(const id of ['morningPrevious','morningNext']){const button=$('#'+id);if(button&&value)button.disabled=true}root()?.querySelectorAll('[data-action="morning-search"],[data-action="morning-refresh"]').forEach(button=>{button.disabled=value})}
  async function runSearch({refresh=false}={}){
    const ticket=++sequence,element=root();if(!element)return;setBusy(true);clearBrowserPreview();
    $('#morningBrowserStatus').textContent='מחפש ב-Morning…';$('#morningBrowserResults').replaceChildren();$('#morningBrowserDetails').hidden=true;
    try{
      const key=JSON.stringify(query),cached=cache.get(key);
      const data=!refresh&&cached&&cached.expires>Date.now()?cached.data:await backend('search_documents',query);
      if(ticket!==sequence||root()!==element)return;
      if(cache.size>=20)cache.delete(cache.keys().next().value);cache.set(key,{data,expires:Date.now()+CACHE_TTL_MS});
      lastItems=data.items||[];renderResults(lastItems);
      $('#morningBrowserStatus').textContent=lastItems.length?`${data.total} מסמכים נמצאו`:'לא נמצאו מסמכים בטווח ובמסננים שנבחרו';
      $('#morningPageLabel').textContent=`עמוד ${query.page+1}${data.pages?' מתוך '+data.pages:''}`;
      $('#morningPrevious').disabled=query.page===0;$('#morningNext').disabled=query.page+1>=data.pages;
    }catch(error){if(ticket===sequence&&root()===element){$('#morningBrowserStatus').textContent=error.message;$('#morningPrevious').disabled=query.page===0}}
    finally{if(ticket===sequence&&root()===element)setBusy(false)}
  }
  async function search(refresh=false){try{query={...readFilters(),page:0};return await runSearch({refresh})}catch(error){toast(error.message)}}
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
    const doc=lastItems.find(item=>item.id===id),select=$('#morningLinkedDocument');if(!doc||!select)return;
    select.innerHTML=`<option value="">ללא קישור</option><option value="${esc(id)}">${esc(doc.number)} · ${esc(doc.clientName)} · ${esc(amount(doc.amount,doc.currency))}</option>`;select.value=id;
    sequence++;releasePreviewUrl();$('#morningInvoicePicker').hidden=true;$('#morningInvoicePicker').replaceChildren();
  }
  async function details(id,button){if(button)button.disabled=true;const element=root();try{const data=await backend('get_document',{document_id:id});if(root()!==element)return;const doc=data.document,panel=$('#morningBrowserDetails');panel.hidden=false;panel.innerHTML=`<div class="morning-form-card"><b>${esc(TYPES[doc.type]||doc.type)} ${esc(doc.number)}</b><p>${esc(doc.description)}</p><p>${esc(doc.clientName)} · ${esc(amount(doc.amount,doc.currency))}</p><p>מספר הקצאה: ${esc(doc.allocationNumber||'—')}</p></div>`}catch(error){toast(error.message)}finally{if(button)button.disabled=false}}
  async function fetchDocumentPdf(id){
    const response=await supaFetch(BACKEND_PATH,{method:'POST',networkRetry:false,dataPriority:'high',body:JSON.stringify({action:'document_pdf',document_id:String(id)})});
    if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.message||'לא ניתן לטעון את קובץ המסמך מ-Morning')}
    const contentType=String(response.headers.get('Content-Type')||'').toLowerCase();if(!contentType.includes('application/pdf'))throw new Error('Morning החזירה קובץ שאינו PDF');
    const blob=await response.blob();if(!blob.size)throw new Error('Morning החזירה קובץ PDF ריק');return blob;
  }
  async function viewDocument(id,button,{quiet=false}={}){
    if(button)button.disabled=true;const element=root();
    try{
      const blob=await fetchDocumentPdf(id);if(element&&root()!==element)return false;
      if(button?.isConnected===false)return false;
      const browserBox=$('#morningBrowserPreview'),browserFrame=$('#morningBrowserPreviewFrame'),issuanceBox=$('#morningPreviewBox'),issuanceFrame=$('#morningPreviewFrame'),issuanceNote=$('#morningPreviewNote');
      if(!browserBox&&!issuanceBox&&!$('#morningStandalonePreview'))modal('צפייה במסמך Morning',`<div id="morningStandalonePreview" class="morning-preview-box"><div class="morning-preview-head"><b>מסמך Morning</b><span>מסמך רשמי שנשלף מ-Morning ואינו נשמר באתר</span></div><iframe id="morningStandalonePreviewFrame" title="צפייה במסמך Morning"></iframe></div>`,'<button class="btn" data-action="close-modal">סגור</button>');
      const box=browserBox||issuanceBox||$('#morningStandalonePreview'),frame=browserFrame||issuanceFrame||$('#morningStandalonePreviewFrame');if(!box||!frame)throw new Error('אזור תצוגת המסמך אינו זמין');
      releasePreviewUrl();const url=URL.createObjectURL(blob);previewObjectUrl=url;
      if(issuanceNote&&!browserBox)issuanceNote.textContent='מסמך רשמי שנשלף מ-Morning ואינו נשמר באתר';
      // Keep the Blob URL alive for the full embedded-viewer lifetime. Chrome's PDF toolbar
      // re-reads the iframe source when its built-in Download action is used; revoking on
      // iframe load leaves the PDF visible/printable but makes that later download fail.
      frame.src=url;box.hidden=false;box.scrollIntoView({block:'nearest',behavior:'smooth'});return true;
    }catch(error){if(!quiet)toast(error.message||'טעינת המסמך נכשלה');return false}finally{if(button)button.disabled=false}
  }
  async function viewVerifiedOperation(operationId,button){
    if(button)button.disabled=true;
    try{
      const data=await backend('status',{operation_id:String(operationId||'')});
      const operation=data.operation;
      if(operation?.state!=='created'||!operation.verified_at||!operation.document_id)throw new Error('לא נמצא מסמך Morning מאומת לתנועה זו');
      return await viewDocument(operation.document_id,button);
    }catch(error){toast(error.message||'טעינת מסמך Morning נכשלה');return false}
    finally{if(button)button.disabled=false}
  }
  async function downloadDocument(id,button){
    if(button)button.disabled=true;
    try{const data=await backend('document_links',{document_id:String(id)}),url=new URL(data.url);if(url.protocol!=='https:')throw new Error('קישור מסמך אינו תקין');
      const anchor=document.createElement('a');anchor.href=url.href;anchor.target='_blank';anchor.rel='noopener noreferrer';anchor.download='morning-document.pdf';anchor.className='btn small';anchor.textContent='לחץ כאן אם ההורדה לא התחילה';
      const host=$('#morningBrowserStatus')||$('#morningOperationResult');if(host)host.appendChild(anchor);else document.body.appendChild(anchor);anchor.click();setTimeout(()=>anchor.remove(),60_000);
    }catch(error){toast(error.message||'הורדת המסמך נכשלה')}finally{if(button)button.disabled=false}
  }
  return {openDocuments,openInvoicePicker,search,page,selectInvoice,details,invalidateCache,viewDocument,viewVerifiedOperation,downloadDocument};
}
