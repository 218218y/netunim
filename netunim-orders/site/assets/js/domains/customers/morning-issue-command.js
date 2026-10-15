import {documentLabel} from './morning-document-view.js';
import {money} from '../../core/money.js';

// Admission and captured confirmation precede the existing issuance authority.
// Accepted work remains joined by the controller lifetime after its modal closes.
export function createMorningIssueCommand({session,form,issuance,application,recovery,display,media,feedback,connectivity}){
async function createMorningDocument(button){
  if(session.read().createBusy||session.read().blocked||session.read().completed)return;
  const rejectCurrentIssuance=session.reject;
  if(rejectCurrentIssuance())return;
  let payload,assertCurrent;try{session.assertModal();assertCurrent=session.capture();payload=form.read()}catch(error){return feedback.toast(error.message)}
  const generation=session.generation(),issuanceEpoch=session.interruptionEpoch(),type=payload.document.type,amount=payload.document.amount,clientName=payload.document.client.name,policy=form.policy(type);
  let context;try{context=form.context(type,amount,policy,payload.operation_id)}catch(error){return feedback.toast(error.message)}
  session.cancelStatus();session.update({createBusy:true});display.busy(button,true,'מפיק…');
  try{
    const confirmed=await display.confirm('הפקת מסמך רשמי',`להפיק ${documentLabel(type)} על סך ${money(amount)} עבור ${clientName}?\nלאחר ההפקה המסמך יקבל מספר רשמי ב-Morning.${form.confirmation(type,amount,policy)}`,{confirmText:'הפק מסמך',cancelText:'חזור לעריכה',tone:'primary',signal:session.signal()});
    if(!confirmed)return;assertCurrent();if(!session.isActive(generation))return;
    if(rejectCurrentIssuance())return;
    const data=await issuance.issue(payload,context,assertCurrent);assertCurrent();
    const result=await application.apply(context,{operationId:context.operationId,documentId:data.document.id,documentNumber:data.document.number,type:data.document.type??type,amount:data.document.amount??amount,verifiedAt:new Date().toISOString()},{immediate:issuanceEpoch===session.interruptionEpoch()&&connectivity.isOnline(),assertCurrent,isCurrent:()=>session.isActive(generation)});assertCurrent();const settlement=recovery.settle(context.operationId,result,{serverLinkPending:!!data.local_link_pending||!!data.bank_link_pending}),durable=settlement.durable,recoveryCleared=settlement.recoveryCleared;if(recoveryCleared)recovery.notify(context,data.bank_link);
    media.invalidateCache();
    let pdfLoaded=false;if(session.isActive(generation))pdfLoaded=await media.viewDocument(data.document.id,null,{quiet:true});assertCurrent();
    if(session.isActive(generation)){
      display.operation({state:'created',verified_at:new Date().toISOString(),document_id:data.document.id,document_number:data.document.number,allocation_number:data.document.allocationNumber});
      const message=!durable?'המסמך הופק ואומת ב-Morning, אך עדכון החוב עדיין ממתין לשמירה מקומית בטוחה.':(data.local_link_pending||data.bank_link_pending)?'המסמך הופק ואומת ב-Morning. שמירת הקישור המקומי עדיין בבדיקה.':!recoveryCleared?'המסמך הופק ואומת, אך נקודת ההתאוששות המקומית לא נמחקה ולכן ההפקה נשארת נעולה עד בדיקה נוספת.':pdfLoaded?'המסמך הופק, אומת וה-PDF הרשמי נטען מ-Morning.':'המסמך הופק ואומת ב-Morning. ה-PDF הרשמי לא נטען כרגע; אפשר ללחוץ „צפה”.';
      display.status(!durable||data.local_link_pending||data.bank_link_pending||!recoveryCleared||!pdfLoaded?'warning':'ready',message);
      if(button){button.dataset.idleLabel='הופק ואומת';button.textContent='הופק ואומת'}
    }
    session.update({blocked:settlement.blocked,completed:true});if(session.isActive(generation))display.markSaved();
    if(session.read().blocked)recovery.schedule(60_000,assertCurrent);
    feedback.toast(`${documentLabel(type)} ${data.document.number||''} הופק ואומת ב-Morning`);
  }catch(error){
    if(session.scopeChanged(error)){session.update({blocked:true});return false}
    if(error?.details?.operation_id)recovery.adopt(error.details.operation_id);
    if(error?.details?.prevent_retry){
      session.update({blocked:true,completed:true});if(session.isActive(generation))display.markSaved();const existing=error.details.document;if(existing?.id)display.operation({state:'created',verified_at:new Date().toISOString(),document_id:existing.id,document_number:existing.number,allocation_number:existing.allocationNumber});
      if(session.isActive(generation))display.status('warning','ניסיון זהה קודם כבר אומת. לא יופק מסמך נוסף; לחץ „בדוק מצב הפקה” כדי להשלים את עדכון החוב לפי נקודת ההתאוששות שנשמרה.');
      if(button){button.dataset.idleLabel='ננעל למניעת כפילות';button.textContent='ננעל למניעת כפילות'}recovery.schedule(15_000,assertCurrent);
    }else{
      // Only explicit server rejection is safely retryable; transport loss remains uncertain.
      if(error?.status&&error.status<500&&!error?.details?.uncertain){const failedOperation=session.operationId();recovery.reset(failedOperation)}
      if(session.isActive(generation))display.status(session.read().blocked?'warning':'error',session.read().blocked?'ההפקה ממתינה לאימות. נקודת ההתאוששות נשמרה ולא יישלח ניסיון נוסף.':error.message);
    }
    feedback.toast(error.message||'יש לבדוק את מצב ההפקה');
  }finally{session.update({createBusy:false});display.busy(button,false);if(button)button.disabled=session.read().blocked||session.read().completed}
}
return {create:createMorningDocument};
}
