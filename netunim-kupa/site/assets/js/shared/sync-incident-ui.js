import {syncIncidentDescription} from './sync-incident-model.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function createSyncIncidentUi({document=globalThis.document,container=document.body,inline=false,clientId,label,saveLabel,refresh,review,confirmReview=async()=>false}){
  const root=document.createElement('section');root.className='sync-incidents';root.dir='rtl';root.hidden=true;root.setAttribute('aria-label','התראות סנכרון בין מחשבים');
  root.dataset.inline=String(inline);container.append(root);
  let state={status:'signed_out',incidents:[],localError:false},opened=inline,last='',error='',renderedLabel='';
  function render(){
    const count=state.incidents.length;
    const savedLabel=String(label()||'').trim(),warning=count>0||state.status==='unavailable'||state.localError;
    root.hidden=!inline&&(state.status==='signed_out'||!!savedLabel&&!warning);
    if(root.hidden){opened=false;root.replaceChildren();return}
    const input=root.querySelector('[data-incident-label]'),focused=input&&document.activeElement===input;
    root.dataset.quiet=String(!opened&&state.status==='no_reported_incidents'&&!state.localError);
    root.dataset.warning=String(warning);
    const title=count?`אזהרת סנכרון: ${count} ${count===1?'תקלה מדווחת':'תקלות מדווחות'}`:state.status==='unavailable'?'לא ניתן לבדוק התראות סנכרון כרגע':state.localError?'דיווח תקלות הסנכרון לא הושלם':state.status==='signed_out'?'יש להתחבר לענן כדי לבדוק תקלות מדווחות':'לא נמצאו תקלות סנכרון מדווחות';
    root.innerHTML=`${inline?`<h3>התראות סנכרון ושם עמדה</h3><p role="status">${escape(title)}</p>`:`<button type="button" class="sync-incidents-toggle" aria-expanded="${opened}" data-incident-action="toggle">
      <span role="status">${escape(!warning&&!savedLabel?'הגדרת שם מחשב להתראות סנכרון':title)}</span><span>${opened?'סגירה':'פרטים'}</span></button>`}
      <div class="sync-incidents-panel" ${opened?'':'hidden'}>
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
      if(action==='review'){
        const row=state.incidents.find(item=>item.incident_id===button.dataset.incidentId);
        if(row&&await confirmReview('יש לבדוק תחילה את השינויים בעמדה המדווחת. הפעולה מיועדת לעמדה שאינה זמינה או לאירוע שלא ניתן לאמת את דור האחסון שלו. היא מסירה את ההתראה בלי לאמת סנכרון. להמשיך?'))await review(row);
      }
    }catch{error='הפעולה לא הושלמה. יש לרענן ולנסות שוב.'}
    render();
  }
  root.addEventListener('click',click);
  return {update(value){state=value;const signature=JSON.stringify([value,label()]);if(last!==signature){last=signature;render()}},open(){opened=true;render()},dispose(){root.removeEventListener('click',click);root.remove()}};
}
