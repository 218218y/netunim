const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const domains={orders_main:'נתוני הזמנות',kupa_main:'נתוני קופה',shared_checks:'צ׳קים משותפים',orders_sheet:'גיליונות הזמנות',kupa_sheet:'גיליונות קופה',orders_calendar:'יומן Google'};
const reasons={stalled:'שינויים ממתינים ללא אישור סנכרון',conflict:'התנגשות שדורשת בדיקה',recovery_blocked:'התאוששות הסנכרון נעצרה',local_durability_error:'לא ניתן לאמת שמירה מקומית עמידה'};

export function syncIncidentDescription(row,clientId){
  return `${row.device_label||'עמדה ללא שם'} · ${row.client_instance_id===clientId?'התקנה זו':'התקנה אחרת'} · ${row.site==='orders'?'הזמנות':'קופה'} · ${domains[row.domain]} · ${reasons[row.reason_code]}`;
}
export function createSyncIncidentUi({document=globalThis.document,clientId,label,saveLabel,refresh,review,confirm=message=>globalThis.confirm(message)}){
  const root=document.createElement('section');root.className='sync-incidents';root.dir='rtl';root.hidden=true;root.setAttribute('aria-label','התראות סנכרון בין מחשבים');
  document.body.append(root);
  let state={status:'signed_out',incidents:[],localError:false},opened=false,last='',error='';
  function render(){
    root.hidden=state.status==='signed_out';
    if(root.hidden){opened=false;root.replaceChildren();return}
    const count=state.incidents.length;
    root.dataset.warning=String(count>0||state.status==='unavailable'||state.localError);
    const title=count?`אזהרת סנכרון: ${count} ${count===1?'תקלה מדווחת':'תקלות מדווחות'}`:state.status==='unavailable'?'לא ניתן לבדוק התראות סנכרון כרגע':'לא נמצאו תקלות סנכרון מדווחות';
    root.innerHTML=`<button type="button" class="sync-incidents-toggle" aria-expanded="${opened}" data-incident-action="toggle"><span role="status">${escape(title)}</span><span>${opened?'סגירה':'פרטים'}</span></button>
      <div class="sync-incidents-panel" ${opened?'':'hidden'}>
        <p>התראות על שינויים שלא סונכרנו ותקלות בעמדות. היעדר דיווח אינו הוכחה שכל המחשבים מסונכרנים.</p>
        ${state.status==='unavailable'?'<p role="status">רשימת התקלות אינה מעודכנת כרגע. כדאי לבדוק את החיבור ולרענן.</p>':''}
        ${state.localError?'<p role="status">דיווח התקלות ממחשב זה לא הושלם. השמירה העסקית ממשיכה לפי מצב הסנכרון שלה.</p>':''}
        <ul>${state.incidents.map(row=>`<li><strong>${escape(syncIncidentDescription(row,clientId))}</strong><p>דווח: ${escape(new Date(row.first_reported_at).toLocaleString('he-IL'))}</p><button type="button" data-incident-action="review" data-incident-id="${escape(row.incident_id)}">טיפול ידני בעמדה שאינה זמינה</button></li>`).join('')}</ul>
        <label>שם עמדה באתר זה <input data-incident-label maxlength="80" value="${escape(label())}" placeholder="למשל: מחשב משרד"></label>
        <div class="sync-incidents-actions"><button type="button" data-incident-action="label">שמירת שם</button><button type="button" data-incident-action="refresh">רענון</button><button type="button" data-incident-action="toggle">הבנתי</button></div>
        <p role="status" class="sync-incidents-error">${escape(error)}</p>
      </div>`;
  }
  async function click(event){
    const button=event.target.closest?.('[data-incident-action]');if(!button||!root.contains(button))return;
    error='';
    const action=button.dataset.incidentAction;
    if(action==='toggle'){opened=!opened;render();return}
    button.disabled=true;
    try{
      if(action==='label'){saveLabel(root.querySelector('[data-incident-label]').value.trim());await refresh()}
      if(action==='refresh')await refresh();
      if(action==='review'){
        const row=state.incidents.find(item=>item.incident_id===button.dataset.incidentId);
        if(row&&confirm('הפעולה מיועדת לעמדה שנהרסה או שיצאה משימוש, לאחר בדיקת השינויים שלה. היא מסירה את ההתראה בלי לאמת סנכרון. להמשיך?'))await review(row);
      }
    }catch{error='הפעולה לא הושלמה. יש לרענן ולנסות שוב.'}
    render();
  }
  root.addEventListener('click',click);
  return {update(value){state=value;const signature=JSON.stringify(value);if(last!==signature){last=signature;render()}},open(){opened=true;render()},dispose(){root.removeEventListener('click',click);root.remove()}};
}
