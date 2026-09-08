import {esc} from '../../core/values.js';
import {$} from '../../state/constants.js';

const BACKEND_PATH='/functions/v1/morning-documents';
const CACHE_TTL_MS=90_000;
const TYPES=Object.freeze({10:'הצעת מחיר',20:'הזמנה / אישור הזמנה',100:'הזמנה',200:'תעודת משלוח',210:'תעודת החזרה',300:'חשבון עסקה',305:'חשבונית מס',320:'חשבונית מס / קבלה',330:'חשבונית זיכוי',400:'קבלה',405:'קבלה על תרומה',410:'קבלת פיקדון',500:'תעודת חיוב',600:'הזמנת רכש',610:'הצעת רכש'});
const STATUSES=Object.freeze({0:'פתוח',1:'סגור',2:'נסגר ידנית',3:'מבוטל',4:'מבטל'});
function localDate(date){return new Date(date.getTime()-date.getTimezoneOffset()*60_000).toISOString().slice(0,10)}
export function defaultDocumentSearch(now=new Date()){
  const from=new Date(now);from.setDate(from.getDate()-90);
  return {fromDate:localDate(from),toDate:localDate(now),page:0,pageSize:25,sort:'documentDate',order:'DESC',type:[],status:[],clientName:''};
}
function options(values){return '<option value="">הכל</option>'+Object.entries(values).map(([value,label])=>`<option value="${value}">${esc(label)}</option>`).join('')}
function amount(value,currency){return new Intl.NumberFormat('he-IL',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(value)||0)+' '+String(currency||'')}

export function createDomainsCustomersDocumentsBrowser({modal,toast,supaFetch}){
  const cache=new Map();let query=defaultDocumentSearch(),sequence=0,picker=false,busy=false,lastItems=[],previewObjectUrl='';
  async function backend(action,payload={}){
    const response=await supaFetch(BACKEND_PATH,{method:'POST',networkRetry:false,body:JSON.stringify({action,...payload})});
    const data=await response.json();if(!response.ok||data.ok===false)throw new Error(data.message||'לא ניתן לקרוא מסמכים מ-Morning');return data;
  }
  function invalidateCache(){cache.clear()}
  function root(){return $('#morningDocumentsBrowser')}
  function markup(){return `<section id="morningDocumentsBrowser" class="morning-documents-browser" dir="rtl">
    <p class="morning-browser-intro">חיפוש ישיר ב-Morning · כולל מסמכים שהופקו באתר Morning</p>
    <div class="morning-browser-filters">
      <label>שם לקוח<input id="morningSearchClient" maxlength="160" data-keydown="morning-search-enter" value="${esc(query.clientName)}" placeholder="שם הלקוח"></label>
      <label>מתאריך<input id="morningSearchFrom" type="date" value="${query.fromDate}"></label>
      <label>עד תאריך<input id="morningSearchTo" type="date" value="${query.toDate}"></label>
      <label>סוג מסמך<select id="morningSearchType" ${picker?'disabled':''}>${picker?'<option value="305">חשבונית מס</option>':options(TYPES)}</select></label>
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
  async function openDocuments(){releasePreviewUrl();picker=false;sequence++;query=defaultDocumentSearch();invalidateCache();modal('מסמכי Morning',markup(),'<button class="btn" data-action="close-modal">סגור</button>');return runSearch()}
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
  function renderResults(items){
    const headers=['תאריך','סוג','מספר מסמך','לקוח','סכום','מטבע','סטטוס','מספר הקצאה','פעולות'];
    $('#morningBrowserResults').innerHTML=`<table class="morning-browser-table"><thead><tr>${headers.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${items.map(doc=>{
      const fields=[doc.date,TYPES[doc.type]||doc.type,doc.number,doc.clientName,amount(doc.amount,''),doc.currency,STATUSES[doc.status]??doc.status,doc.allocationNumber||'—'];
      return `<tr>${fields.map((value,index)=>`<td data-label="${headers[index]}">${esc(value)}</td>`).join('')}<td data-label="פעולות"><div class="morning-browser-actions">${picker?`<button class="btn small" data-action="morning-select-invoice" data-click-arg0="${esc(doc.id)}">בחר</button>`:''}<button class="btn small" data-action="morning-browser-view" data-click-arg0="${esc(doc.id)}">צפה</button><button class="btn small" data-action="morning-download" data-click-arg0="${esc(doc.id)}">הורד</button><button class="btn small" data-action="morning-details" data-click-arg0="${esc(doc.id)}">פרטים</button></div></td></tr>`;
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
  async function viewDocument(id,button){
    if(button)button.disabled=true;const element=root();
    try{
      const blob=await fetchDocumentPdf(id);if(element&&root()!==element)return;
      releasePreviewUrl();const url=URL.createObjectURL(blob);previewObjectUrl=url;
      const browserBox=$('#morningBrowserPreview'),browserFrame=$('#morningBrowserPreviewFrame'),issuanceBox=$('#morningPreviewBox'),issuanceFrame=$('#morningPreviewFrame'),issuanceNote=$('#morningPreviewNote');
      const box=browserBox||issuanceBox,frame=browserFrame||issuanceFrame;if(!box||!frame){releasePreviewUrl();throw new Error('אזור תצוגת המסמך אינו זמין')}
      if(issuanceNote&&!browserBox)issuanceNote.textContent='מסמך רשמי שנשלף מ-Morning ואינו נשמר באתר';
      frame.addEventListener('load',()=>{if(previewObjectUrl===url){URL.revokeObjectURL(url);previewObjectUrl=''}},{once:true});frame.src=url;box.hidden=false;box.scrollIntoView({block:'nearest',behavior:'smooth'});
    }catch(error){toast(error.message||'טעינת המסמך נכשלה')}finally{if(button)button.disabled=false}
  }
  async function downloadDocument(id,button){
    if(button)button.disabled=true;
    try{const data=await backend('document_links',{document_id:String(id)}),url=new URL(data.url);if(url.protocol!=='https:')throw new Error('קישור מסמך אינו תקין');
      const anchor=document.createElement('a');anchor.href=url.href;anchor.target='_blank';anchor.rel='noopener noreferrer';anchor.download='morning-document.pdf';anchor.className='btn small';anchor.textContent='לחץ כאן אם ההורדה לא התחילה';
      const host=$('#morningBrowserStatus')||$('#morningOperationResult');if(host)host.appendChild(anchor);else document.body.appendChild(anchor);anchor.click();setTimeout(()=>anchor.remove(),60_000);
    }catch(error){toast(error.message||'הורדת המסמך נכשלה')}finally{if(button)button.disabled=false}
  }
  return {openDocuments,openInvoicePicker,search,page,selectInvoice,details,invalidateCache,viewDocument,downloadDocument};
}
