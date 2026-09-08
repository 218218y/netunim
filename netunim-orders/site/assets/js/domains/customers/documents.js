import {esc} from '../../core/values.js';
import {money} from '../../core/money.js';
import {$} from '../../state/constants.js';

const BACKEND_PATH='/functions/v1/morning-documents';
const DOCUMENT_TYPES=Object.freeze({305:'חשבונית מס',320:'חשבונית מס / קבלה',400:'קבלה'});
const PAYMENT_TYPES=Object.freeze({1:'מזומן',2:'צ׳ק',3:'כרטיס אשראי',4:'העברה בנקאית'});
const CARD_TYPES=Object.freeze({1:'ישראכרט',2:'Visa',3:'Mastercard',4:'American Express',5:'Diners'});
let previewObjectUrl='';

function todayLocal(){const d=new Date(),shift=d.getTimezoneOffset()*60_000;return new Date(d.getTime()-shift).toISOString().slice(0,10)}
function documentLabel(type){return DOCUMENT_TYPES[Number(type)]||`מסמך ${Number(type)||''}`}
function cleanText(value,max=250){return String(value??'').trim().slice(0,max)}
function currentField(id){return $('#'+id)}
function setBusy(button,busy,label=''){if(!button)return;button.disabled=!!busy;if(busy&&label){if(!button.dataset.idleLabel)button.dataset.idleLabel=button.textContent||'';button.textContent=label}else if(!busy&&button.dataset.idleLabel)button.textContent=button.dataset.idleLabel}

export function createDomainsCustomersDocuments({model,modal,toast,confirmDialog,supaFetch,dateEditorMarkup,documentsBrowser}){
let activeOperationId='',modalGeneration=0,createBusy=false,blocked=false,completed=false;
function defaultDescription(d,standalone=false){if(standalone)return'';const order=cleanText(d?.orderNumber,80);return order?`הזמנה ${order}`:`עבור ${cleanText(d?.customerName,120)||'לקוח'}`}
function newOperationId(){return globalThis.crypto.randomUUID()}

async function backend(action,payload={}){
  let response;
  try{response=await supaFetch(BACKEND_PATH,{method:'POST',networkRetry:false,dataPriority:'high',body:JSON.stringify({action,...payload})})}
  catch(error){const wrapped=new Error(error?.message||'לא ניתן להגיע לשירות Morning');wrapped.code=error?.code||'morning_backend_unreachable';throw wrapped}
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data?.ok===false){const error=new Error(String(data?.message||'שירות Morning החזיר שגיאה'));error.code=String(data?.code||'morning_backend_error');error.status=response.status;error.details=data;throw error}
  return data;
}

function documentButton(d){
  return `<button class="icon-btn morning-document-button" title="הפק מסמך ב-Morning" aria-label="הפק מסמך ב-Morning" data-action="open-morning-document" data-click-arg0="${esc(d.id)}"><span aria-hidden="true">▤</span></button>`;
}

function paymentFields(dateEditorMarkup){return `<div id="morningPaymentFields" class="morning-payment-panel">
  <div class="morning-section-title"><span>פרטי תקבול</span><small>נדרש לחשבונית מס/קבלה ולקבלה</small></div>
  <div class="form-grid">
    <div class="field"><label>אמצעי תשלום</label><select id="morningPaymentType" data-change="morning-payment-type"><option value="4">העברה בנקאית</option><option value="1">מזומן</option><option value="2">צ׳ק</option><option value="3">כרטיס אשראי</option></select></div>
    <div class="field"><label>תאריך תשלום</label>${dateEditorMarkup('morningPaymentDate',todayLocal(),{label:'תאריך תשלום'})}</div>
    <div class="field full morning-transfer-fields" data-payment-kind="4"><label>אסמכתא / מספר העברה <small>(רשות)</small></label><input id="morningTransferRef" maxlength="80" placeholder="למשל מספר אסמכתא מהבנק"></div>
    <div class="field morning-card-fields" data-payment-kind="3" hidden><label>סוג כרטיס</label><select id="morningCardType">${Object.entries(CARD_TYPES).map(([value,label])=>`<option value="${esc(value)}">${esc(label)}</option>`).join('')}</select></div>
    <div class="field morning-card-fields" data-payment-kind="3" hidden><label>4 ספרות אחרונות</label><input id="morningCardLast4" inputmode="numeric" maxlength="4" placeholder="1234"></div>
    <div class="field morning-check-fields" data-payment-kind="2" hidden><label>בנק</label><input id="morningCheckBank" maxlength="80"></div>
    <div class="field morning-check-fields" data-payment-kind="2" hidden><label>סניף</label><input id="morningCheckBranch" maxlength="30"></div>
    <div class="field morning-check-fields" data-payment-kind="2" hidden><label>חשבון</label><input id="morningCheckAccount" maxlength="40"></div>
    <div class="field morning-check-fields" data-payment-kind="2" hidden><label>מספר צ׳ק</label><input id="morningCheckNumber" maxlength="40"></div>
  </div>
</div>`}

function formBody(d,type,dateEditorMarkup,{standalone=false}={}){
  const amountValue=Number(d?.amount),amountInput=Number.isFinite(amountValue)&&amountValue>0?amountValue.toFixed(2):'';
  const heroAmount=standalone?'<div class="morning-amount standalone"><small>מסמך כללי</small></div>':`<div class="morning-amount"><small>סכום החוב</small><b>${money(d.amount)}</b></div>`;
  const formHint=standalone?'הזן את פרטי הלקוח והמסמך. המסמך אינו יוצר חוב ואינו תלוי ברשומת חוב.':'הפרטים נלקחים מהחוב וניתנים לעריכה לפני ההפקה';
  return `<div class="morning-document-dialog" data-morning-generation="${modalGeneration}">
    <div class="morning-document-hero"><div><span class="morning-brand">Morning</span><h4>${standalone?'הפקת מסמך כללי':'הפקת מסמך ללקוח'}</h4><p>המסמך הרשמי יופק ויישמר ב-Morning. באתר נשמרת רק הפניה קטנה למסמך.</p></div>${heroAmount}</div>
    <div id="morningConnectionStatus" class="morning-connection loading"><span class="morning-dot"></span><span>בודק חיבור ל-Morning…</span></div>
    <div class="morning-type-picker" role="group" aria-label="סוג מסמך">
      ${Object.entries(DOCUMENT_TYPES).map(([value,label])=>`<label class="morning-type-option"><input type="radio" name="morningDocumentType" value="${esc(value)}" data-change="morning-document-type" ${Number(value)===Number(type)?'checked':''}><span><b>${esc(label)}</b><small>${Number(value)===305?'חיוב ללא תקבול':Number(value)===320?'חשבונית ותקבול במסמך אחד':'תקבול כנגד חשבונית/חיוב'}</small></span></label>`).join('')}
    </div>
    <div class="morning-form-card">
      <div class="morning-section-title"><span>פרטי המסמך</span><small>${formHint}</small></div>
      <div class="form-grid">
        <div class="field"><label>שם לקוח</label><input id="morningClientName" maxlength="160" value="${esc(d.customerName||'')}"></div>
        <div class="field"><label>סכום כולל מע״מ</label><input id="morningAmount" class="number-input" type="number" min="0.01" step="0.01" value="${esc(amountInput)}" placeholder="0.00"></div>
        <div class="field"><label>אימייל <small>(רשות)</small></label><input id="morningClientEmail" type="email" maxlength="180" value="${esc(d.email||'')}"></div>
        <div class="field"><label>טלפון <small>(רשות)</small></label><input id="morningClientPhone" inputmode="tel" maxlength="50" value="${esc(d.phone||'')}"></div>
        <div class="field"><label>מספר עוסק / ח.פ. <small>(רשות)</small></label><input id="morningClientTaxId" inputmode="numeric" maxlength="9" value="${esc(d.taxId||'')}"></div>
        <div class="field"><label>תאריך מסמך</label>${dateEditorMarkup('morningDocumentDate',todayLocal(),{label:'תאריך מסמך'})}</div>
        <div class="field morning-due-date-field" data-document-kind="305"><label>לתשלום עד <small>(רשות)</small></label>${dateEditorMarkup('morningDueDate','',{label:'תאריך לתשלום'})}</div>
        <div class="field"><label>מספר הזמנה <small>(לזיהוי אצלך)</small></label><input id="morningOrderNumber" maxlength="80" value="${esc(d.orderNumber||'')}"></div>
        <div class="field full"><label>תיאור במסמך</label><input id="morningDescription" maxlength="250" value="${esc(d.description||defaultDescription(d,standalone))}"></div>
        <div class="field full"><label>הערות במסמך <small>(רשות)</small></label><textarea id="morningRemarks" maxlength="500" rows="2" placeholder="הערה שתופיע במסמך ב-Morning"></textarea></div>
      </div>
      <div class="morning-allocation-note"><b>חשבוניות ישראל</b><span>Morning מטפלת במספר הקצאה אוטומטית כאשר החיבור לרשות המסים פעיל והמסמך עומד בתנאים. לא בכל חשבונית נדרש מספר; ללקוח עסקי חשוב להזין מספר עוסק / ח.פ.</span></div>
    </div>
    ${paymentFields(dateEditorMarkup)}
    <div id="morningLinkedDocumentPanel" class="morning-form-card" hidden><div class="morning-section-title"><span>קישור לחשבונית מס קיימת</span><small>בקבלה ניתן לקשר לחשבונית שהופקה קודם</small></div><div class="field"><label>חשבונית לקישור <small>(רשות)</small></label><select id="morningLinkedDocument"><option value="">ללא קישור</option></select><button class="btn small" data-action="morning-invoice-picker">חפש חשבונית ב-Morning</button><div id="morningInvoicePicker" hidden></div></div></div>
    <div id="morningPreviewBox" class="morning-preview-box" hidden><div class="morning-preview-head"><b>תצוגה מקדימה</b><span id="morningPreviewNote">הקובץ עדיין לא הופק רשמית</span></div><iframe id="morningPreviewFrame" title="תצוגה מקדימה של מסמך Morning"></iframe></div>
    <div id="morningOperationResult" aria-live="polite"></div><button class="btn small" data-action="morning-reconcile">בדוק מצב הפקה</button>
  </div>`;
}

function foot(){return `<button class="btn primary" data-action="morning-create" disabled>הפק מסמך רשמי</button><button class="btn" data-action="morning-preview">תצוגה מקדימה</button><button class="btn" data-action="close-modal">סגור</button>`}

function openMorningDocument(debtId){
  const d=(model.state.customerDebts||[]).find(item=>item.id===debtId);if(!d)return toast('חוב הלקוח לא נמצא');
  const {customerName,amount,orderNumber,phone,email,taxId}=d;
  return openMorningDocumentModal({prefill:{customerName,amount,orderNumber,phone,email,taxId}});
}
function openStandaloneMorningDocument(){return openMorningDocumentModal({prefill:null})}
async function openMorningDocumentModal({prefill=null}={}){
  // Retain an uncertain operation in memory across closing/reopening the dialog.
  if(!blocked&&!createBusy){activeOperationId=newOperationId();completed=false}
  modalGeneration++;
  if(previewObjectUrl){URL.revokeObjectURL(previewObjectUrl);previewObjectUrl=''}
  modal('הפקת מסמך Morning',formBody(prefill||{},305,dateEditorMarkup,{standalone:!prefill}),foot());
  syncDocumentType();syncPaymentType();await refreshStatus();
}
function isActive(generation){return generation===modalGeneration&&!!document.querySelector(`[data-morning-generation="${generation}"]`)}

function selectedType(){return Number(document.querySelector('input[name="morningDocumentType"]:checked')?.value||0)}
function syncDocumentType(){const type=selectedType(),needsPayment=type===320||type===400;const payment=currentField('morningPaymentFields'),linked=currentField('morningLinkedDocumentPanel');if(payment)payment.hidden=!needsPayment;if(linked)linked.hidden=type!==400;document.querySelectorAll('[data-document-kind]').forEach(el=>{el.hidden=Number(el.dataset.documentKind)!==type})}
function syncPaymentType(){const type=Number(currentField('morningPaymentType')?.value||4);document.querySelectorAll('[data-payment-kind]').forEach(el=>{el.hidden=Number(el.dataset.paymentKind)!==type})}

function validateTaxId(value){const digits=String(value||'').replace(/\D/g,'');if(!digits)return'';if(digits.length>9)throw new Error('מספר עוסק / ח.פ. יכול להכיל עד 9 ספרות');const padded=digits.padStart(9,'0');let sum=0;for(let i=0;i<9;i++){let product=Number(padded[i])*((i%2)+1);if(product>9)product-=9;sum+=product}if(sum%10!==0)throw new Error('מספר העוסק / ח.פ. אינו תקין');return padded}
function paymentPayload(amount){
  const type=Number(currentField('morningPaymentType')?.value||0),date=String(currentField('morningPaymentDate')?.value||'');
  if(!Object.prototype.hasOwnProperty.call(PAYMENT_TYPES,type))throw new Error('יש לבחור אמצעי תשלום תקין');if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('יש לבחור תאריך תשלום');
  const payment={type,date,price:amount,currency:'ILS'};
  if(type===4){const ref=cleanText(currentField('morningTransferRef')?.value,80);if(ref)payment.transactionId=ref}
  if(type===3){const cardType=Number(currentField('morningCardType')?.value||0),cardNum=String(currentField('morningCardLast4')?.value||'').replace(/\D/g,'');if(!CARD_TYPES[cardType])throw new Error('יש לבחור סוג כרטיס');if(!/^\d{4}$/.test(cardNum))throw new Error('יש להזין 4 ספרות אחרונות של הכרטיס');Object.assign(payment,{dealType:1,cardType,cardNum})}
  if(type===2){const bankName=cleanText(currentField('morningCheckBank')?.value,80),bankBranch=cleanText(currentField('morningCheckBranch')?.value,30),bankAccount=cleanText(currentField('morningCheckAccount')?.value,40),chequeNum=cleanText(currentField('morningCheckNumber')?.value,40);if(!bankName||!bankBranch||!bankAccount||!chequeNum)throw new Error('בצ׳ק יש למלא בנק, סניף, חשבון ומספר צ׳ק');Object.assign(payment,{bankName,bankBranch,bankAccount,chequeNum})}
  return payment;
}

function readForm(){
  if(!activeOperationId)throw new Error('יש לפתוח את חלון ההפקה');
  const type=selectedType();if(!DOCUMENT_TYPES[type])throw new Error('יש לבחור סוג מסמך');
  const clientName=cleanText(currentField('morningClientName')?.value,160),email=cleanText(currentField('morningClientEmail')?.value,180),phone=cleanText(currentField('morningClientPhone')?.value,50),taxId=validateTaxId(currentField('morningClientTaxId')?.value),rawAmount=String(currentField('morningAmount')?.value||''),amount=Number(rawAmount),date=String(currentField('morningDocumentDate')?.value||''),dueDate=type===305?String(currentField('morningDueDate')?.value||''):'',description=cleanText(currentField('morningDescription')?.value,250),remarks=cleanText(currentField('morningRemarks')?.value,500),orderNumber=cleanText(currentField('morningOrderNumber')?.value,80);
  if(!clientName)throw new Error('יש להזין שם לקוח');if(!Number.isFinite(amount)||amount<=0)throw new Error('יש להזין סכום חיובי תקין');if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('יש לבחור תאריך מסמך');if(dueDate&&!/^\d{4}-\d{2}-\d{2}$/.test(dueDate))throw new Error('תאריך לתשלום אינו תקין');if(dueDate&&dueDate<date)throw new Error('תאריך לתשלום לא יכול להיות לפני תאריך המסמך');if(!description)throw new Error('יש להזין תיאור למסמך');if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('כתובת האימייל אינה תקינה');
  const payload={operation_id:activeOperationId,document:{type,amount,date,dueDate,description,remarks,orderNumber,client:{name:clientName,email,taxId,phone}}};
  if(type===320||type===400)payload.document.payment=paymentPayload(amount);
  if(type===400){const linked=String(currentField('morningLinkedDocument')?.value||'').trim();if(linked)payload.document.linkedDocumentId=linked}
  return payload;
}

function connectionStatus(kind,text){const el=currentField('morningConnectionStatus');if(!el)return;el.className=`morning-connection ${kind}`;el.innerHTML=`<span class="morning-dot"></span><span>${esc(text)}</span>`}
function renderOperation(op){
  const result=currentField('morningOperationResult');if(!result)return;
  if(op?.state==='reserved'){result.innerHTML='<div class="morning-form-card"><b>פעולת ההפקה נרשמה בשרת אך טרם נשלחה ל-Morning</b><span>אפשר לנסות שוב בבטחה; אותו מזהה פעולה יישמר.</span></div>';return}
  if(op?.state==='created_unverified'){result.innerHTML=`<div class="morning-form-card"><b>Morning החזירה מזהה למסמך ${esc(op.document_number||'')}, אך האימות החוזר עדיין לא הושלם</b><span>לא מפיקים שוב. יש ללחוץ „בדוק מצב הפקה”.</span></div>`;return}
  if(op?.state!=='created'||!op?.verified_at)return;
  result.innerHTML=`<div class="morning-form-card"><b>המסמך הופק ואומת ב-Morning ${esc(op.document_number||'')}</b><span class="morning-allocation">מספר הקצאה: ${esc(op.allocation_number||'—')}</span><button class="btn small" data-action="morning-open-document" data-click-arg0="${esc(op.document_id)}">צפה</button></div>`;
}
async function refreshStatus({reconcile=false}={}){
  const generation=modalGeneration,operationId=activeOperationId;
  connectionStatus('loading','בודק חיבור ל-Morning…');
  try{
    const data=await backend('status',{operation_id:operationId,reconcile});
    if(!isActive(generation)||operationId!==activeOperationId||createBusy)return data;
    // A status read can race a still-running Edge request before its reservation.
    // Missing metadata is not proof that an uncertain issuance did not happen.
    blocked=!!data.unresolved;renderOperation(data.operation);
    const verifiedCreated=data.operation?.state==='created'&&!!data.operation?.verified_at;if(verifiedCreated)completed=true;
    if(data.operation?.state==='failed'){completed=false;activeOperationId=newOperationId()}
    const envLabel=data.environment==='sandbox'?'Sandbox':'Production';
    if(!data.configured)connectionStatus('error','Morning אינו מוגדר בשרת');
    else if(data.available===false)connectionStatus('error',blocked?'Morning אינו זמין כרגע והפקה קודמת עדיין חסומה עד לאימות.':'Morning אינו זמין כרגע. הפקת מסמכים חסומה ליתר ביטחון.');
    else if(data.retryable_reserved)connectionStatus('warning','הפעולה נרשמה אך טרם נשלחה ל-Morning. ניתן ללחוץ שוב על „הפק מסמך רשמי”.');
    else connectionStatus(blocked||data.environment==='sandbox'?'warning':'ready',blocked?'ניסיון ההפקה עדיין בבדיקה. לחץ „בדוק מצב הפקה”.':`מחובר ל-Morning ${envLabel}`);
    const button=document.querySelector('[data-action="morning-create"]');if(button){button.disabled=!data.configured||data.available===false||blocked||completed||createBusy;if(completed){button.dataset.idleLabel='הופק ואומת';button.textContent='הופק ואומת'}}
    return data;
  }catch(error){if(isActive(generation)){connectionStatus('error',error.message||'לא ניתן לאמת את החיבור');const button=document.querySelector('[data-action="morning-create"]');if(button)button.disabled=true}return null}
}

async function previewMorningDocument(button){
  let payload;try{payload=readForm()}catch(error){return toast(error.message)}setBusy(button,true,'מכין…');
  try{const data=await backend('preview',payload),base64=String(data.pdfBase64||'');if(!base64)throw new Error('Morning לא החזירה קובץ תצוגה מקדימה');const binary=atob(base64),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);if(previewObjectUrl)URL.revokeObjectURL(previewObjectUrl);previewObjectUrl=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));const box=currentField('morningPreviewBox'),frame=currentField('morningPreviewFrame'),note=currentField('morningPreviewNote');if(note)note.textContent='הקובץ עדיין לא הופק רשמית';if(frame)frame.src=previewObjectUrl;if(box){box.hidden=false;box.scrollIntoView({block:'nearest',behavior:'smooth'})}}
  catch(error){toast(error.message||'יצירת התצוגה המקדימה נכשלה')}finally{setBusy(button,false)}
}

async function createMorningDocument(button){
  if(createBusy||blocked||completed)return;
  let payload;try{payload=readForm()}catch(error){return toast(error.message)}
  const generation=modalGeneration,type=payload.document.type,amount=payload.document.amount,clientName=payload.document.client.name;
  createBusy=true;setBusy(button,true,'מפיק…');
  try{
    const confirmed=await confirmDialog('הפקת מסמך רשמי',`להפיק ${documentLabel(type)} על סך ${money(amount)} עבור ${clientName}?\nלאחר ההפקה המסמך יקבל מספר רשמי ב-Morning.`,{confirmText:'הפק מסמך',cancelText:'חזור לעריכה',tone:'primary'});
    if(!confirmed||!isActive(generation))return;
    // Conservatively retain the operation even when the browser loses the Edge response.
    blocked=true;
    const data=await backend('create',payload);if(data.verified!==true||!data.document?.id)throw new Error('השרת לא החזיר אימות קנוני למסמך. לא יישלח ניסיון נוסף לפני בדיקת מצב ההפקה.');
    documentsBrowser.invalidateCache();
    let pdfLoaded=false;if(isActive(generation))pdfLoaded=await documentsBrowser.viewDocument(data.document.id,null,{quiet:true});
    if(isActive(generation)){
      renderOperation({state:'created',verified_at:new Date().toISOString(),document_id:data.document.id,document_number:data.document.number,allocation_number:data.document.allocationNumber});
      const message=data.local_link_pending?'המסמך הופק ואומת ב-Morning. שמירת רישום הפעולה עדיין בבדיקה.':pdfLoaded?'המסמך הופק, אומת וה-PDF הרשמי נטען מ-Morning.':'המסמך הופק ואומת ב-Morning. ה-PDF הרשמי לא נטען כרגע; אפשר ללחוץ „צפה”.';
      connectionStatus(data.local_link_pending||!pdfLoaded?'warning':'ready',message);
      if(button){button.dataset.idleLabel='הופק ואומת';button.textContent='הופק ואומת'}
    }
    blocked=!!data.local_link_pending;completed=true;
    toast(`${documentLabel(type)} ${data.document.number||''} הופק ואומת ב-Morning`);
  }catch(error){
    if(error?.details?.operation_id)activeOperationId=error.details.operation_id;
    if(error?.details?.prevent_retry){
      blocked=false;completed=true;const existing=error.details.document;if(existing?.id)renderOperation({state:'created',verified_at:new Date().toISOString(),document_id:existing.id,document_number:existing.number,allocation_number:existing.allocationNumber});
      if(isActive(generation))connectionStatus('warning',error.message||'ניסיון זהה קודם כבר אומת; החלון ננעל למניעת כפילות.');
      if(button){button.dataset.idleLabel='ננעל למניעת כפילות';button.textContent='ננעל למניעת כפילות'}
    }else{
      // Only explicit server rejection is safely retryable; transport loss remains uncertain.
      if(error?.status&&error.status<500&&!error?.details?.uncertain){blocked=false;activeOperationId=newOperationId()}
      if(isActive(generation))connectionStatus(blocked?'warning':'error',blocked?'ההפקה ממתינה לאימות. לא נשלח ניסיון נוסף.':error.message);
    }
    toast(error.message||'יש לבדוק את מצב ההפקה');
  }finally{createBusy=false;setBusy(button,false);if(button)button.disabled=blocked||completed}
}

function openExistingDocument(documentId,button){return documentsBrowser.viewDocument(documentId,button)}
async function reconcile(button){if(createBusy)return;setBusy(button,true,'בודק…');try{await refreshStatus({reconcile:true})}finally{setBusy(button,false)}}

return {documentButton,openMorningDocumentModal,openMorningDocument,openStandaloneMorningDocument,syncDocumentType,syncPaymentType,previewMorningDocument,createMorningDocument,openExistingDocument,reconcile,refreshStatus};
}
