import {syncIncidentDescription} from './sync-incident-model.js';
import {createStatusNotices} from './status-notices.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function createSyncIncidentUi({document=globalThis.document,container=document.body,inline=false,clientId,label,saveLabel,refresh,review,financial,notices,confirmReview=async()=>false}){
  const root=document.createElement('section');root.className='sync-incidents';root.dir='rtl';root.hidden=true;root.setAttribute('aria-label','התראות סנכרון בין מחשבים');
  root.dataset.inline=String(inline);container.append(root);
  const attentionNotices=inline?null:notices??createStatusNotices({document,getToast:()=>null});
  const acknowledged=new Set();
  let state={status:'signed_out',incidents:[],localError:false},opened=inline,last='',error='',renderedLabel='',noticeKey='';
  async function openAttention(signal){
    opened=true;render();
    if(signal.operationId){
      await financial.search('active',signal.operationId);
      const detail=[...root.querySelectorAll('[data-incident-details]')].find(node=>node.dataset.incidentDetails===signal.operationId);
      if(detail){detail.open=true;detail.querySelector('summary')?.focus()}
    }else root.querySelector('.sync-incidents-panel')?.querySelector('button')?.focus();
  }
  function publishAttention(){
    if(!attentionNotices)return;
    const own=state.incidents.filter(row=>['local_durability_error','recovery_blocked','conflict'].includes(row.reason_code));
    const keyFor=row=>'sync:'+row.incident_id+':'+row.reason_code;
    const keys=new Set(own.map(keyFor));
    if(state.status!=='unavailable')for(const key of acknowledged)if(!keys.has(key))acknowledged.delete(key);
    const incident=own.find(row=>!acknowledged.has(keyFor(row)));
    const attention=state.status==='signed_out'?null:financial?.attention||(incident&&{
      key:keyFor(incident),severity:'critical',message:syncIncidentDescription(incident,clientId),
      acknowledge:()=>{acknowledged.add(keyFor(incident));render()},
    });
    if(noticeKey&&noticeKey!==attention?.key)attentionNotices.clearNotice(noticeKey);
    noticeKey=attention?.key||'';
    if(attention)attentionNotices.toast(attention.message,{id:attention.key,severity:attention.severity,
      actionLabel:attention.operationId?'פרטי הפעולה':'פתח מרכז בקרה',action:()=>openAttention(attention),
      acknowledge:()=>{if(attention.acknowledge)attention.acknowledge();else financial.acknowledge(attention)}});
  }
  function render(){
    publishAttention();
    const count=state.incidents.length,financialCount=financial?.count||0,cloudNotice=financial?.cloudStatusLabel||'';
    const savedLabel=String(label()||'').trim(),warning=count>0||financialCount>0||!!cloudNotice||state.status==='unavailable'||state.localError;
    root.hidden=!inline&&(state.status==='signed_out'||!!savedLabel&&!warning);
    if(root.hidden){opened=false;root.replaceChildren();return}
    const input=root.querySelector('[data-incident-label]'),focused=input&&document.activeElement===input;
    const search=root.querySelector('[data-morning-search]'),active=document.activeElement;
    const focusName=search?.contains(active)?active.name:null;
    const focusSearch=search?.contains(active)&&active?.tagName==='BUTTON';
    const editedTerm=search&&search.elements.query.value!==search.elements.query.defaultValue;
    const editedFilter=search&&![...search.elements.filter.options].some(option=>option.defaultSelected&&option.selected);
    const textSelection=focusName==='query'?[active.selectionStart,active.selectionEnd,active.selectionDirection]:null;
    const detailFocus=root.contains(active)&&active?.tagName==='SUMMARY'?active.parentElement?.dataset.incidentDetails:null;
    const focusAction=root.contains(active)?active?.dataset?.incidentAction:null,focusId=active?.dataset?.incidentId;
    const openDetailIds=new Set([...root.querySelectorAll('[data-incident-details][open]')].map(detail=>detail.dataset.incidentDetails));
    const scrollTop=root.querySelector('.sync-incidents-panel')?.scrollTop||0;
    root.dataset.quiet=String(!opened&&!warning&&state.status==='no_reported_incidents');
    root.dataset.warning=String(warning);
    const title=count?`אזהרת סנכרון: ${count} ${count===1?'תקלה מדווחת':'תקלות מדווחות'}`:state.status==='unavailable'?'לא ניתן לבדוק התראות סנכרון כרגע':state.localError?'דיווח תקלות הסנכרון לא הושלם':state.status==='signed_out'?'יש להתחבר לענן כדי לבדוק תקלות מדווחות':'לא נמצאו תקלות סנכרון מדווחות';
    root.innerHTML=`${inline?`<h3>התראות סנכרון ושם עמדה</h3><p role="status">${escape(title)}</p>`:`<button type="button" class="sync-incidents-toggle" aria-expanded="${opened}" data-incident-action="toggle">
      <span role="status">${escape(cloudNotice|| (financialCount?`${financial?.more?'50+':financialCount} פעולות מורנינג ממתינות${count?` · ${count} תקלות סנכרון`:''}`:!warning&&!savedLabel?'הגדרת שם מחשב להתראות סנכרון':title))}</span><span>${opened?'סגירה':'פרטים'}</span></button>`}
      <div class="sync-incidents-panel" ${opened?'':'hidden'}>
        ${opened&&financial?financial.markup(escape):''}
        <p>התראות על שינויים שלא סונכרנו ותקלות בעמדות. היעדר דיווח אינו הוכחה שכל המחשבים מסונכרנים.</p>
        ${state.status==='unavailable'?'<p role="status">רשימת התקלות אינה מעודכנת כרגע. כדאי לבדוק את החיבור ולרענן.</p>':''}
        ${state.localError?'<p role="status">דיווח התקלות ממחשב זה לא הושלם. השמירה העסקית ממשיכה לפי מצב הסנכרון שלה.</p>':''}
        <ul>${state.incidents.map(row=>`<li>${row.scope_epoch==='unavailable'?'<p>דור האחסון לא זוהה בזמן התקלה. יש לבדוק את השינויים בעמדה המדווחת ולטפל ידנית; סנכרון מדור אחר אינו מוכיח שהתקלה נפתרה.</p>':''}
          <strong>${escape(syncIncidentDescription(row,clientId))}</strong><p>דווח: ${escape(new Date(row.first_reported_at).toLocaleString('he-IL'))}</p>
          <button type="button" data-incident-action="review" data-incident-id="${escape(row.incident_id)}">בדיקה וטיפול ידני</button></li>`).join('')}</ul>
        <label>שם עמדה באתר זה <input data-incident-label maxlength="80" value="${escape(savedLabel)}" placeholder="למשל: מחשב משרד"></label>
        <div class="sync-incidents-actions"><button type="button" data-incident-action="label">שמירת שם</button><button type="button" data-incident-action="refresh">רענון</button>${inline?'':'<button type="button" data-incident-action="toggle">הבנתי</button>'}</div>
        <p role="status" class="sync-incidents-error">${escape(error)}</p>
      </div>`;
    if(input){if(!focused&&input.value===renderedLabel)input.value=savedLabel;root.querySelector('[data-incident-label]').replaceWith(input);if(focused)input.focus()}
    if(search&&(focusName||focusSearch||editedTerm||editedFilter)){
      const next=root.querySelector('[data-morning-search]');
      if(next){
        if(editedTerm||focusName==='query')next.elements.query.value=search.elements.query.value;
        if(editedFilter||focusName==='filter')next.elements.filter.value=search.elements.filter.value;
        next.elements[focusName]?.focus({preventScroll:true});
        if(focusSearch)next.querySelector('button:not(:disabled)')?.focus({preventScroll:true});
        if(textSelection)next.elements.query.setSelectionRange(...textSelection);
      }
    }else if(focusAction){
      [...root.querySelectorAll('[data-incident-action]')].find(button=>button.dataset.incidentAction===focusAction&&button.dataset.incidentId===focusId)?.focus({preventScroll:true});
    }
    for(const details of root.querySelectorAll('[data-incident-details]')){
      if(openDetailIds.has(details.dataset.incidentDetails))details.open=true;
      if(detailFocus&&details.dataset.incidentDetails===detailFocus)details.querySelector('summary')?.focus({preventScroll:true});
    }
    const panel=root.querySelector('.sync-incidents-panel');if(panel)panel.scrollTop=scrollTop;
    renderedLabel=savedLabel;
  }
  async function click(event){
    const button=event.target.closest?.('[data-incident-action]');if(!button||!root.contains(button))return;
    error='';
    const action=button.dataset.incidentAction;
    if(action==='toggle'){opened=!opened;render();return}
    button.disabled=true;
    try{
      if(action==='label'){
        const input=root.querySelector('[data-incident-label]');input.value=input.value.trim();saveLabel(input.value);
        if(!inline)opened=false;render();await refresh();
      }
      if(action==='refresh')await refresh();
      if(action.startsWith('morning-')){
        await financial?.action(action,button.dataset.incidentId);
        if(action==='morning-ack'&&!inline&&!financial?.unread)opened=false;
      }
      if(action==='review'){
        const row=state.incidents.find(item=>item.incident_id===button.dataset.incidentId);
        if(row&&await confirmReview('יש לבדוק תחילה את השינויים בעמדה המדווחת. הפעולה מיועדת לעמדה שאינה זמינה או לאירוע שלא ניתן לאמת את דור האחסון שלו. היא מסירה את ההתראה בלי לאמת סנכרון. להמשיך?'))await review(row);
      }
    }catch{error='הפעולה לא הושלמה. יש לרענן ולנסות שוב.'}
    render();
  }
  function submit(event){
    const form=event.target.closest?.('[data-morning-search]');if(!form||!root.contains(form))return;
    event.preventDefault();void financial?.search(form.elements.filter.value,form.elements.query.value);
  }
  root.addEventListener('click',click);
  root.addEventListener('submit',submit);
  return {update(value,force=false){state=value;const signature=JSON.stringify([value,label()]);if(force||last!==signature){last=signature;render()}},
    open(){opened=true;render()},isOpen:()=>opened&&!root.hidden&&root.isConnected,
    clearAttention(){acknowledged.clear();if(noticeKey)attentionNotices?.clearNotice(noticeKey);noticeKey=''},
    dispose(){if(noticeKey)attentionNotices?.clearNotice(noticeKey);root.removeEventListener('click',click);root.removeEventListener('submit',submit);root.remove()}};
}
