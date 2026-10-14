import {createMorningDebtApplication} from './morning-debt-application.js';
import {createMorningLifetime} from './morning-lifetime.js';
import {createMorningDisplayLifetime,clearMorningDisplay} from './morning-display-lifetime.js';
import {createMorningIssuance} from './morning-issuance.js';
import {createMorningOperationCommands} from './morning-operation-commands.js';
import {createMorningRecovery} from './morning-recovery.js';
import {createMorningStatus} from './morning-status.js';
import {esc} from '../../core/values.js';
import {money} from '../../core/money.js';
import {$} from '../../state/constants.js';
import {morningDebtImpact} from './morning-debt.js';
import {customerDebtProgressData} from '../../shared/customer-debt-progress.js';
import {bankMorningEligibility,bankMorningPrefill} from '../finance/bank-morning.js';
import {createMorningDebtRecoveryContext,loadMorningDebtRecoveryContext,saveMorningDebtRecoveryContext,clearMorningDebtRecoveryContext,morningDebtRecoveryMatchesVerified,morningVerifiedApplicationDurable,morningFinancialSnapshot,morningFinancialChanges} from './morning-debt-recovery.js';
import {createMorningPayments,morningPaymentTotalCents} from './morning-payments.js';
import {activeMorningBankDebts,collapseMorningBankDebtPicker,filterMorningBankDebtPicker,morningBankDebtPickerMarkup,syncMorningBankDebtPickerSelection} from './morning-bank-debt-picker.js';
import {createMorningBankTransactionLinker} from './morning-bank-transaction-link.js';

const DOCUMENT_TYPES=Object.freeze({305:'חשבונית מס',320:'חשבונית מס / קבלה',400:'קבלה'});
const DOCUMENT_TYPE_ORDER=Object.freeze([320,305,400]);
const DEFAULT_DOCUMENT_TYPE=320;

function todayLocal(){const d=new Date(),shift=d.getTimezoneOffset()*60_000;return new Date(d.getTime()-shift).toISOString().slice(0,10)}
function documentLabel(type){return DOCUMENT_TYPES[Number(type)]||`מסמך ${Number(type)||''}`}
function cleanText(value,max=250){return String(value??'').trim().slice(0,max)}
function currentField(id){return $('#'+id)}
function setBusy(button,busy,label=''){if(!button)return;button.ariaBusy=String(!!busy);button.disabled=!!busy;if(busy&&label){if(!button.dataset.idleLabel)button.dataset.idleLabel=button.textContent||'';button.textContent=label}else if(!busy&&button.dataset.idleLabel)button.textContent=button.dataset.idleLabel}

export function debtMorningPrefill(debt={}){const clearingApproval=String(debt?.clearingApproval||'').replace(/\D/g,'').slice(0,20),customerId=String(debt?.customerId||'').replace(/\D/g,'').slice(0,9),amount=Number(debt?.amount),payment=clearingApproval?{type:3,date:todayLocal(),price:Number.isFinite(amount)&&amount>0?amount:'',currency:'ILS',cardType:1,cardNum:'****'}:undefined;return {customerName:debt?.customerName||'',amount:debt?.amount,orderNumber:'',phone:debt?.phone||'',email:debt?.email||'',taxId:customerId,remarks:clearingApproval?`אשראי נסלק באתר ת.ב.י רהיטים. אישור סליקה באתר - ${clearingApproval}`:'',...(payment?{payment}:{})}}

export function createDomainsCustomersDocuments({operationScope,subscribeAccountScope=()=>()=>{},model,modal,toast,confirmDialog,markModalDraftSaved,request,dateEditorMarkup,setDateValue=()=>{},documentsBrowser,applyVerifiedDebtDocument,rejectSecondaryIssuance,rejectSecondaryMutation,refreshForMorningRecovery,getBusinessBankTransactions=()=>[],ensureBusinessBankTransactions=async()=>false,onBankDocumentVerified=()=>{}}){
if(typeof operationScope?.capture!=='function'||typeof operationScope?.captureRead!=='function')throw new TypeError('morning_operation_scope_required');
if(typeof request?.json!=='function')throw new TypeError('morning_request_required');
let disposed=false,modalAssert=null,modalElement=null;
const scopeChanged=error=>error?.code==='MORNING_OPERATION_SCOPE_CHANGED';
let activeOperationId='',activeDebtId='',activeSource={kind:'standalone'},issuanceContext=null,modalGeneration=0,createBusy=false,blocked=false,completed=false;
let decisionView=null;
let issuanceInterruptionEpoch=0;
const lifetime=createMorningLifetime({operationScope,getPendingOperationId:()=>pendingRecovery?.operationId,recover:recoverPendingMorningOperation,onInterrupt:()=>{issuanceInterruptionEpoch++}});
const captureScope=lifetime.capture,scheduleRecoveryCheck=lifetime.scheduleRecovery;
let pendingRecovery=loadMorningDebtRecoveryContext();
const display=createMorningDisplayLifetime({subscribeAccountScope,onInvalidate:()=>{
  const owned=modalElement;
  modalGeneration++;modalAssert=null;modalElement=null;
  clearMorningDisplay(owned,modal);
}});
if(pendingRecovery){activeOperationId=pendingRecovery.operationId;activeDebtId=pendingRecovery.debtId;activeSource=sourceFromRecovery(pendingRecovery);issuanceContext=pendingRecovery;blocked=true}
const {paymentFields,readPaymentRows,replaceMorningPayments,addMorningPayment,removeMorningPayment,syncPaymentType,syncPaymentBank,syncPaymentTotal}=createMorningPayments({dateEditorMarkup,toast,currentField,getSource:()=>activeSource,getSelectedType:()=>selectedType()});
const bankTransactionLinker=createMorningBankTransactionLinker({toast,currentField,getActiveSource:()=>activeSource,setActiveSource:value=>{activeSource=value},getGeneration:()=>modalGeneration,isActive,getBusinessBankTransactions,ensureBusinessBankTransactions,readPaymentRows,replaceMorningPayments,selectedType,syncDocumentType,syncPaymentType,syncPaymentTotal,setDateValue});
function isDebtRecoveryPending(debtId){
  const stored=loadMorningDebtRecoveryContext();
  return !!debtId&&[stored,pendingRecovery].some(context=>context?.debtId===debtId);
}
function rejectDebtRecoveryMutation(debtId){
  if(!isDebtRecoveryPending(debtId))return false;
  toast('קיימת הפקת Morning שממתינה לאימות עבור חוב זה. יש להשלים בדיקת מצב הפקה לפני שינוי התשלום/חשבונית.');return true;
}
function sourceFromRecovery(context){const kind=context?.sourceKind||((context?.debtId)?'debt':'standalone');return kind==='bank'?{kind:'bank',bankTransactionId:Number(context?.bankTransactionId)||0}:{kind}}
function sourceKey(source=activeSource){return source?.kind==='bank'?`bank:${Number(source.bankTransactionId)||0}`:source?.kind==='debt'?`debt:${String(activeDebtId||'')}`:'standalone'}
function hydrateRecoveredSource(recovered,requested){if(recovered?.kind!=='bank'||requested?.kind!=='bank'||Number(recovered.bankTransactionId)!==Number(requested.bankTransactionId))return recovered;return {...recovered,...requested,kind:'bank',bankTransactionId:Number(recovered.bankTransactionId)}}
function defaultDescription(d,kind='standalone'){if(kind==='standalone')return'';if(kind==='bank')return cleanText(d?.description,250)||`תקבול בנקאי מ${cleanText(d?.customerName,120)||'לקוח'}`;return `עבור ${cleanText(d?.customerName,120)||'לקוח'}`}
function newOperationId(){return globalThis.crypto.randomUUID()}

const operationCommands=createMorningOperationCommands({request});
const debtApplication=createMorningDebtApplication({
  lifetime,recovery:{read:loadMorningDebtRecoveryContext},
  debts:{
    read:id=>(model.state.customerDebts||[]).find(d=>d.id===id),
    refresh:()=>refreshForMorningRecovery?.(),
    isBlocked:()=>rejectSecondaryMutation?.()===true,
    apply:command=>applyVerifiedDebtDocument?.(command)||{changed:false,reason:'no-handler'},
  },
  policy:{matches:morningDebtRecoveryMatchesVerified,snapshot:morningFinancialSnapshot,changes:morningFinancialChanges},
  feedback:{toast,status:connectionStatus,decide:showRecoveryDecision},
});
const issuance=createMorningIssuance({commands:operationCommands,recovery:{persist:persistRecoveryContext,reset:resetOperationAfterTerminal,block:()=>{blocked=true}}});
const recoveryFlow=createMorningRecovery({
  lifetime,commands:operationCommands,
  recovery:{
    read:()=>{const stored=loadMorningDebtRecoveryContext();if(stored)pendingRecovery=stored;return pendingRecovery},
    abandon:abandonRecoveredReservation,reset:resetOperationAfterTerminal,
  },
  application:{apply:applyVerifiedContext,settle:settleVerifiedRecovery},
  publish:{
    isBusy:()=>createBusy,
    state:(nextBlocked,nextCompleted)=>{blocked=nextBlocked;if(nextCompleted!==undefined)completed=nextCompleted},
    notify:notifyBankVerified,toast,
  },
});
const statusFlow=createMorningStatus({
  lifetime,commands:operationCommands,
  session:{
    assertModal:()=>{modalAssert?.()},isActive,
    read:()=>({generation:modalGeneration,operationId:activeOperationId,busy:createBusy,blocked,completed,pendingOperationId:pendingRecovery?.operationId||null,context:issuanceContext||pendingRecovery}),
    update:state=>{blocked=state.blocked;if(state.completed!==undefined)completed=state.completed},
  },
  recovery:{abandon:abandonRecoveredReservation,reset:resetOperationAfterTerminal},
  application:{apply:applyVerifiedOperation,settle:settleVerifiedRecovery,notify:notifyBankVerified},
  presentation:{
    status:connectionStatus,operation:renderOperation,markSaved:()=>{markModalDraftSaved?.()},
    button:({disabled,completed:done=false})=>{const button=document.querySelector('[data-action="morning-create"]');if(button){button.disabled=disabled;if(done){button.dataset.idleLabel='הופק ואומת';button.textContent='הופק ואומת'}}},
  },
});

function documentButton(d){
  return `<button class="icon-btn morning-document-button" title="הפק מסמך ב-Morning" aria-label="הפק מסמך ב-Morning" data-action="open-morning-document" data-click-arg0="${esc(d.id)}"><span aria-hidden="true">▤</span></button>`;
}

function debtUpdatePanel(){
  if(!activeDebtId)return'';
  const debt=currentDebt(),progress=customerDebtProgressData(debt||{}),existing=[];
  if(progress.paymentApplied>0)existing.push(`בחוב כבר רשום תשלום בסך ${money(progress.paymentApplied)}`);
  if(progress.invoiceApplied>0)existing.push(`בחוב כבר רשום סכום חשבוניות בסך ${money(progress.invoiceApplied)}`);
  return `<div id="morningDebtUpdatePanel" class="morning-form-card morning-debt-update-panel">
    <div class="morning-section-title"><span>עדכון החוב המקומי לאחר אימות</span><small>הבחירה כאן אינה נשלחת ל-Morning</small></div>
    <div class="morning-debt-update-options">
      <label id="morningApplyPaymentOption" class="morning-debt-update-option"><input id="morningApplyPayment" type="checkbox" checked><span><b>זקוף כתשלום לחוב</b><small>הסכום המאומת יקוזז מיתרת התשלום בלבד</small></span></label>
      <label id="morningApplyInvoiceOption" class="morning-debt-update-option"><input id="morningApplyInvoice" type="checkbox" checked><span><b>זקוף כחשבונית לחוב</b><small>הסכום המאומת יקוזז מיתרת החשבונית בלבד</small></span></label>
    </div>
    <div class="morning-debt-update-warning"><b>מניעת רישום כפול:</b> אם התשלום או החשבונית כבר נרשמו ידנית בחוב, או שסכום החוב כבר הוקטן ידנית בעקבותיהם, בטל את הסימון המתאים.${existing.length?`<br><strong>${esc(existing.join(' · '))}</strong>`:''}</div>
  </div>`;
}
function activeBankDebts(){return activeMorningBankDebts(model.state.customerDebts||[])}
function bankDebtLinkPanel(){return activeSource?.kind==='bank'?morningBankDebtPickerMarkup({debts:model.state.customerDebts||[],transaction:activeSource.bankTransaction||null,activeDebtId,aggregate:activeSource.aggregate===true}):''}
function filterBankDebtPicker(query=''){return filterMorningBankDebtPicker(query)}
function syncBankDebtPickerSelection(){return syncMorningBankDebtPickerSelection({activeDebtId,debt:currentDebt()})}
function bankTransactionLinkPanel(source=activeSource){return bankTransactionLinker.panelMarkup(source)}
function filterBankTransactionPicker(query=''){return bankTransactionLinker.filter(query)}
function linkBankTransaction(transactionId){return bankTransactionLinker.link(transactionId,{blocked,busy:createBusy})}
function clearBankTransactionLink(){return bankTransactionLinker.clear({blocked,busy:createBusy})}

function formBody(d,type,dateEditorMarkup,{source=activeSource}={}){
  const kind=source?.kind||'standalone',standalone=kind==='standalone',bank=kind==='bank',amountValue=Number(d?.amount),amountInput=Number.isFinite(amountValue)&&amountValue>0?amountValue.toFixed(2):'',documentDate=cleanText(d?.date,10)||todayLocal();
  const formHint=standalone?'הזן את פרטי הלקוח והמסמך. המסמך אינו יוצר חוב ואינו תלוי ברשומת חוב.':bank?'הפרטים מולאו מתנועת הבנק. תקבולים שמקורם בבנק נשמרים כנתוני מקור; בהפקדת כמה צ׳קים אפשר להסיר צ׳ק שאינו שייך למסמך ולהוסיף תקבולים נוספים.':'הפרטים נלקחים מהחוב וניתנים לעריכה לפני ההפקה';
  const allowedTypes=bank?[320,400]:DOCUMENT_TYPE_ORDER;
  return `<div class="morning-document-dialog" data-morning-generation="${modalGeneration}">
    <div id="morningRecoveryDecision" hidden></div>
    <div class="morning-type-picker" role="group" aria-label="סוג מסמך">
      ${allowedTypes.map(value=>{const label=DOCUMENT_TYPES[value];return `<label class="morning-type-option"><input type="radio" name="morningDocumentType" value="${value}" data-change="morning-document-type" ${Number(value)===Number(type)?'checked':''}><span><b>${esc(label)}</b><small>${Number(value)===305?'חיוב ללא תקבול':Number(value)===320?'חשבונית ותקבול במסמך אחד':'תקבול כנגד חשבונית/חיוב'}</small></span></label>`}).join('')}
    </div>
    ${bankTransactionLinkPanel(source)}${bankDebtLinkPanel()}<div id="morningDebtUpdateHost">${debtUpdatePanel()}</div>
    <div class="morning-form-card">
      <div class="morning-section-title"><span>פרטי המסמך</span><small>${formHint}</small></div>
      <div class="form-grid morning-document-fields">
        <div class="field morning-client-name-field"><label>שם לקוח</label><input id="morningClientName" maxlength="160" value="${esc(d.customerName||'')}"></div>
        <div class="field morning-document-amount-field"><label>סכום כולל מע״מ</label><input id="morningAmount" class="number-input" data-input="morning-document-amount" type="number" min="0" step="1" value="${esc(amountInput)}" placeholder="0.00"></div>
        <div class="field morning-order-field"><label>מספר הזמנה <small>(רשות)</small></label><input id="morningOrderNumber" maxlength="80" value="${esc(d.orderNumber||'')}"></div>
        <div class="field morning-client-tax-field"><label>ת.ז / מספר עוסק <small>(רשות)</small></label><input id="morningClientTaxId" inputmode="numeric" maxlength="9" value="${esc(d.taxId||'')}"></div>
        <div class="field morning-document-date-field"><label>תאריך מסמך</label>${dateEditorMarkup('morningDocumentDate',documentDate,{label:'תאריך מסמך'})}</div>
        <div class="field morning-due-date-field" data-document-kind="305"><label>לתשלום עד <small>(רשות)</small></label>${dateEditorMarkup('morningDueDate','',{label:'תאריך לתשלום'})}</div>
        <div class="field morning-client-email-field"><label>אימייל <small>(רשות · שליחה אוטומטית ללקוח)</small></label><input id="morningClientEmail" type="email" maxlength="180" value="${esc(d.email||'')}"></div>
        <div class="field morning-client-phone-field"><label>טלפון <small>(רשות)</small></label><input id="morningClientPhone" inputmode="tel" maxlength="50" value="${esc(d.phone||'')}"></div>
        <div class="field full morning-description-field"><label>תיאור במסמך</label><input id="morningDescription" maxlength="250" value="${esc(d.description||defaultDescription(d,kind))}"></div>
        <div class="field full morning-remarks-field"><label>הערות במסמך <small>(רשות)</small></label><textarea id="morningRemarks" maxlength="500" rows="2" placeholder="הערה שתופיע במסמך ב-Morning">${esc(d.remarks||'')}</textarea></div>
      </div>
      <div class="morning-allocation-note"><b>חשבוניות ישראל</b><span>Morning מטפלת במספר הקצאה אוטומטית כאשר החיבור לרשות המסים פעיל והמסמך עומד בתנאים. לא בכל חשבונית נדרש מספר; ללקוח עסקי חשוב להזין מספר עוסק / ח.פ.</span></div>
    </div>
    ${paymentFields(d,source)}
    <div id="morningLinkedDocumentPanel" class="morning-form-card" hidden><div class="morning-section-title"><span>קישור לחשבונית מס קיימת</span><small>בקבלה ניתן לקשר לחשבונית שהופקה קודם</small></div><div class="field"><label>חשבונית לקישור <small>(רשות)</small></label><select id="morningLinkedDocument"><option value="">ללא קישור</option></select><button class="btn small" data-action="morning-invoice-picker">חפש חשבונית ב-Morning</button><div id="morningInvoicePicker" hidden></div></div></div>
    <div id="morningPreviewBox" class="morning-preview-box" hidden><div class="morning-preview-head"><b>תצוגה מקדימה</b><span id="morningPreviewNote">הקובץ עדיין לא הופק רשמית</span></div><iframe id="morningPreviewFrame" title="תצוגה מקדימה של מסמך Morning"></iframe></div>
    <div id="morningOperationResult" aria-live="polite"></div><button class="btn small" data-action="morning-reconcile">בדוק מצב הפקה</button>
  </div>`;
}

function foot(){return `<button class="btn primary" data-action="morning-create" disabled>הפק מסמך רשמי</button><button class="btn" data-action="morning-preview">תצוגה מקדימה</button><button class="btn" data-action="close-modal">סגור</button>`}

function openMorningDocument(debtId){
  const d=(model.state.customerDebts||[]).find(item=>item.id===debtId);if(!d)return toast('חוב הלקוח לא נמצא');
  return openMorningDocumentModal({prefill:debtMorningPrefill(d),debtId:d.id,source:{kind:'debt'}});
}
function openStandaloneMorningDocument(){return openMorningDocumentModal({prefill:null,debtId:'',source:{kind:'standalone'}})}
function openBankMorningDocument(transaction,type=DEFAULT_DOCUMENT_TYPE){
  const eligibility=bankMorningEligibility(transaction,'business');if(!eligibility.eligible){toast(eligibility.reason||'לא ניתן להפיק מסמך מתנועה זו');return}
  let prefill;try{prefill=bankMorningPrefill(transaction)}catch{return toast('לא ניתן להכין את פרטי תנועת הבנק להפקת מסמך')}
  const requestedType=[320,400].includes(Number(type))?Number(type):DEFAULT_DOCUMENT_TYPE;
  return openMorningDocumentModal({prefill,debtId:'',source:{...prefill.source,bankTransaction:transaction},initialType:requestedType});
}
async function openMorningDocumentModal({prefill=null,debtId='',source=null,initialType=DEFAULT_DOCUMENT_TYPE}={}){
  try{modalAssert=captureScope(true)}catch(error){toast(error.message);return}
  const requestedDebtId=String(debtId||''),requestedSource=source&&typeof source==='object'?source:{kind:requestedDebtId?'debt':'standalone'},requestedKey=requestedSource.kind==='bank'?`bank:${Number(requestedSource.bankTransactionId)||0}`:requestedSource.kind==='debt'?`debt:${requestedDebtId}`:'standalone';
  if(createBusy){toast('הפקת Morning קודמת עדיין מתבצעת. יש להמתין לתוצאתה לפני פתיחת מסמך נוסף.');return}
  pendingRecovery=loadMorningDebtRecoveryContext()||pendingRecovery;
  if(pendingRecovery&&!completed){activeOperationId=pendingRecovery.operationId;activeDebtId=pendingRecovery.debtId;activeSource=sourceFromRecovery(pendingRecovery);issuanceContext=pendingRecovery;blocked=true}
  if(blocked&&requestedKey!==sourceKey(activeSource)){toast('יש ניסיון הפקה קודם שעדיין ממתין לאימות. יש להשלים את בדיקת ההפקה שלו לפני פתיחת מקור מסמך אחר.');return}
  if(!blocked){activeOperationId=newOperationId();activeDebtId=requestedDebtId;activeSource=requestedSource;bankTransactionLinker.reset(requestedSource);issuanceContext=null;completed=false}else if(issuanceContext?.operationId===activeOperationId){activeDebtId=issuanceContext.debtId;activeSource=hydrateRecoveredSource(sourceFromRecovery(issuanceContext),requestedSource);bankTransactionLinker.reset(activeSource)}
  display.renew();modalGeneration++;
  const safeType=activeSource.kind==='bank'&&![320,400].includes(Number(initialType))?320:Number(initialType)||DEFAULT_DOCUMENT_TYPE;
  modal('בודק חיבור ל-Morning…',formBody(prefill||{},safeType,dateEditorMarkup,{source:activeSource}),foot());
  modalElement=document.querySelector(`[data-morning-generation="${modalGeneration}"]`);
  mountMorningConnectionStatus();
  syncDocumentType();syncPaymentType();syncPaymentTotal();syncBankDebtPickerSelection();if(currentField('morningBankTransactionRows'))void lifetime.run(()=>bankTransactionLinker.refresh());await refreshStatus();
}
function isActive(generation){try{modalAssert?.()}catch{return false}return !disposed&&generation===modalGeneration&&!!document.querySelector(`[data-morning-generation="${generation}"]`)}

function selectedType(){return Number(document.querySelector('input[name="morningDocumentType"]:checked')?.value||0)}
function debtUpdatePolicy(type=selectedType()){
  if(!activeDebtId)return {applyPayment:false,applyInvoice:false};
  const paymentSupported=type===320||type===400,invoiceSupported=type===305||type===320;
  return {applyPayment:paymentSupported&&currentField('morningApplyPayment')?.checked!==false,applyInvoice:invoiceSupported&&currentField('morningApplyInvoice')?.checked!==false};
}
function syncDocumentType(){
  const type=selectedType(),needsPayment=type===320||type===400,payment=currentField('morningPaymentFields'),linked=currentField('morningLinkedDocumentPanel'),paymentUpdate=currentField('morningApplyPaymentOption'),invoiceUpdate=currentField('morningApplyInvoiceOption'),amount=currentField('morningAmount');
  if(activeSource.kind==='bank'&&![320,400].includes(type))return;
  if(payment)payment.hidden=!needsPayment;if(linked)linked.hidden=type!==400;if(paymentUpdate)paymentUpdate.hidden=!(type===320||type===400);if(invoiceUpdate)invoiceUpdate.hidden=!(type===305||type===320);if(amount)amount.readOnly=false;
  document.querySelectorAll('[data-document-kind]').forEach(el=>{el.hidden=Number(el.dataset.documentKind)!==type});if(needsPayment)syncPaymentTotal();
}
function applyLinkedDebtIdentity(debt){const prefill=debt?debtMorningPrefill(debt):{taxId:'',remarks:''};for(const [fieldId,key] of [['morningClientTaxId','taxId'],['morningRemarks','remarks']]){const field=currentField(fieldId);if(!field)continue;const previous=String(field.dataset.debtPrefill||'');if(!field.value||field.value===previous)field.value=String(prefill[key]||'');field.dataset.debtPrefill=String(prefill[key]||'')}}
function linkBankDebt(debtId){if(activeSource.kind!=='bank'||blocked||createBusy)return;const id=String(debtId||''),debt=id?activeBankDebts().find(row=>String(row.id)===id):null,exists=!id||!!debt;if(!exists)return toast('החוב שנבחר אינו קיים או שכבר הושלם');activeDebtId=id;applyLinkedDebtIdentity(debt);const host=currentField('morningDebtUpdateHost');if(host)host.innerHTML=debtUpdatePanel();syncDocumentType();syncBankDebtPickerSelection();collapseMorningBankDebtPicker()}

function validateTaxId(value){const digits=String(value||'').replace(/\D/g,'');if(!digits)return'';if(digits.length>9)throw new Error('מספר עוסק / ח.פ. יכול להכיל עד 9 ספרות');const padded=digits.padStart(9,'0');let sum=0;for(let i=0;i<9;i++){let product=Number(padded[i])*((i%2)+1);if(product>9)product-=9;sum+=product}if(sum%10!==0)throw new Error('מספר העוסק / ח.פ. אינו תקין');return padded}
function readForm(){
  if(!activeOperationId)throw new Error('יש לפתוח את חלון ההפקה');
  const type=selectedType();if(!DOCUMENT_TYPES[type])throw new Error('יש לבחור סוג מסמך');if(activeSource.kind==='bank'&&![320,400].includes(type))throw new Error('מתנועת בנק ניתן להפיק חשבונית מס / קבלה או קבלה בלבד');
  const clientName=cleanText(currentField('morningClientName')?.value,160),email=cleanText(currentField('morningClientEmail')?.value,180),phone=cleanText(currentField('morningClientPhone')?.value,50),taxId=validateTaxId(currentField('morningClientTaxId')?.value),date=String(currentField('morningDocumentDate')?.value||''),dueDate=type===305?String(currentField('morningDueDate')?.value||''):'',description=cleanText(currentField('morningDescription')?.value,250),remarks=cleanText(currentField('morningRemarks')?.value,500),orderNumber=cleanText(currentField('morningOrderNumber')?.value,80),payments=(type===320||type===400)?readPaymentRows():[],amount=Number(currentField('morningAmount')?.value||0);
  if(!clientName)throw new Error('יש להזין שם לקוח');if(!Number.isFinite(amount)||amount<=0)throw new Error('יש להזין סכום חיובי תקין');if(payments.length){const amountCents=Math.round(amount*100),paymentCents=morningPaymentTotalCents(payments);if(paymentCents!==amountCents)throw new Error(`סכום המסמך (${money(amount)}) אינו תואם לסך התקבולים (${money(paymentCents/100)}). יש לתקן את הסכומים לפני המשך.`)}if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('יש לבחור תאריך מסמך');if(dueDate&&!/^\d{4}-\d{2}-\d{2}$/.test(dueDate))throw new Error('תאריך לתשלום אינו תקין');if(dueDate&&dueDate<date)throw new Error('תאריך לתשלום לא יכול להיות לפני תאריך המסמך');if(!description)throw new Error('יש להזין תיאור למסמך');if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('כתובת האימייל אינה תקינה');
  if(activeSource.kind==='bank'){
    const sourcePayments=payments.filter(row=>String(row.bankSourceKey||'')),bankAmount=Number(activeSource.bankAmount),mode=String(activeSource.paymentMode||'transfer');
    if(!sourcePayments.length)throw new Error('יש להשאיר לפחות תקבול אחד שמקורו בתנועת הבנק');
    if(mode==='checks'){
      if(sourcePayments.some(row=>row.type!==2||!String(row.bankSourceKey||'').startsWith('check:')))throw new Error('תקבולי הצ׳קים שמקורם בבנק חייבים להישאר מסוג צ׳ק');
      const sourceTotal=sourcePayments.reduce((sum,row)=>sum+Math.round(Number(row.price)*100),0);if(!Number.isFinite(bankAmount)||sourceTotal<=0||sourceTotal>Math.round(bankAmount*100))throw new Error('סכומי הצ׳קים שנבחרו אינם תואמים להפקדת הבנק המקורית');
    }else{
      const source=sourcePayments.find(row=>row.bankSourceKey==='transfer');if(sourcePayments.length!==1||!source||source.type!==4||!Number.isFinite(bankAmount)||Math.round(source.price*100)!==Math.round(bankAmount*100))throw new Error('תקבול ההעברה שמקורו בבנק חייב להישאר זהה לתנועת הבנק המקורית');
    }
  }
  const payload={operation_id:activeOperationId,source:{kind:activeSource.kind||'standalone',debtId:activeDebtId||'',...(activeSource.kind==='bank'?{bankTransactionId:Number(activeSource.bankTransactionId)}:{})},document:{type,amount,date,dueDate,description,remarks,orderNumber,client:{name:clientName,email,taxId,phone}}};
  if(payments.length)payload.document.payment=payments;if(type===400){const linked=String(currentField('morningLinkedDocument')?.value||'').trim();if(linked)payload.document.linkedDocumentId=linked}return payload;
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
function recoveryContext(type,amount,policy=debtUpdatePolicy(type),operationId=activeOperationId){return createMorningDebtRecoveryContext({operationId,debtId:activeDebtId,type,amount,applyPayment:policy.applyPayment,applyInvoice:policy.applyInvoice,financialSnapshot:morningFinancialSnapshot(currentDebt()),sourceKind:activeSource.kind||'standalone',bankTransactionId:activeSource.kind==='bank'?Number(activeSource.bankTransactionId):null})}
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
  if(saveMorningDebtRecoveryContext(next)){const freshSource=activeSource;pendingRecovery=next;issuanceContext=next;activeOperationId=id;activeDebtId=next.debtId;activeSource=hydrateRecoveredSource(sourceFromRecovery(next),freshSource);return next}
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
  try{modalAssert?.();captureScope()()}catch(error){toast(error.message);return false}
  const context=loadMorningDebtRecoveryContext();if(!context||context.operationId!==decisionView?.operationId||rejectSecondaryMutation?.()===true)return false;
  const next=createMorningDebtRecoveryContext({...context,resolution:{financialSnapshot:decisionView.financialSnapshot,applyPayment:currentField('morningRecoveryPayment')?.checked===true,applyInvoice:currentField('morningRecoveryInvoice')?.checked===true,confirmedAt:''}});
  if(!saveMorningDebtRecoveryContext(next)){toast('לא ניתן לשמור את ההכרעה. החוב לא יעודכן ונקודת ההתאוששות נשארת נעולה.');return false}
  pendingRecovery=next;issuanceContext=next;markModalDraftSaved?.();return true;
}
async function confirmRecoveryChoice(button){
  if(debtApplication.isPending()||lifetime.pending('recovery')||!saveRecoveryChoice())return;
  const assertCurrent=captureScope(),chosen=loadMorningDebtRecoveryContext();if(!chosen?.resolution)return;
  setBusy(button,true,'מסנכרן ובודק…');
  try{
    const refreshed=await refreshForMorningRecovery?.();assertCurrent();
    if(refreshed!==true){toast('לא ניתן להשלים רענון מהענן. ההכרעה נשמרה אך החוב לא עודכן.');return}
    if(rejectSecondaryMutation?.()===true)return;
    const current=morningFinancialSnapshot((model.state.customerDebts||[]).find(d=>d.id===chosen.debtId),chosen.operationId);
    if(!current){toast('החוב אינו קיים. נקודת ההתאוששות נשמרה.');return}
    if(morningFinancialChanges(chosen.resolution.financialSnapshot,current).changed){showRecoveryDecision(chosen,current);toast('החוב השתנה שוב בזמן הבדיקה. בדוק ואשר את המצב המעודכן.');return}
    const latest=loadMorningDebtRecoveryContext();if(latest?.operationId!==chosen.operationId||JSON.stringify(latest.resolution)!==JSON.stringify(chosen.resolution))return;
    const approved=createMorningDebtRecoveryContext({...chosen,resolution:{...chosen.resolution,confirmedAt:new Date().toISOString()}});
    if(!saveMorningDebtRecoveryContext(approved)){toast('שמירת האישור נכשלה. לא בוצעה זקיפה.');return}
    pendingRecovery=approved;issuanceContext=approved;markModalDraftSaved?.();await recoverPendingMorningOperation();
  }catch(error){if(!scopeChanged(error))toast('ההכרעה נשמרה להתאוששות; לא ניתן להשלים כרגע: '+error.message)}finally{setBusy(button,false)}
}

function applyVerifiedContext(context,args={},options={}){return debtApplication.apply(context,args,options)}

function applyVerifiedOperation(args={},options={}){return applyVerifiedContext(issuanceContext,args,options)}
function settleVerifiedRecovery(operationId,result,{serverLinkPending=false}={}){
  const durable=morningVerifiedApplicationDurable(result),recoveryCleared=durable&&!serverLinkPending?clearRecoveryContext(operationId):false;
  return {durable,recoveryCleared,blocked:!durable||serverLinkPending||!recoveryCleared};
}
function notifyBankVerified(context,bankLink){if(context?.sourceKind!=='bank'||!context.bankTransactionId||!bankLink||bankLink.pending===true)return;try{onBankDocumentVerified(Number(context.bankTransactionId),bankLink)}catch(error){console.error('Bank Morning local projection update failed',error)}}

function mountMorningConnectionStatus(){const heading=document.querySelector('#modal .modal-head h3');if(!heading||!document.querySelector('#modal .morning-document-dialog'))return;heading.id='morningConnectionStatus';heading.className='morning-connection morning-modal-connection loading';heading.innerHTML='<span class="morning-dot"></span><span>בודק חיבור ל-Morning…</span>'}
function connectionStatus(kind,text){const el=currentField('morningConnectionStatus');if(!el)return;const inHeader=el.matches('#modal .modal-head h3');el.className=`morning-connection ${inHeader?'morning-modal-connection ':''}${kind}`;el.innerHTML=`<span class="morning-dot"></span><span>${esc(text)}</span>`}
function renderOperation(op){
  const result=currentField('morningOperationResult');if(!result)return;
  if(op?.state==='reserved'){result.innerHTML='<div class="morning-form-card"><b>פעולת ההפקה נרשמה בשרת אך טרם נשלחה ל-Morning</b><span>לא שולחים מחדש מתוך הטופס המשוחזר. לחץ „בדוק מצב הפקה” כדי לבטל את ההזמנה המוקדמת בבטחה ואז להפיק מחדש.</span></div>';return}
  if(op?.state==='created_unverified'){result.innerHTML=`<div class="morning-form-card"><b>Morning החזירה מזהה למסמך ${esc(op.document_number||'')}, אך האימות החוזר עדיין לא הושלם</b><span>לא מפיקים שוב. יש ללחוץ „בדוק מצב הפקה”.</span></div>`;return}
  if(op?.state!=='created'||!op?.verified_at)return;
  result.innerHTML=`<div class="morning-form-card"><b>המסמך הופק ואומת ב-Morning ${esc(op.document_number||'')}</b><span class="morning-allocation">מספר הקצאה: ${esc(op.allocation_number||'—')}</span><button class="btn small" data-action="morning-open-document" data-click-arg0="${esc(op.document_id)}">צפה</button></div>`;
}
function resetOperationAfterTerminal(operationId){
  if(!clearRecoveryContext(operationId)){blocked=true;scheduleRecoveryCheck();return false}
  const debtId=issuanceContext?.debtId??activeDebtId,recovered=issuanceContext?sourceFromRecovery(issuanceContext):activeSource,source=hydrateRecoveredSource(recovered,activeSource);blocked=false;completed=false;activeOperationId=newOperationId();activeDebtId=String(debtId||'');activeSource=source;issuanceContext=null;return true;
}
async function abandonRecoveredReservation(operationId,{quiet=false,assertCurrent=captureScope()}={}){
  const data=await operationCommands.abandonReservation(operationId,assertCurrent);assertCurrent();
  if(data.abandoned===true){const cleared=resetOperationAfterTerminal(operationId);if(cleared&&!quiet)toast('ניסיון ההפקה הקודם נעצר לפני שנשלח ל-Morning. לא הופק מסמך ולא בוצע שינוי בחוב.');return {abandoned:cleared,operation:data.operation}}
  return {abandoned:false,operation:data.operation||null};
}
function refreshStatus(...args){return statusFlow.refresh(...args)}

function recoverPendingMorningOperation(...args){return recoveryFlow.recover(...args)}

async function previewMorningDocument(button){
  let payload,assertCurrent;try{modalAssert?.();assertCurrent=captureScope(true);payload=readForm()}catch(error){return toast(error.message)}
  const generation=modalGeneration;setBusy(button,true,'מכין…');
  try{return await documentsBrowser.previewDraft(payload,{assertCurrent,isCurrent:()=>isActive(generation)})}
  finally{setBusy(button,false)}
}

async function createMorningDocument(button){
  if(createBusy||blocked||completed)return;
  const rejectCurrentIssuance=()=>activeDebtId?rejectSecondaryMutation?.()===true:rejectSecondaryIssuance?.()===true;
  if(rejectCurrentIssuance())return;
  let payload,assertCurrent;try{modalAssert?.();assertCurrent=captureScope();payload=readForm()}catch(error){return toast(error.message)}
  const generation=modalGeneration,issuanceEpoch=issuanceInterruptionEpoch,type=payload.document.type,amount=payload.document.amount,clientName=payload.document.client.name,policy=debtUpdatePolicy(type);
  let context;try{context=recoveryContext(type,amount,policy,payload.operation_id)}catch(error){return toast(error.message)}
  statusFlow.cancelPending();createBusy=true;setBusy(button,true,'מפיק…');
  try{
    const confirmed=await confirmDialog('הפקת מסמך רשמי',`להפיק ${documentLabel(type)} על סך ${money(amount)} עבור ${clientName}?\nלאחר ההפקה המסמך יקבל מספר רשמי ב-Morning.${debtImpactConfirmation(type,amount,policy)}`,{confirmText:'הפק מסמך',cancelText:'חזור לעריכה',tone:'primary',signal:display.signal});
    if(!confirmed)return;assertCurrent();if(!isActive(generation))return;
    if(rejectCurrentIssuance())return;
    const data=await issuance.issue(payload,context,assertCurrent);assertCurrent();
    const result=await applyVerifiedContext(context,{operationId:context.operationId,documentId:data.document.id,documentNumber:data.document.number,type:data.document.type??type,amount:data.document.amount??amount,verifiedAt:new Date().toISOString()},{immediate:issuanceEpoch===issuanceInterruptionEpoch&&navigator.onLine!==false,assertCurrent,isCurrent:()=>isActive(generation)});assertCurrent();const settlement=settleVerifiedRecovery(context.operationId,result,{serverLinkPending:!!data.local_link_pending||!!data.bank_link_pending}),durable=settlement.durable,recoveryCleared=settlement.recoveryCleared;if(recoveryCleared)notifyBankVerified(context,data.bank_link);
    documentsBrowser.invalidateCache();
    let pdfLoaded=false;if(isActive(generation))pdfLoaded=await documentsBrowser.viewDocument(data.document.id,null,{quiet:true});assertCurrent();
    if(isActive(generation)){
      renderOperation({state:'created',verified_at:new Date().toISOString(),document_id:data.document.id,document_number:data.document.number,allocation_number:data.document.allocationNumber});
      const message=!durable?'המסמך הופק ואומת ב-Morning, אך עדכון החוב עדיין ממתין לשמירה מקומית בטוחה.':(data.local_link_pending||data.bank_link_pending)?'המסמך הופק ואומת ב-Morning. שמירת הקישור המקומי עדיין בבדיקה.':!recoveryCleared?'המסמך הופק ואומת, אך נקודת ההתאוששות המקומית לא נמחקה ולכן ההפקה נשארת נעולה עד בדיקה נוספת.':pdfLoaded?'המסמך הופק, אומת וה-PDF הרשמי נטען מ-Morning.':'המסמך הופק ואומת ב-Morning. ה-PDF הרשמי לא נטען כרגע; אפשר ללחוץ „צפה”.';
      connectionStatus(!durable||data.local_link_pending||data.bank_link_pending||!recoveryCleared||!pdfLoaded?'warning':'ready',message);
      if(button){button.dataset.idleLabel='הופק ואומת';button.textContent='הופק ואומת'}
    }
    blocked=settlement.blocked;completed=true;if(isActive(generation))markModalDraftSaved?.();
    if(blocked)scheduleRecoveryCheck(60_000,assertCurrent);
    toast(`${documentLabel(type)} ${data.document.number||''} הופק ואומת ב-Morning`);
  }catch(error){
    if(scopeChanged(error)){blocked=true;return false}
    if(error?.details?.operation_id)adoptRecoveryOperationId(error.details.operation_id);
    if(error?.details?.prevent_retry){
      blocked=true;completed=true;if(isActive(generation))markModalDraftSaved?.();const existing=error.details.document;if(existing?.id)renderOperation({state:'created',verified_at:new Date().toISOString(),document_id:existing.id,document_number:existing.number,allocation_number:existing.allocationNumber});
      if(isActive(generation))connectionStatus('warning','ניסיון זהה קודם כבר אומת. לא יופק מסמך נוסף; לחץ „בדוק מצב הפקה” כדי להשלים את עדכון החוב לפי נקודת ההתאוששות שנשמרה.');
      if(button){button.dataset.idleLabel='ננעל למניעת כפילות';button.textContent='ננעל למניעת כפילות'}scheduleRecoveryCheck(15_000,assertCurrent);
    }else{
      // Only explicit server rejection is safely retryable; transport loss remains uncertain.
      if(error?.status&&error.status<500&&!error?.details?.uncertain){const failedOperation=issuanceContext?.operationId||activeOperationId;resetOperationAfterTerminal(failedOperation)}
      if(isActive(generation))connectionStatus(blocked?'warning':'error',blocked?'ההפקה ממתינה לאימות. נקודת ההתאוששות נשמרה ולא יישלח ניסיון נוסף.':error.message);
    }
    toast(error.message||'יש לבדוק את מצב ההפקה');
  }finally{createBusy=false;setBusy(button,false);if(button)button.disabled=blocked||completed}
}

function openExistingDocument(documentId,button,operationId){try{modalAssert?.();captureScope(true)()}catch(error){toast(error.message);return false}return documentId?documentsBrowser.viewDocument(documentId,button):documentsBrowser.viewVerifiedOperation(operationId,button)}
async function reconcile(button){if(createBusy)return;setBusy(button,true,'בודק…');try{await refreshStatus({reconcile:true})}finally{setBusy(button,false)}}

function dispose(){if(disposed)return false;disposed=true;lifetime.dispose();display.dispose();return true}
function command(run,args){return disposed?Promise.resolve(false):lifetime.run(()=>run(...args))}
const runtime={dispose,cancelPending:()=>{lifetime.cancelPending();statusFlow.cancelPending()},drain:lifetime.drain,isPending:lifetime.isPending};
return {
  dispose,runtime,isDebtRecoveryPending,rejectDebtRecoveryMutation,documentButton,recoverPendingMorningOperation,
  saveRecoveryChoice:(...args)=>disposed?false:saveRecoveryChoice(...args),
  confirmRecoveryChoice:(...args)=>command(confirmRecoveryChoice,args),
  openMorningDocumentModal:(...args)=>command(openMorningDocumentModal,args),
  openMorningDocument:(...args)=>command(openMorningDocument,args),
  openStandaloneMorningDocument:(...args)=>command(openStandaloneMorningDocument,args),
  openBankMorningDocument:(...args)=>command(openBankMorningDocument,args),
  linkBankDebt:(...args)=>disposed?false:linkBankDebt(...args),
  filterBankDebtPicker:(...args)=>disposed?false:filterBankDebtPicker(...args),
  linkBankTransaction:(...args)=>disposed?false:linkBankTransaction(...args),
  clearBankTransactionLink:(...args)=>disposed?false:clearBankTransactionLink(...args),
  filterBankTransactionPicker:(...args)=>disposed?false:filterBankTransactionPicker(...args),
  addMorningPayment:(...args)=>disposed?false:addMorningPayment(...args),
  removeMorningPayment:(...args)=>disposed?false:removeMorningPayment(...args),
  syncPaymentTotal:(...args)=>disposed?false:syncPaymentTotal(...args),
  syncDocumentType:(...args)=>disposed?false:syncDocumentType(...args),
  syncPaymentType:(...args)=>disposed?false:syncPaymentType(...args),
  syncPaymentBank:(...args)=>disposed?false:syncPaymentBank(...args),
  previewMorningDocument:(...args)=>command(previewMorningDocument,args),
  createMorningDocument:(...args)=>command(createMorningDocument,args),
  openExistingDocument:(...args)=>command(openExistingDocument,args),
  reconcile:(...args)=>command(reconcile,args),
  refreshStatus:(...args)=>command(refreshStatus,args),
};
}
