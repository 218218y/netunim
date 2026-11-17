import {esc,uid} from '../../core/values.js';
import {checkTodayISO} from '../../core/dates.js';
import {$} from '../../state/constants.js';

export function createDomainsServiceEditor({model,serviceUi,modal,toast,scheduleSave,closeModal,renderService,confirmDialog,dateEditorMarkup}){
  function openServiceModal(id=null){
    const c=id?model.state.serviceCalls.find(x=>x.id===id):null;
    if(id&&!c)return toast('קריאת השירות לא נמצאה');
    modal(c?'עדכון קריאת שירות':'פתיחת קריאת שירות',`<div class="form-grid service-editor-form">
      <div class="field"><label for="svcName">שם לקוח</label><input id="svcName" required value="${esc(c?.customerName||'')}"></div>
      <div class="field"><label for="svcOrder">מספר הזמנה</label><input id="svcOrder" value="${esc(c?.orderNumber||'')}"></div>
      <div class="field"><label for="svcPhone">טלפון</label><input id="svcPhone" type="tel" value="${esc(c?.phone||'')}"></div>
      <div class="field"><label>תאריך פתיחה</label>${dateEditorMarkup('svcOpened',c?.openedAt||checkTodayISO(),{label:'תאריך פתיחה'})}</div>
      <div class="field full"><label for="svcAddress">כתובת</label><input id="svcAddress" value="${esc(c?.address||'')}"></div>
      <div class="field full"><label for="svcDesc">פירוט השירות</label><textarea id="svcDesc" required>${esc(c?.description||'')}</textarea></div>
      <div class="field"><label>מועד המעקב הבא</label>${dateEditorMarkup('svcNext',c?.nextFollowUp||'',{label:'מועד המעקב הבא'})}</div>
      <div class="field service-editor-options"><label><input id="svcUrgent" type="checkbox" ${c?.escalated?'checked':''}> קריאה דחופה</label></div>
      ${c?.source?`<details class="field full service-source-details"><summary>מקור הקריאה</summary><small>${esc(c.source.sheet)} · שורות ${esc(c.source.rows)}</small></details>`:''}
    </div>`,`<button class="btn primary" data-action="save-service" data-click-arg0="${esc(id||'')}">שמור טיפול</button>${c?`<button class="btn danger" data-action="delete-service" data-click-arg0="${esc(c.id)}">מחק</button>`:''}<button class="btn" data-action="close-modal">ביטול</button>`);
  }
  function saveService(id=''){
    const name=$('#svcName').value.trim(),desc=$('#svcDesc').value.trim();
    if(!name)return toast('יש להזין שם לקוח');if(!desc)return toast('יש להזין פירוט שירות');
    const c=id?model.state.serviceCalls.find(x=>x.id===id):null;
    if(id&&!c)return toast('קריאת השירות לא נמצאה; יש לפתוח אותה מחדש מהרשימה');
    const row={...(c||{}),id:c?.id||uid('SVC'),orderNumber:$('#svcOrder').value.trim(),customerName:name,phone:$('#svcPhone').value.trim(),address:$('#svcAddress').value.trim(),description:desc,openedAt:$('#svcOpened').value||checkTodayISO(),nextFollowUp:$('#svcNext').value,followUp:!!c?.followUp,sent:!!c?.sent,escalated:$('#svcUrgent').checked,closed:!!c?.closed,updatedAt:new Date().toISOString()};
    if(c)Object.assign(c,row);else model.state.serviceCalls.push(row);
    closeModal();scheduleSave(c?'קריאת השירות עודכנה':'קריאת השירות נפתחה',{operations:[{type:'put',collection:'serviceCalls',id:row.id,mode:c?'replace':'insert',index:model.state.serviceCalls.findIndex(item=>item.id===row.id),record:row}]});
    // A newly opened call must be visible even when created from the closed/due view.
    if(!c){serviceUi.serviceFilter='all';serviceUi.serviceSearch='';serviceUi.resultTarget=row.id;renderService();return}
    renderService({resultsOnly:true});
  }
  async function deleteService(id){
    const c=model.state.serviceCalls.find(x=>x.id===id);if(!c)return;
    if(!await confirmDialog('מחיקת קריאת שירות',`למחוק את קריאת השירות של ${c.customerName}?`,{confirmText:'מחק קריאה'}))return;
    model.state.serviceCalls=model.state.serviceCalls.filter(x=>x.id!==id);closeModal();
    scheduleSave('קריאת השירות נמחקה',{deleteIntents:{serviceCalls:[id]},mutationType:'delete',surface:'orders.delete.serviceCalls',operations:[{type:'delete',collection:'serviceCalls',id}]});renderService({resultsOnly:true});
  }
  return {openServiceModal,saveService,deleteService};
}
