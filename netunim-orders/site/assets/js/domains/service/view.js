import {createResultPages} from '../../shared/result-pages.js';
import {createRevisionSelector} from '../../shared/revision-selector.js';
import {esc} from '../../core/values.js';
import {checkTodayISO} from '../../core/dates.js';
import {serviceStatus,serviceFollowUpDate,serviceDateLabel,compareServiceCalls,serviceEmailValue} from './model.js';
import {$} from '../../state/constants.js';

export function createDomainsServiceView({serviceRevision,model,serviceUi,mountViewLayout,serviceBulkControls,syncServiceBulkUi,toast,scheduleSave}){
  const pages=createResultPages({ui:serviceUi,action:'service-results-page'});
  const readRows=createRevisionSelector({revision:serviceRevision,name:'service',select:()=>(model.state.serviceCalls||[]).map(record=>({
    record,search:[record.customerName,record.orderNumber,record.phone,record.address,record.description,record.nextFollowUp].filter(Boolean).join(' ').toLocaleLowerCase(),
  })).sort((a,b)=>compareServiceCalls(a.record,b.record))});

  // Evaluate the date on every render, even when the data revision is unchanged.
  function serviceData(){
    const today=checkTodayISO(),q=(serviceUi.serviceSearch||'').trim().toLocaleLowerCase(),counts={all:0,due:0,closed:0};
    const rows=readRows().filter(({record:c,search})=>{
      const date=serviceFollowUpDate(c),due=!!date&&date<=today;
      if(c.closed)counts.closed++;else{counts.all++;if(due)counts.due++}
      const matches=serviceUi.serviceFilter==='closed'?!!c.closed:!c.closed&&(serviceUi.serviceFilter!=='due'||due);
      return matches&&(!q||search.includes(q));
    }).map(row=>row.record);
    return {rows,counts};
  }
  function pageServiceResults(name,delta){if(pages.move(name,delta)){renderService({resultsOnly:true});pages.focus(name,delta)}}
  function updateServiceSummary(counts){
    const main=$('#main');if(!main)return;
    for(const [key,value] of Object.entries(counts)){const el=main.querySelector(`[data-service-summary="${key}"]`);if(el)el.textContent=String(value)}
  }
  function resultsMarkup(rows){
    const page=pages.page(rows,'calls',`${serviceUi.serviceFilter}:${serviceUi.serviceSearch||''}`,{target:serviceUi.resultTarget});serviceUi.resultTarget='';
    const scope=serviceUi.serviceFilter==='closed'?'קריאות סגורות':serviceUi.serviceFilter==='due'?'קריאות למעקב היום ובאיחור':'קריאות בטיפול';
    const summary=`<div class="service-result-summary" role="status">${rows.length} ${scope}${serviceUi.serviceSearch?' · לפי החיפוש':''}<span>${serviceUi.serviceFilter==='closed'?'לפי מועד הסגירה':'דחופות ומועדי מעקב קרובים תחילה'}</span></div>`;
    if(!rows.length){
      const message=serviceUi.serviceSearch?'לא נמצאו קריאות התואמות לחיפוש.':serviceUi.serviceFilter==='due'?'אין קריאות עם מועד מעקב להיום או באיחור.':serviceUi.serviceFilter==='closed'?'אין עדיין קריאות סגורות.':'אין כרגע קריאות בטיפול.';
      return summary+`<div class="empty module-empty">${message}</div>`;
    }
    return summary+page.controls+`<div class="service-table-wrap"><table class="service-table"><caption class="sr-only">${scope}</caption><thead><tr>${serviceUi.serviceBulkMode?'<th class="bulk-check-col">בחירה</th>':''}<th>לקוח וקשר</th><th>פרטי הקריאה</th><th>מצב</th><th>פעולות</th></tr></thead><tbody>${page.rows.map(serviceRow).join('')}</tbody></table></div>`;
  }
  function renderService({resultsOnly=false}={}){
    const {rows,counts}=serviceData(),results=resultsMarkup(rows);
    if(resultsOnly){const host=$('#serviceSearchResults');if(host)host.innerHTML=results;updateServiceSummary(counts);syncServiceBulkUi();return}
    const tab=(key,label)=>`<button class="chip-filter ${serviceUi.serviceFilter===key?'active':''}" aria-pressed="${serviceUi.serviceFilter===key}" data-action="service-filter" data-click-arg0="${key}">${label} <span data-service-summary="${key}">${counts[key]}</span></button>`;
    $('#main').innerHTML=`<div class="module-toolbar service-toolbar"><div class="service-toolbar-top"><input class="service-search" aria-label="חיפוש בקריאות שירות" placeholder="חיפוש לקוח, הזמנה, טלפון או תוכן הקריאה…" value="${esc(serviceUi.serviceSearch)}" data-input="service-search"><div class="module-toolbar-actions"><button class="btn primary" data-action="open-service-modal">+ פתיחת קריאה</button></div></div><div class="service-toolbar-bottom"><div class="module-tabs" aria-label="תצוגת קריאות שירות">${tab('all','בטיפול')}${tab('due','למעקב היום')}${tab('closed','סגורות')}</div>${serviceBulkControls()}</div></div><section id="serviceSearchResults" aria-label="קריאות שירות">${results}</section>`;
    mountViewLayout({headCount:1,className:'service-view-shell',scrollKey:`service:${serviceUi.serviceFilter}`});syncServiceBulkUi();
  }
  function serviceRow(c){
    const s=serviceStatus(c),selected=serviceUi.serviceBulkSelected.has(c.id);
    const phone=String(c.phone||''),dial=phone.replace(/[^\d+*#]/g,'');
    return `<tr data-service-bulk-id="${esc(c.id)}" class="service-row ${c.closed?'is-closed':''} ${selected?'bulk-selected-row':''}">
      ${serviceUi.serviceBulkMode?`<td class="bulk-check-col"><input class="bulk-check" aria-label="בחירת הקריאה של ${esc(c.customerName)}" data-service-bulk-check type="checkbox" ${selected?'checked':''} data-action="toggle-service-bulk-row" data-change="toggle-service-bulk-row" data-click-arg0="${esc(c.id)}"></td>`:''}
      <td class="service-customer-cell"><button class="service-customer-link" data-action="open-service-modal-2" data-click-arg0="${esc(c.id)}">${esc(c.customerName||'ללא שם')}</button>${c.orderNumber?`<div class="service-row-meta">הזמנה ${esc(c.orderNumber)}</div>`:''}${phone?`<div>${dial?`<a class="service-phone" dir="ltr" href="tel:${esc(dial)}">${esc(phone)}</a>`:esc(phone)}</div>`:''}${c.address?`<div class="service-row-meta">${esc(c.address)}</div>`:''}</td>
      <td class="service-details-cell"><div class="service-row-description">${esc(c.description||'ללא פירוט')}</div><div class="service-row-meta">נפתחה ${esc(serviceDateLabel(c.openedAt))}</div></td>
      <td class="service-status-cell"><span class="badge ${s.cls}">${s.text}</span>${c.escalated&&!c.closed?'<span class="badge red">דחופה</span>':''}${c.closedAt&&c.closed?`<div class="service-row-meta">${esc(serviceDateLabel(c.closedAt))}</div>`:''}</td>
      <td class="service-actions-cell"><div class="service-row-actions">
        <button class="btn small" data-action="open-service-gmail" data-click-arg0="${esc(c.id)}" title="פתיחת טיוטת השירות במייל" aria-label="הכנת מייל לקריאה של ${esc(c.customerName)}">מייל</button>
        <button class="btn small service-sent-btn ${c.sent?'is-sent':''}" aria-pressed="${!!c.sent}" title="סימון ידני שהקריאה נשלחה" data-action="toggle-service-flag" data-click-arg0="${esc(c.id)}" data-click-arg1="sent">${c.sent?'✓ ':''}נשלח</button>
        <button class="btn small" data-action="open-service-modal-2" data-click-arg0="${esc(c.id)}" aria-label="עריכת הקריאה של ${esc(c.customerName)}">עריכה</button>
        <button class="btn small ${c.closed?'':'primary'}" data-action="toggle-service-flag" data-click-arg0="${esc(c.id)}" data-click-arg1="closed" aria-label="${c.closed?'פתיחה מחדש':'סגירת הקריאה'} של ${esc(c.customerName)}">${c.closed?'פתיחה מחדש':'סגירה'}</button>
      </div></td>
    </tr>`;
  }
  function openServiceGmail(id){
    const c=model.state.serviceCalls.find(x=>x.id===id);if(!c)return toast('קריאת השירות לא נמצאה');
    const body=['קריאת שירות – רהיטי ברגיג','',`שם לקוח: ${serviceEmailValue(c.customerName)}`,`מספר הזמנה: ${serviceEmailValue(c.orderNumber)}`,`טלפון: ${serviceEmailValue(c.phone)}`,`כתובת: ${serviceEmailValue(c.address)}`,`תאריך פתיחה: ${serviceEmailValue(c.openedAt)}`,`מצב: ${serviceStatus(c).text}`,...(c.closed&&c.closedAt?[`תאריך סגירה: ${String(c.closedAt).slice(0,10)}`]:[]),'','פירוט השירות:',serviceEmailValue(c.description)].join('\n');
    window.open(`https://mail.google.com/mail/?view=cm&fs=1&to=&su=${encodeURIComponent('קריאת שירות רהיטי ברגיג')}&body=${encodeURIComponent(body)}`,'_blank','noopener,noreferrer');
  }
  function toggleServiceFlag(id,field){
    const c=model.state.serviceCalls.find(x=>x.id===id);if(!c||!['followUp','sent','escalated','closed'].includes(field))return;
    c[field]=!c[field];c.updatedAt=new Date().toISOString();if(field==='closed')c.closedAt=c.closed?c.updatedAt:null;
    scheduleSave(field==='closed'?(c.closed?'הקריאה נסגרה והועברה לסגורות':'הקריאה נפתחה מחדש והועברה לטיפול'):'קריאת השירות עודכנה',{operations:[{type:'put',collection:'serviceCalls',id:c.id,mode:'replace',record:c}]});
    const row=document.querySelector?.(`[data-service-bulk-id="${CSS.escape(String(id))}"]`),data=serviceData();
    if(row&&field!=='escalated'&&data.rows.some(item=>item.id===id)){
      const focused=row.contains(document.activeElement),focusField=document.activeElement?.dataset?.clickArg1;
      row.outerHTML=serviceRow(c);updateServiceSummary(data.counts);syncServiceBulkUi();
      if(focused&&focusField)document.querySelector(`[data-service-bulk-id="${CSS.escape(String(id))}"] [data-click-arg1="${CSS.escape(focusField)}"]`)?.focus();
    }else{
      const focused=!!row?.contains(document.activeElement);renderService({resultsOnly:true});
      if(focused)document.querySelector('[data-service-bulk-id] .service-customer-link')?.focus();
      if(focused&&!document.querySelector('[data-service-bulk-id]'))document.querySelector('.service-toolbar .chip-filter.active')?.focus();
    }
  }
  return {pageServiceResults,renderService,openServiceGmail,serviceRow,toggleServiceFlag};
}
