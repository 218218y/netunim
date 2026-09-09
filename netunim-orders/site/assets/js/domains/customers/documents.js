import {esc} from '../../core/values.js';
import {money} from '../../core/money.js';
import {$} from '../../state/constants.js';
import {morningDebtImpact} from './morning-debt.js';
import {customerDebtProgressData} from '../../shared/customer-debt-progress.js';
import {createMorningDebtRecoveryContext,loadMorningDebtRecoveryContext,saveMorningDebtRecoveryContext,clearMorningDebtRecoveryContext,morningDebtRecoveryMatchesVerified,morningVerifiedApplicationDurable,morningFinancialSnapshot,morningFinancialChanges} from './morning-debt-recovery.js';

const BACKEND_PATH='/functions/v1/morning-documents';
const DOCUMENT_TYPES=Object.freeze({305:'חשבונית מס',320:'חשבונית מס / קבלה',400:'קבלה'});
const DOCUMENT_TYPE_ORDER=Object.freeze([320,305,400]);
const DEFAULT_DOCUMENT_TYPE=320;
const PAYMENT_TYPES=Object.freeze({1:'מזומן',2:'צ׳ק',3:'כרטיס אשראי',4:'העברה בנקאית'});
const CARD_TYPES=Object.freeze({1:'ישראכרט',2:'Visa',3:'Mastercard',4:'American Express',5:'Diners'});
let previewObjectUrl='';

function todayLocal(){const d=new Date(),shift=d.getTimezoneOffset()*60_000;return new Date(d.getTime()-shift).toISOString().slice(0,10)}
function documentLabel(type){return DOCUMENT_TYPES[Number(type)]||`מסמך ${Number(type)||''}`}
function cleanText(value,max=250){return String(value??'').trim().slice(0,max)}
function currentField(id){return $('#'+id)}
function setBusy(button,busy,label=''){if(!button)return;button.disabled=!!busy;if(busy&&label){if(!button.dataset.idleLabel)button.dataset.idleLabel=button.textContent||'';button.textContent=label}else if(!busy&&button.dataset.idleLabel)button.textContent=button.dataset.idleLabel}

export function createDomainsCustomersDocuments({model,modal,toast,confirmDialog,markModalDraftSaved,supaFetch,dateEditorMarkup,documentsBrowser,applyVerifiedDebtDocument,rejectSecondaryIssuance,rejectSecondaryMutation,refreshForMorningRecovery}){
let activeOperationId='',activeDebtId='',issuanceContext=null,modalGeneration=0,createBusy=false,blocked=false,completed=false,recoveryBusy=false,recoveryTimer=null;
let applicationPromise=null,decisionView=null;
let issuanceInterruptionEpoch=0;
globalThis.addEventListener?.('offline',()=>{issuanceInterruptionEpoch++});
globalThis.document?.addEventListener?.('visibilitychange',()=>{if(document.hidden)issuanceInterruptionEpoch++});
let pendingRecovery=loadMorningDebtRecoveryContext();
if(pendingRecovery){activeOperationId=pendingRecovery.operationId;activeDebtId=pendingRecovery.debtId;issuanceContext=pendingRecovery;blocked=true}
function isDebtRecoveryPending(debtId){
  const stored=loadMorningDebtRecoveryContext();
  return !!debtId&&[stored,pendingRecovery].some(context=>context?.debtId===debtId);
}
function rejectDebtRecoveryMutation(debtId){
  if(!isDebtRecoveryPending(debtId))return false;
  toast('קיימת הפקת Morning שממתינה לאימות עבור חוב זה. יש להשלים בדיקת מצב הפקה לפני שינוי התשלום/חשבונית.');return true;
}
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

function debtUpdatePanel(standalone){
  if(standalone)return'';
  const debt=currentDebt(),progress=customerDebtProgressData(debt||{}),existing=[];
  if(progress.paymentApplied>0)existing.push(`בחוב כבר רשום תשלום בסך ${money(progress.paymentApplied)}`);
  if(progress.invoiceApplied>0)existing.push(`בחוב כבר רשום סכום חשבוניות בסך ${money(progress.invoiceApplied)}`);
  return `<div id="morningDebtUpdatePanel" class="morning-form-card morning-debt-update-panel">
    <div class="morning-section-title"><span>עדכון החוב המקומי לאחר אימות</span><small>הבחירה כאן אינה נשלחת ל-Morning</small></div>
    <div class="morning-debt-update-options">
      <label id="morningApplyPaymentOption" class="morning-debt-update-option"><input id="morningApplyPayment" type="checkbox" checked><span><b>זקוף כתשלום לחוב</b><small>הסכום המאומת יקוזז מיתרת התשלום בלבד</small></span></label>
      <label id="morningApplyInvoiceOption" class="morning-debt-update-option"><input id="morningApplyInvoice" type="checkbox" checked><span><b>זקוף כחשבונית לחוב</b><small>הסכום המאומת יקוזז מיתרת החשבונית בלבד</small></span></label>
    </div>
    <div class="morning-debt-update-warning"><b>מניעת רישום כפול:</b> אם התשלום או החשבונית כבר נרשמו ידנית בחוב, או שסכום החוב כבר הוקטן ידנית בעקבותיהם, בטל את הסימון המתאים. ברירת המחדל היא לעדכן את החוב.${existing.length?`<br><strong>${esc(existing.join(' · '))}</strong>`:''}</div>
  </div>`;
}

function formBody(d,type,dateEditorMarkup,{standalone=false}={}){
  const amountValue=Number(d?.amount),amountInput=Number.isFinite(amountValue)&&amountValue>0?amountValue.toFixed(2):'';
  const heroAmount=standalone?'<div class="morning-amount standalone"><small>מסמך כללי</small></div>':`<div class="morning-amount"><small>סכום החוב</small><b>${money(d.amount)}</b></div>`;
  const formHint=standalone?'הזן את פרטי הלקוח והמסמך. המסמך אינו יוצר חוב ואינו תלוי ברשומת חוב.':'הפרטים נלקחים מהחוב וניתנים לעריכה לפני ההפקה';
  return `<div class="morning-document-dialog" data-morning-generation="${modalGeneration}">
    <div class="morning-document-hero"><div><span class="morning-brand">Morning</span><h4>${standalone?'הפקת מסמך כללי':'הפקת מסמך ללקוח'}</h4><p>המסמך הרשמי יופק ויישמר ב-Morning. באתר נשמרת רק הפניה קטנה למסמך.</p></div>${heroAmount}</div>
    <div id="morningConnectionStatus" class="morning-connection loading"><span class="morning-dot"></span><span>בודק חיבור ל-Morning…</span></div>
    <div id="morningRecoveryDecision" hidden></div>
    <div class="morning-type-picker" role="group" aria-label="סוג מסמך">
      ${DOCUMENT_TYPE_ORDER.map(value=>{const label=DOCUMENT_TYPES[value];return `<label class="morning-type-option"><input type="radio" name="morningDocumentType" value="${esc(value)}" data-change="morning-document-type" ${Number(value)===Number(type)?'checked':''}><span><b>${esc(label)}</b><small>${Number(value)===305?'חיוב ללא תקבול':Number(value)===320?'חשבונית ותקבול במסמך אחד':'תקבול כנגד חשבונית/חיוב'}</small></span></label>`}).join('')}
    </div>
    ${debtUpdatePanel(standalone)}
    <div class="morning-form-card">
      <div class="morning-section-title"><span>פרטי המסמך</span><small>${formHint}</small></div>
      <div class="form-grid">
        <div class="field"><label>שם לקוח</label><input id="morningClientName" maxlength="160" value="${esc(d.customerName||'')}"></div>
        <div class="field"><label>סכום כולל מע״מ</label><input id="morningAmount" class="number-input" type="number" min="0" step="1" value="${esc(amountInput)}" placeholder="0.00"></div>
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
  return openMorningDocumentModal({prefill:{customerName,amount,orderNumber,phone,email,taxId},debtId:d.id});
}
function openStandaloneMorningDocument(){return openMorningDocumentModal({prefill:null,debtId:''})}
async function openMorningDocumentModal({prefill=null,debtId=''}={}){
  const requestedDebtId=String(debtId||'');
  if(createBusy){toast('הפקת Morning קודמת עדיין מתבצעת. יש להמתין לתוצאתה לפני פתיחת מסמך נוסף.');return}
  pendingRecovery=loadMorningDebtRecoveryContext()||pendingRecovery;
  if(pendingRecovery&&!completed){activeOperationId=pendingRecovery.operationId;activeDebtId=pendingRecovery.debtId;issuanceContext=pendingRecovery;blocked=true}
  // A blocked operation always keeps its original debt scope, even if local recovery persistence itself failed.
  if(blocked&&requestedDebtId!==activeDebtId){toast('יש ניסיון הפקה קודם שעדיין ממתין לאימות. יש להשלים את בדיקת ההפקה שלו לפני פתיחת מסמך עבור חוב אחר.');return}
  if(!blocked){activeOperationId=newOperationId();activeDebtId=requestedDebtId;issuanceContext=null;completed=false}else if(issuanceContext?.operationId===activeOperationId)activeDebtId=issuanceContext.debtId;
  modalGeneration++;
  if(previewObjectUrl){URL.revokeObjectURL(previewObjectUrl);previewObjectUrl=''}
  modal('הפקת מסמך Morning',formBody(prefill||{},DEFAULT_DOCUMENT_TYPE,dateEditorMarkup,{standalone:!prefill}),foot());
  syncDocumentType();syncPaymentType();await refreshStatus();
}
function isActive(generation){return generation===modalGeneration&&!!document.querySelector(`[data-morning-generation="${generation}"]`)}

function selectedType(){return Number(document.querySelector('input[name="morningDocumentType"]:checked')?.value||0)}
function debtUpdatePolicy(type=selectedType()){
  if(!activeDebtId)return {applyPayment:false,applyInvoice:false};
  const paymentSupported=type===320||type===400,invoiceSupported=type===305||type===320;
  return {applyPayment:paymentSupported&&currentField('morningApplyPayment')?.checked!==false,applyInvoice:invoiceSupported&&currentField('morningApplyInvoice')?.checked!==false};
}
function syncDocumentType(){const type=selectedType(),needsPayment=type===320||type===400;const payment=currentField('morningPaymentFields'),linked=currentField('morningLinkedDocumentPanel'),paymentUpdate=currentField('morningApplyPaymentOption'),invoiceUpdate=currentField('morningApplyInvoiceOption');if(payment)payment.hidden=!needsPayment;if(linked)linked.hidden=type!==400;if(paymentUpdate)paymentUpdate.hidden=!(type===320||type===400);if(invoiceUpdate)invoiceUpdate.hidden=!(type===305||type===320);document.querySelectorAll('[data-document-kind]').forEach(el=>{el.hidden=Number(el.dataset.documentKind)!==type})}
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


function currentDebt(){return activeDebtId?(model.state.customerDebts||[]).find(row=>row.id===activeDebtId)||null:null}
function impactLine(label,supported,affected,apply,remainingBefore,remainingAfter,completeBefore,unapplied){
  if(!supported)return `${label}: סוג המסמך הזה אינו משנה את הצד הזה של החוב.`;
  if(!affected)return `${label}: לא יעודכן — ביטלת את הזקיפה לחוב עבור המסמך הזה.`;
  if(completeBefore)return `${label}: כבר הושלם בחוב; המסמך לא יוסיף סכום נוסף.`;
  const appliedText=apply>0?`יירשמו ${money(apply)}`:'לא יירשם סכום';
  const remainingText=remainingAfter<=0?'והמצב ייסגר במלואו':`ויישארו ${money(remainingAfter)}`;
  return `${label}: ${appliedText} ${remainingText}.${unapplied>0?` ${money(unapplied)} מסכום המסמך לא ייזקפו לצד הזה של החוב, כי היתרה לפני ההפקה היא ${money(remainingBefore)}.`:''}`;
}
function debtImpactConfirmation(type,amount,policy=debtUpdatePolicy(type)){
  if(!activeDebtId)return'';
  const debt=currentDebt();if(!debt)return'\n\n⚠ שורת החוב שממנה נפתח המסמך כבר אינה קיימת. המסמך יופק ב-Morning אך לא יעדכן חוב מקומי.';
  const impact=morningDebtImpact(debt,type,amount,policy),lines=[];
  if(!impact.eligible)return'\n\n⚠ החוב אינו חוב חיובי פעיל, ולכן המסמך לא יעדכן אוטומטית את מצב התשלום או החשבונית.';
  if(impact.paymentAffected||impact.invoiceAffected)lines.push('⚠ הזקיפה למסמך היא שינוי נוסף בחוב המקומי. אם כבר רשמת ידנית את אותו תשלום/חשבונית או הקטנת את סכום החוב בגללם, חזור ובטל את הסימון המתאים כדי למנוע קיזוז כפול.');
  if(impact.paymentAffected&&impact.paymentBefore>0)lines.push(`⚠ בחוב כבר רשום תשלום בסך ${money(impact.paymentBefore)}. אם המסמך הנוכחי מתעד את אותו תשלום שכבר נרשם, חזור ובטל „זקוף כתשלום לחוב”.`);
  if(impact.invoiceAffected&&impact.invoiceBefore>0)lines.push(`⚠ בחוב כבר רשום סכום חשבוניות בסך ${money(impact.invoiceBefore)}. אם המסמך הנוכחי מתעד חשבונית שכבר נרשמה, חזור ובטל „זקוף כחשבונית לחוב”.`);
  if(impact.relation==='over')lines.push(`⚠ סכום המסמך ${money(impact.documentAmount)} גבוה מסכום החוב ${money(impact.targetMagnitude)}. ההפרש לא ייזקף לחוב זה.`);
  else if(impact.relation==='partial')lines.push(`המסמך חלקי ביחס לחוב: ${money(impact.documentAmount)} מתוך ${money(impact.targetMagnitude)}.`);
  lines.push(impactLine('תשלום',impact.paymentSupported,impact.paymentAffected,impact.paymentApply,impact.paymentRemainingBefore,impact.paymentRemainingAfter,impact.paymentCompleteBefore,impact.paymentUnapplied));
  lines.push(impactLine('חשבונית',impact.invoiceSupported,impact.invoiceAffected,impact.invoiceApply,impact.invoiceRemainingBefore,impact.invoiceRemainingAfter,impact.invoiceCompleteBefore,impact.invoiceUnapplied));
  if(!impact.paymentAffected&&!impact.invoiceAffected)lines.push('לפי הבחירה שלך, המסמך לא ישנה כלל את החוב המקומי.');
  else lines.push('רק הסעיפים שסומנו יעודכנו, ורק לאחר אימות ודאי של המסמך ב-Morning.');
  return `\n\nעדכון החוב לאחר אימות:\n${lines.join('\n')}`;
}
function recoveryContext(type,amount,policy=debtUpdatePolicy(type),operationId=activeOperationId){return createMorningDebtRecoveryContext({operationId,debtId:activeDebtId,type,amount,applyPayment:policy.applyPayment,applyInvoice:policy.applyInvoice,financialSnapshot:morningFinancialSnapshot(currentDebt())})}
function persistRecoveryContext(context){
  if(!saveMorningDebtRecoveryContext(context))throw new Error('לא ניתן לשמור נקודת התאוששות מקומית לפני ההפקה. המסמך לא נשלח ל-Morning כדי שלא יאבד הקשר לחוב במקרה של ניתוק או רענון.');
  pendingRecovery=context;issuanceContext=context;return context;
}
function clearRecoveryContext(operationId=''){
  const target=operationId||pendingRecovery?.operationId||issuanceContext?.operationId||'';
  const cleared=clearMorningDebtRecoveryContext(target);if(cleared&&(!pendingRecovery||!target||pendingRecovery.operationId===target)){pendingRecovery=null;decisionView=null;const panel=currentField('morningRecoveryDecision');if(panel){panel.hidden=true;panel.replaceChildren()}}return cleared;
}
function adoptRecoveryOperationId(operationId){
  const id=String(operationId||'').trim();if(!id||!issuanceContext||issuanceContext.operationId===id)return issuanceContext;
  const next=createMorningDebtRecoveryContext({...issuanceContext,operationId:id});
  if(saveMorningDebtRecoveryContext(next)){pendingRecovery=next;issuanceContext=next;activeOperationId=id;activeDebtId=next.debtId;return next}
  return issuanceContext;
}
function showRecoveryDecision(context,current){
  const changes=morningFinancialChanges(context.financialSnapshot,current),saved=context.resolution;
  const reviewed=saved&&!morningFinancialChanges(saved.financialSnapshot,current).changed;
  const displayedCurrent=morningFinancialSnapshot((model.state.customerDebts||[]).find(d=>d.id===context.debtId))||current;
  decisionView={operationId:context.operationId,financialSnapshot:current};
  if(!$('#modalBackdrop')?.classList.contains('open')){
    modalGeneration++;modal('הכרעה בעדכון חוב מ-Morning',`<div data-morning-generation="${modalGeneration}"><div id="morningConnectionStatus"></div><div id="morningRecoveryDecision"></div></div>`,'<button class="btn" data-action="close-modal">סגור — ההפקה תישאר ממתינה</button>');
  }
  const panel=currentField('morningRecoveryDecision');
  if(!panel){toast('החוב השתנה בזמן שהפקת Morning המתינה לאימות. פתח את הפקת Morning של החוב להכרעה לפני זקיפה.');return}
  const summary=value=>value?`סכום החוב: ${money(value.amount)} · שולם: ${money(value.paymentApplied)} (${value.paymentComplete?'מלא':'לא מלא'}) · חשבוניות: ${money(value.invoiceApplied)} (${value.invoiceComplete?'מלא':'לא מלא'})`:'לא נשמר צילום מצב בניסיון ההפקה הישן. נדרש אישור מפורש.';
  const option=(kind,label,supported,checked)=>supported?`<label class="morning-debt-update-option"><input id="morningRecovery${kind}" type="checkbox" data-change="morning-recovery-choice" ${checked?'checked':''}><span>${label}</span></label>`:'';
  panel.hidden=false;panel.innerHTML=`<section class="morning-form-card"><h4>נדרשת הכרעה לפני עדכון החוב</h4><p>${esc(documentLabel(context.type))} בסך <b>${money(context.amount)}</b>. ייתכן שהתשלום או החשבונית כבר נרשמו ממחשב אחר. אין זקיפה אוטומטית לפי סכומים.</p><p><b>בזמן ההפקה:</b> ${summary(context.financialSnapshot)}</p><p><b>המצב הנוכחי לאחר סנכרון:</b> ${summary(displayedCurrent)}</p><div class="morning-debt-update-options">${option('Payment','זקוף כתשלום',context.type!==305,reviewed?saved.applyPayment:context.applyPayment&&!changes.payment)}${option('Invoice','זקוף כחשבונית',context.type!==400,reviewed?saved.applyInvoice:context.applyInvoice&&!changes.invoice)}</div><p>בצד שהשתנה הסימון כבוי כברירת מחדל. סמן אותו רק אם מסמך Morning מייצג סכום נוסף שעדיין לא נרשם. הבחירות נשמרות; זקיפה תבוצע רק לאחר אישור מפורש ורענון ענן מוצלח.</p><button class="btn primary" data-action="morning-recovery-confirm">אשר את הבחירות ועדכן את החוב</button><p id="morningRecoveryChoiceStatus" role="status"></p></section>`;
  connectionStatus('warning','המסמך מאומת. החוב ממתין להכרעה מפורשת.');markModalDraftSaved?.();
}
function saveRecoveryChoice(){
  const context=loadMorningDebtRecoveryContext();if(!context||context.operationId!==decisionView?.operationId||rejectSecondaryMutation?.()===true)return false;
  const next=createMorningDebtRecoveryContext({...context,resolution:{financialSnapshot:decisionView.financialSnapshot,applyPayment:currentField('morningRecoveryPayment')?.checked===true,applyInvoice:currentField('morningRecoveryInvoice')?.checked===true,confirmedAt:''}});
  if(!saveMorningDebtRecoveryContext(next)){toast('לא ניתן לשמור את ההכרעה. החוב לא יעודכן ונקודת ההתאוששות נשארת נעולה.');return false}
  pendingRecovery=next;issuanceContext=next;markModalDraftSaved?.();return true;
}
async function confirmRecoveryChoice(button){
  if(applicationPromise||recoveryBusy||!saveRecoveryChoice())return;
  const chosen=loadMorningDebtRecoveryContext();if(!chosen?.resolution)return;
  setBusy(button,true,'מסנכרן ובודק…');
  try{
    if(await refreshForMorningRecovery?.()!==true){toast('לא ניתן להשלים רענון מהענן. ההכרעה נשמרה אך החוב לא עודכן.');return}
    if(rejectSecondaryMutation?.()===true)return;
    const current=morningFinancialSnapshot((model.state.customerDebts||[]).find(d=>d.id===chosen.debtId),chosen.operationId);
    if(!current){toast('החוב אינו קיים. נקודת ההתאוששות נשמרה.');return}
    if(morningFinancialChanges(chosen.resolution.financialSnapshot,current).changed){showRecoveryDecision(chosen,current);toast('החוב השתנה שוב בזמן הבדיקה. בדוק ואשר את המצב המעודכן.');return}
    const latest=loadMorningDebtRecoveryContext();if(latest?.operationId!==chosen.operationId||JSON.stringify(latest.resolution)!==JSON.stringify(chosen.resolution))return;
    const approved=createMorningDebtRecoveryContext({...chosen,resolution:{...chosen.resolution,confirmedAt:new Date().toISOString()}});
    if(!saveMorningDebtRecoveryContext(approved)){toast('שמירת האישור נכשלה. לא בוצעה זקיפה.');return}
    pendingRecovery=approved;issuanceContext=approved;markModalDraftSaved?.();await recoverPendingMorningOperation();
  }catch(error){toast('ההכרעה נשמרה להתאוששות; לא ניתן להשלים כרגע: '+error.message)}finally{setBusy(button,false)}
}

function applyVerifiedContext(context,args={},options={}){
  if(applicationPromise)return applicationPromise;
  applicationPromise=applyVerifiedContextOnce(context,args,options).finally(()=>{applicationPromise=null});return applicationPromise;
}
async function applyVerifiedContextOnce(context,{operationId,type,amount,verifiedAt}={}, {immediate=false}={}){
  if(!context||!operationId||context.operationId!==operationId)return {changed:false,reason:'unbound-operation'};
  if(!morningDebtRecoveryMatchesVerified(context,{operationId,type,amount})){toast('המסמך אומת ב-Morning, אך פרטי האימות אינם תואמים לנקודת ההתאוששות המקומית. החוב לא עודכן אוטומטית.');return {changed:false,reason:'verification-mismatch'}}
  if(!context.debtId)return {changed:false,reason:'standalone'};
  if(!immediate){
    connectionStatus('loading','ממתין להשלמת רענון החוב מהענן לפני זקיפה…');
    if(await refreshForMorningRecovery?.()!==true){connectionStatus('warning','רענון החוב מהענן לא הושלם. לא בוצעה זקיפה; נקודת ההתאוששות נשארת נעולה.');return {changed:false,reason:'cloud-refresh-pending'}}
  }
  if(rejectSecondaryMutation?.()===true)return {changed:false,reason:'write-blocked'};
  const stored=loadMorningDebtRecoveryContext();if(stored?.operationId!==operationId)return {changed:false,reason:'recovery-changed'};context=stored;
  const debt=(model.state.customerDebts||[]).find(d=>d.id===context.debtId),current=morningFinancialSnapshot(debt,operationId);
  if(!current){toast('המסמך אומת, אך החוב חסר. נקודת ההתאוששות נשמרה עד לשחזור החוב.');return {changed:false,reason:'missing-debt'}}
  const resolution=context.resolution,reviewed=resolution&&!morningFinancialChanges(resolution.financialSnapshot,current).changed;
  let policy=context;
  if(resolution||morningFinancialChanges(context.financialSnapshot,current).changed){
    if(!reviewed||!resolution.confirmedAt){showRecoveryDecision(context,current);return {changed:false,reason:'decision-required'}}
    policy=resolution;
  }
  const result=applyVerifiedDebtDocument?.({debtId:context.debtId,operationId,type,amount,verifiedAt,applyPayment:policy.applyPayment,applyInvoice:policy.applyInvoice})||{changed:false,reason:'no-handler'};
  if(result.reason==='missing-debt')toast('המסמך אומת ב-Morning, אך שורת החוב כבר אינה קיימת ולכן לא עודכנה. נקודת ההתאוששות נשמרה וההפקה נשארת נעולה עד לשחזור החוב ובדיקת המצב מחדש.');
  else if(result.reason==='write-blocked')toast('המסמך אומת ב-Morning, אך עדכון החוב נעצר כי אין כרגע הרשאת כתיבה מקומית. נקודת ההתאוששות נשמרה וינוסה שוב מהלשונית הראשית.');
  else if(result.persisted===false)toast('המסמך אומת והחוב עודכן בזיכרון, אך השמירה המקומית נכשלה. נקודת ההתאוששות נשמרה; אין לסגור את החלון עד שהשמירה המקומית חוזרת לפעול.');
  return result;
}
function applyVerifiedOperation(args={},options={}){return applyVerifiedContext(issuanceContext,args,options)}
function settleVerifiedRecovery(operationId,result,{serverLinkPending=false}={}){
  const durable=morningVerifiedApplicationDurable(result),recoveryCleared=durable&&!serverLinkPending?clearRecoveryContext(operationId):false;
  return {durable,recoveryCleared,blocked:!durable||serverLinkPending||!recoveryCleared};
}

function connectionStatus(kind,text){const el=currentField('morningConnectionStatus');if(!el)return;el.className=`morning-connection ${kind}`;el.innerHTML=`<span class="morning-dot"></span><span>${esc(text)}</span>`}
function renderOperation(op){
  const result=currentField('morningOperationResult');if(!result)return;
  if(op?.state==='reserved'){result.innerHTML='<div class="morning-form-card"><b>פעולת ההפקה נרשמה בשרת אך טרם נשלחה ל-Morning</b><span>לא שולחים מחדש מתוך הטופס המשוחזר. לחץ „בדוק מצב הפקה” כדי לבטל את ההזמנה המוקדמת בבטחה ואז להפיק מחדש.</span></div>';return}
  if(op?.state==='created_unverified'){result.innerHTML=`<div class="morning-form-card"><b>Morning החזירה מזהה למסמך ${esc(op.document_number||'')}, אך האימות החוזר עדיין לא הושלם</b><span>לא מפיקים שוב. יש ללחוץ „בדוק מצב הפקה”.</span></div>`;return}
  if(op?.state!=='created'||!op?.verified_at)return;
  result.innerHTML=`<div class="morning-form-card"><b>המסמך הופק ואומת ב-Morning ${esc(op.document_number||'')}</b><span class="morning-allocation">מספר הקצאה: ${esc(op.allocation_number||'—')}</span><button class="btn small" data-action="morning-open-document" data-click-arg0="${esc(op.document_id)}">צפה</button></div>`;
}
function scheduleRecoveryCheck(delay=60_000){if(recoveryTimer||!pendingRecovery)return;recoveryTimer=setTimeout(()=>{recoveryTimer=null;void recoverPendingMorningOperation({quiet:true})},delay)}
function resetOperationAfterTerminal(operationId){
  if(!clearRecoveryContext(operationId)){blocked=true;scheduleRecoveryCheck();return false}
  const debtId=issuanceContext?.debtId??activeDebtId;blocked=false;completed=false;activeOperationId=newOperationId();activeDebtId=String(debtId||'');issuanceContext=null;return true;
}
async function abandonRecoveredReservation(operationId,{quiet=false}={}){
  const data=await backend('abandon_reservation',{operation_id:operationId});
  if(data.abandoned===true){const cleared=resetOperationAfterTerminal(operationId);if(cleared&&!quiet)toast('ניסיון ההפקה הקודם נעצר לפני שנשלח ל-Morning. לא הופק מסמך ולא בוצע שינוי בחוב.');return {abandoned:cleared,operation:data.operation}}
  return {abandoned:false,operation:data.operation||null};
}
async function refreshStatus({reconcile=false}={}){
  const generation=modalGeneration,operationId=activeOperationId;
  connectionStatus('loading','בודק חיבור ל-Morning…');
  try{
    let data=await backend('status',{operation_id:operationId,reconcile});
    if(!isActive(generation)||operationId!==activeOperationId||createBusy)return data;
    if(reconcile&&data.retryable_reserved&&operationId){const abandoned=await abandonRecoveredReservation(operationId);if(abandoned.abandoned){if(isActive(generation)){connectionStatus('ready','הניסיון הקודם נעצר לפני שליחה. אפשר לערוך ולהפיק מחדש בבטחה.');const button=document.querySelector('[data-action="morning-create"]');if(button)button.disabled=false}return data}data={...data,operation:abandoned.operation}}
    // A persisted recovery context stays fail-closed even if a status read races before the Edge reservation becomes visible.
    const recoveryStillPending=pendingRecovery?.operationId===operationId;
    blocked=!!data.unresolved||!!data.retryable_reserved||recoveryStillPending;renderOperation(data.operation);
    const verifiedCreated=data.operation?.state==='created'&&!!data.operation?.verified_at,needsLocalRecovery=!completed||pendingRecovery?.operationId===operationId;let recoveryCleanupPending=false;
    if(verifiedCreated&&needsLocalRecovery){const result=await applyVerifiedOperation({operationId:data.operation.operation_id,type:data.operation.document_type,amount:Number(data.operation.amount),verifiedAt:data.operation.verified_at}),settlement=settleVerifiedRecovery(operationId,result);blocked=settlement.blocked;completed=settlement.durable;recoveryCleanupPending=settlement.durable&&!settlement.recoveryCleared;markModalDraftSaved?.()}
    if(data.operation?.state==='failed'){resetOperationAfterTerminal(operationId)}
    const envLabel=data.environment==='sandbox'?'Sandbox':'Production';
    if(!data.configured)connectionStatus('error','Morning אינו מוגדר בשרת');
    else if(data.available===false)connectionStatus('error',blocked?'Morning אינו זמין כרגע והפקה קודמת עדיין חסומה עד לאימות.':'Morning אינו זמין כרגע. הפקת מסמכים חסומה ליתר ביטחון.');
    else if(data.retryable_reserved)connectionStatus('warning','הפעולה נרשמה אך טרם נשלחה ל-Morning. לחץ „בדוק מצב הפקה” כדי לבטל את ההזמנה המוקדמת בבטחה ואז להפיק מחדש.');
    else if(recoveryStillPending&&!data.operation)connectionStatus('warning','נשמר ניסיון הפקה מקומי אך הוא עדיין לא הופיע ביומן השרת. לא נשלח ניסיון נוסף עד שהמצב יתברר.');
    else if(recoveryCleanupPending)connectionStatus('warning','המסמך אומת והעדכון המקומי נשמר, אך נקודת ההתאוששות עדיין לא נמחקה בבטחה. ההפקה נשארת נעולה והמערכת תנסה שוב.');
    else connectionStatus(blocked||data.environment==='sandbox'?'warning':'ready',blocked?'ניסיון ההפקה עדיין בבדיקה. לחץ „בדוק מצב הפקה”.':`מחובר ל-Morning ${envLabel}`);
    const button=document.querySelector('[data-action="morning-create"]');if(button){button.disabled=!data.configured||data.available===false||blocked||completed||createBusy;if(completed){button.dataset.idleLabel='הופק ואומת';button.textContent='הופק ואומת'}}
    if(blocked&&recoveryStillPending)scheduleRecoveryCheck();
    return data;
  }catch(error){if(isActive(generation)){connectionStatus('error',error.message||'לא ניתן לאמת את החיבור');const button=document.querySelector('[data-action="morning-create"]');if(button)button.disabled=true}if(pendingRecovery?.operationId===operationId)scheduleRecoveryCheck(90_000);return null}
}

async function recoverPendingMorningOperation({quiet=false}={}){
  const stored=loadMorningDebtRecoveryContext();if(stored)pendingRecovery=stored;
  const context=pendingRecovery;if(!context||recoveryBusy||createBusy)return {ok:true,state:context?'busy':'none'};
  recoveryBusy=true;
  try{
    let data=await backend('status',{operation_id:context.operationId,reconcile:true}),operation=data.operation;
    if(operation?.state==='reserved'){
      const abandoned=await abandonRecoveredReservation(context.operationId,{quiet});
      if(abandoned.abandoned)return {ok:true,state:'abandoned'};
      operation=abandoned.operation;
    }
    if(operation?.state==='created'&&operation.verified_at){
      const result=await applyVerifiedContext(context,{operationId:operation.operation_id,type:operation.document_type,amount:Number(operation.amount),verifiedAt:operation.verified_at}),settlement=settleVerifiedRecovery(context.operationId,result);
      if(settlement.durable&&settlement.recoveryCleared){blocked=false;completed=true;toast(context.debtId?'הפקת Morning הקודמת אומתה לאחר ההתאוששות והחוב עודכן לפי הבחירות שנשמרו.':'הפקת Morning הקודמת אומתה לאחר ההתאוששות.');return {ok:true,state:'created',result}}
      blocked=true;completed=settlement.durable;scheduleRecoveryCheck();if(settlement.durable&&!quiet)toast('המסמך אומת והעדכון המקומי נשמר, אך נקודת ההתאוששות עדיין לא נמחקה בבטחה. ההפקה נשארת נעולה עד לניקוי מוצלח.');return {ok:false,state:settlement.durable?'cleanup-pending':'local-pending',result};
    }
    if(operation?.state==='failed'){if(!resetOperationAfterTerminal(context.operationId))return {ok:false,state:'cleanup-pending'};toast('ניסיון Morning הקודם הסתיים ללא מסמך מאומת; החוב לא שונה.');return {ok:true,state:'failed'}}
    blocked=true;scheduleRecoveryCheck(operation?60_000:30_000);if(!quiet)toast('נמצא ניסיון Morning שעדיין ממתין לאימות. המערכת תשמור את הקשר לחוב ולא תזקוף אותו עד לאימות ודאי.');return {ok:true,state:operation?.state||'waiting'};
  }catch(error){scheduleRecoveryCheck(90_000);if(!quiet)toast('ניסיון Morning קודם עדיין ממתין להתאוששות: '+(error?.message||'לא ניתן לבדוק כרגע'));return {ok:false,state:'unavailable',error}}
  finally{recoveryBusy=false}
}

async function previewMorningDocument(button){
  let payload;try{payload=readForm()}catch(error){return toast(error.message)}setBusy(button,true,'מכין…');
  try{const data=await backend('preview',payload),base64=String(data.pdfBase64||'');if(!base64)throw new Error('Morning לא החזירה קובץ תצוגה מקדימה');const binary=atob(base64),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);if(previewObjectUrl)URL.revokeObjectURL(previewObjectUrl);previewObjectUrl=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));const box=currentField('morningPreviewBox'),frame=currentField('morningPreviewFrame'),note=currentField('morningPreviewNote');if(note)note.textContent='הקובץ עדיין לא הופק רשמית';if(frame)frame.src=previewObjectUrl;if(box){box.hidden=false;box.scrollIntoView({block:'nearest',behavior:'smooth'})}}
  catch(error){toast(error.message||'יצירת התצוגה המקדימה נכשלה')}finally{setBusy(button,false)}
}

async function createMorningDocument(button){
  if(createBusy||blocked||completed)return;
  const rejectCurrentIssuance=()=>activeDebtId?rejectSecondaryMutation?.()===true:rejectSecondaryIssuance?.()===true;
  if(rejectCurrentIssuance())return;
  let payload;try{payload=readForm()}catch(error){return toast(error.message)}
  const generation=modalGeneration,issuanceEpoch=issuanceInterruptionEpoch,type=payload.document.type,amount=payload.document.amount,clientName=payload.document.client.name,policy=debtUpdatePolicy(type);
  createBusy=true;setBusy(button,true,'מפיק…');
  try{
    const confirmed=await confirmDialog('הפקת מסמך רשמי',`להפיק ${documentLabel(type)} על סך ${money(amount)} עבור ${clientName}?\nלאחר ההפקה המסמך יקבל מספר רשמי ב-Morning.${debtImpactConfirmation(type,amount,policy)}`,{confirmText:'הפק מסמך',cancelText:'חזור לעריכה',tone:'primary'});
    if(!confirmed||!isActive(generation))return;
    if(rejectCurrentIssuance())return;
    // Establish a durable server-side pre-issuance reservation before local recovery is armed.
    const reservation=await backend('reserve',payload);if(reservation.reserved!==true||reservation.operation?.state!=='reserved')throw new Error('השרת לא אישר הזמנה מוקדמת בטוחה לפעולת ההפקה. המסמך לא נשלח ל-Morning.');
    try{persistRecoveryContext(recoveryContext(type,amount,policy))}
    catch(error){const reservedOperation=activeOperationId;try{const cleanup=await backend('abandon_reservation',{operation_id:reservedOperation});if(cleanup.abandoned===true)resetOperationAfterTerminal(reservedOperation);else blocked=true}catch(abandonError){console.error('Morning pre-issue reservation cleanup failed',abandonError);blocked=true}throw error}
    // From this point both the server reservation and the exact local debt/update policy are durable before any official POST.
    blocked=true;
    const data=await backend('create',payload);if(data.verified!==true||!data.document?.id)throw new Error('השרת לא החזיר אימות קנוני למסמך. לא יישלח ניסיון נוסף לפני בדיקת מצב ההפקה.');
    const result=await applyVerifiedOperation({operationId:activeOperationId,type:data.document.type??type,amount:data.document.amount??amount,verifiedAt:new Date().toISOString()},{immediate:issuanceEpoch===issuanceInterruptionEpoch&&navigator.onLine!==false}),settlement=settleVerifiedRecovery(activeOperationId,result,{serverLinkPending:!!data.local_link_pending}),durable=settlement.durable,recoveryCleared=settlement.recoveryCleared;
    documentsBrowser.invalidateCache();
    let pdfLoaded=false;if(isActive(generation))pdfLoaded=await documentsBrowser.viewDocument(data.document.id,null,{quiet:true});
    if(isActive(generation)){
      renderOperation({state:'created',verified_at:new Date().toISOString(),document_id:data.document.id,document_number:data.document.number,allocation_number:data.document.allocationNumber});
      const message=!durable?'המסמך הופק ואומת ב-Morning, אך עדכון החוב עדיין ממתין לשמירה מקומית בטוחה.':data.local_link_pending?'המסמך הופק ואומת ב-Morning. שמירת רישום הפעולה עדיין בבדיקה.':!recoveryCleared?'המסמך הופק ואומת, אך נקודת ההתאוששות המקומית לא נמחקה ולכן ההפקה נשארת נעולה עד בדיקה נוספת.':pdfLoaded?'המסמך הופק, אומת וה-PDF הרשמי נטען מ-Morning.':'המסמך הופק ואומת ב-Morning. ה-PDF הרשמי לא נטען כרגע; אפשר ללחוץ „צפה”.';
      connectionStatus(!durable||data.local_link_pending||!recoveryCleared||!pdfLoaded?'warning':'ready',message);
      if(button){button.dataset.idleLabel='הופק ואומת';button.textContent='הופק ואומת'}
    }
    blocked=settlement.blocked;completed=true;if(isActive(generation))markModalDraftSaved?.();
    if(blocked)scheduleRecoveryCheck();
    toast(`${documentLabel(type)} ${data.document.number||''} הופק ואומת ב-Morning`);
  }catch(error){
    if(error?.details?.operation_id)adoptRecoveryOperationId(error.details.operation_id);
    if(error?.details?.prevent_retry){
      blocked=true;completed=true;if(isActive(generation))markModalDraftSaved?.();const existing=error.details.document;if(existing?.id)renderOperation({state:'created',verified_at:new Date().toISOString(),document_id:existing.id,document_number:existing.number,allocation_number:existing.allocationNumber});
      if(isActive(generation))connectionStatus('warning','ניסיון זהה קודם כבר אומת. לא יופק מסמך נוסף; לחץ „בדוק מצב הפקה” כדי להשלים את עדכון החוב לפי נקודת ההתאוששות שנשמרה.');
      if(button){button.dataset.idleLabel='ננעל למניעת כפילות';button.textContent='ננעל למניעת כפילות'}scheduleRecoveryCheck(15_000);
    }else{
      // Only explicit server rejection is safely retryable; transport loss remains uncertain.
      if(error?.status&&error.status<500&&!error?.details?.uncertain){const failedOperation=issuanceContext?.operationId||activeOperationId;resetOperationAfterTerminal(failedOperation)}
      if(isActive(generation))connectionStatus(blocked?'warning':'error',blocked?'ההפקה ממתינה לאימות. נקודת ההתאוששות נשמרה ולא יישלח ניסיון נוסף.':error.message);
    }
    toast(error.message||'יש לבדוק את מצב ההפקה');
  }finally{createBusy=false;setBusy(button,false);if(button)button.disabled=blocked||completed}
}

function openExistingDocument(documentId,button){return documentsBrowser.viewDocument(documentId,button)}
async function reconcile(button){if(createBusy)return;setBusy(button,true,'בודק…');try{await refreshStatus({reconcile:true})}finally{setBusy(button,false)}}

return {saveRecoveryChoice,confirmRecoveryChoice,isDebtRecoveryPending,rejectDebtRecoveryMutation,documentButton,openMorningDocumentModal,openMorningDocument,openStandaloneMorningDocument,syncDocumentType,syncPaymentType,previewMorningDocument,createMorningDocument,openExistingDocument,reconcile,refreshStatus,recoverPendingMorningOperation};
}
