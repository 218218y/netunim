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
function operationCreated(op){return String(op?.state||'')==='created'&&String(op?.document_id||'')}
function allocationNumber(op){return cleanText(op?.allocation_number,40)}
function documentAmount(op){const n=Number(op?.amount);return Number.isFinite(n)?n:0}
function sameAmount(a,b){return Math.abs(Number(a||0)-Number(b||0))<0.01}
function cleanText(value,max=250){return String(value??'').trim().slice(0,max)}
function currentField(id){return $('#'+id)}
function setBusy(button,busy,label=''){if(!button)return;button.disabled=!!busy;if(label){if(!button.dataset.idleLabel)button.dataset.idleLabel=button.textContent||'';button.textContent=busy?label:button.dataset.idleLabel}}

export function createDomainsCustomersDocuments({model,modal,toast,confirmDialog,supaFetch,scheduleSave,renderCustomers,dateEditorMarkup}){
let activeDebtId='',activeOperationId='',lastOperations=[];

function debt(){return (model.state.customerDebts||[]).find(item=>item.id===activeDebtId)||null}
function defaultType(d){if(d?.paid&&!d?.invoiceIssued)return 320;if(!d?.paid)return 305;return 400}
function defaultDescription(d){const order=cleanText(d?.orderNumber,80);return order?`הזמנה ${order}`:`עבור ${cleanText(d?.customerName,120)||'לקוח'}`}
function newOperationId(){return globalThis.crypto?.randomUUID?.()||`morning-${Date.now()}-${Math.random().toString(16).slice(2)}`}

async function backend(action,payload={}){
  let response;
  try{response=await supaFetch(BACKEND_PATH,{method:'POST',networkRetry:false,dataPriority:'high',body:JSON.stringify({action,...payload})})}
  catch(error){const wrapped=new Error(error?.message||'לא ניתן להגיע לשירות Morning');wrapped.code=error?.code||'morning_backend_unreachable';throw wrapped}
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data?.ok===false){const error=new Error(String(data?.message||'שירות Morning החזיר שגיאה'));error.code=String(data?.code||'morning_backend_error');error.status=response.status;error.details=data;throw error}
  return data;
}

function documentButton(d){
  const label=d.invoiceIssued?'מסמך':'הפק מסמך';
  return `<button class="icon-btn morning-document-button ${esc(d.invoiceIssued?'has-document':'')}" title="${esc(label+' ב-Morning')}" aria-label="${esc(label+' ב-Morning')}" data-action="open-morning-document" data-click-arg0="${esc(d.id)}"><span aria-hidden="true">▤</span></button>`;
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

function formBody(d,type,dateEditorMarkup){
  return `<div class="morning-document-dialog" data-morning-debt-id="${esc(d.id)}">
    <div class="morning-document-hero"><div><span class="morning-brand">Morning</span><h4>הפקת מסמך ללקוח</h4><p>המסמך הרשמי יופק ויישמר ב-Morning. באתר נשמרת רק הפניה קטנה למסמך.</p></div><div class="morning-amount"><small>סכום החוב</small><b>${money(d.amount)}</b></div></div>
    <div id="morningConnectionStatus" class="morning-connection loading"><span class="morning-dot"></span><span>בודק חיבור ומסמכים קיימים…</span></div>
    <div class="morning-type-picker" role="group" aria-label="סוג מסמך">
      ${Object.entries(DOCUMENT_TYPES).map(([value,label])=>`<label class="morning-type-option"><input type="radio" name="morningDocumentType" value="${esc(value)}" data-change="morning-document-type" ${Number(value)===Number(type)?'checked':''}><span><b>${esc(label)}</b><small>${Number(value)===305?'חיוב ללא תקבול':Number(value)===320?'חשבונית ותקבול במסמך אחד':'תקבול כנגד חשבונית/חיוב'}</small></span></label>`).join('')}
    </div>
    <div class="morning-form-card">
      <div class="morning-section-title"><span>פרטי המסמך</span><small>הפרטים נלקחים מהחוב וניתנים לעריכה לפני ההפקה</small></div>
      <div class="form-grid">
        <div class="field"><label>שם לקוח</label><input id="morningClientName" maxlength="160" value="${esc(d.customerName||'')}"></div>
        <div class="field"><label>סכום כולל מע״מ</label><input id="morningAmount" class="number-input" type="number" min="0.01" step="0.01" value="${esc(Number(d.amount||0).toFixed(2))}"></div>
        <div class="field"><label>אימייל <small>(רשות)</small></label><input id="morningClientEmail" type="email" maxlength="180" value="${esc(d.email||'')}"></div>
        <div class="field"><label>טלפון <small>(רשות)</small></label><input id="morningClientPhone" inputmode="tel" maxlength="50" value="${esc(d.phone||'')}"></div>
        <div class="field"><label>מספר עוסק / ח.פ. <small>(רשות)</small></label><input id="morningClientTaxId" inputmode="numeric" maxlength="9" value="${esc(d.taxId||'')}"></div>
        <div class="field"><label>תאריך מסמך</label>${dateEditorMarkup('morningDocumentDate',todayLocal(),{label:'תאריך מסמך'})}</div>
        <div class="field morning-due-date-field" data-document-kind="305"><label>לתשלום עד <small>(רשות)</small></label>${dateEditorMarkup('morningDueDate','',{label:'תאריך לתשלום'})}</div>
        <div class="field"><label>מספר הזמנה <small>(לזיהוי אצלך)</small></label><input id="morningOrderNumber" maxlength="80" value="${esc(d.orderNumber||'')}"></div>
        <div class="field full"><label>תיאור במסמך</label><input id="morningDescription" maxlength="250" value="${esc(defaultDescription(d))}"></div>
        <div class="field full"><label>הערות במסמך <small>(רשות)</small></label><textarea id="morningRemarks" maxlength="500" rows="2" placeholder="הערה שתופיע במסמך ב-Morning"></textarea></div>
      </div>
      <div class="morning-allocation-note"><b>חשבוניות ישראל</b><span>Morning מטפלת במספר הקצאה אוטומטית כאשר החיבור לרשות המסים פעיל והמסמך עומד בתנאים. לא בכל חשבונית נדרש מספר; ללקוח עסקי חשוב להזין מספר עוסק / ח.פ.</span></div>
    </div>
    ${paymentFields(dateEditorMarkup)}
    <div id="morningLinkedDocumentPanel" class="morning-form-card" hidden><div class="morning-section-title"><span>קישור לחשבונית מס קיימת</span><small>בקבלה ניתן לקשר לחשבונית שהופקה קודם</small></div><div class="field"><label>חשבונית לקישור <small>(רשות)</small></label><select id="morningLinkedDocument"><option value="">ללא קישור</option></select></div></div>
    <div id="morningPreviewBox" class="morning-preview-box" hidden><div class="morning-preview-head"><b>תצוגה מקדימה</b><span>הקובץ עדיין לא הופק רשמית</span></div><iframe id="morningPreviewFrame" title="תצוגה מקדימה של מסמך Morning"></iframe></div>
    <div class="morning-history"><div class="morning-section-title"><span>מסמכי Morning לחוב הזה</span><button class="btn tiny" data-action="morning-reconcile">בדוק שוב</button></div><div id="morningDocumentHistory" class="morning-history-list"><div class="morning-empty">טוען…</div></div></div>
  </div>`;
}

function foot(){return `<button class="btn primary" data-action="morning-create">הפק מסמך רשמי</button><button class="btn" data-action="morning-preview">תצוגה מקדימה</button><button class="btn" data-action="close-modal">סגור</button>`}

async function openMorningDocument(debtId){
  const d=(model.state.customerDebts||[]).find(item=>item.id===debtId);if(!d)return toast('חוב הלקוח לא נמצא');
  activeDebtId=d.id;activeOperationId=newOperationId();lastOperations=[];
  if(previewObjectUrl){URL.revokeObjectURL(previewObjectUrl);previewObjectUrl=''}
  modal('מסמך Morning',formBody(d,defaultType(d),dateEditorMarkup),foot());
  syncDocumentType();syncPaymentType();
  await refreshStatus({reconcile:true});
}

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
  const d=debt();if(!d)throw new Error('חוב הלקוח כבר אינו קיים');
  const type=selectedType();if(!DOCUMENT_TYPES[type])throw new Error('יש לבחור סוג מסמך');
  const clientName=cleanText(currentField('morningClientName')?.value,160),email=cleanText(currentField('morningClientEmail')?.value,180),phone=cleanText(currentField('morningClientPhone')?.value,50),taxId=validateTaxId(currentField('morningClientTaxId')?.value),rawAmount=String(currentField('morningAmount')?.value||''),amount=Number(rawAmount),date=String(currentField('morningDocumentDate')?.value||''),dueDate=type===305?String(currentField('morningDueDate')?.value||''):'',description=cleanText(currentField('morningDescription')?.value,250),remarks=cleanText(currentField('morningRemarks')?.value,500),orderNumber=cleanText(currentField('morningOrderNumber')?.value,80);
  if(!clientName)throw new Error('יש להזין שם לקוח');if(!Number.isFinite(amount)||amount<=0)throw new Error('יש להזין סכום חיובי תקין');if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('יש לבחור תאריך מסמך');if(dueDate&&!/^\d{4}-\d{2}-\d{2}$/.test(dueDate))throw new Error('תאריך לתשלום אינו תקין');if(dueDate&&dueDate<date)throw new Error('תאריך לתשלום לא יכול להיות לפני תאריך המסמך');if(!description)throw new Error('יש להזין תיאור למסמך');if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('כתובת האימייל אינה תקינה');
  const payload={debt_id:d.id,operation_id:activeOperationId,document:{type,amount,date,dueDate,description,remarks,orderNumber,client:{name:clientName,email,taxId,phone}}};
  if(type===320||type===400)payload.document.payment=paymentPayload(amount);
  if(type===400){const linked=String(currentField('morningLinkedDocument')?.value||'').trim();if(linked)payload.document.linkedDocumentId=linked}
  return payload;
}

function connectionStatus(kind,text){const el=currentField('morningConnectionStatus');if(!el)return;el.className=`morning-connection ${kind}`;el.innerHTML=`<span class="morning-dot"></span><span>${esc(text)}</span>`}
function historyHtml(ops){const created=(ops||[]).filter(operationCreated);if(!created.length)return '<div class="morning-empty">עדיין לא הופק מסמך Morning מהחוב הזה.</div>';return created.map(op=>{const type=Number(op.document_type),allocation=allocationNumber(op),allocationText=[305,320].includes(type)?`<span class="morning-allocation ${allocation?'assigned':'empty'}" title="${esc(allocation?'מספר ההקצאה שהתקבל מ-Morning':'לא התקבל מספר הקצאה מ-Morning; ייתכן שאינו נדרש למסמך הזה')}">מס׳ הקצאה: ${esc(allocation||'—')}</span>`:'';return `<div class="morning-history-row"><div><b>${esc(documentLabel(type))}${op.document_number?` #${esc(op.document_number)}`:''}</b><small>${esc(op.document_date||'')} · ${money(documentAmount(op))}${allocationText}</small></div><button class="btn tiny" data-action="morning-open-document" data-click-arg0="${esc(op.document_id)}">צפה</button></div>`}).join('')}
function populateLinkedDocuments(ops){const select=currentField('morningLinkedDocument');if(!select)return;const previous=select.value,rows=(ops||[]).filter(op=>operationCreated(op)&&Number(op.document_type)===305);select.innerHTML='<option value="">ללא קישור</option>'+rows.map(op=>`<option value="${esc(op.document_id)}">חשבונית מס ${esc(op.document_number?`#${op.document_number}`:'')} · ${money(documentAmount(op))}</option>`).join('');if(rows.some(op=>op.document_id===previous))select.value=previous;else if(rows.length===1)select.value=rows[0].document_id}

function applyCreatedOperations(ops){
  const d=debt();if(!d)return false;const matching=(ops||[]).filter(op=>operationCreated(op)&&sameAmount(documentAmount(op),d.amount));if(!matching.length)return false;
  const invoice=matching.some(op=>[305,320].includes(Number(op.document_type))),paid=matching.some(op=>[320,400].includes(Number(op.document_type)));if(!invoice&&!paid)return false;
  const now=new Date().toISOString();let changed=false;
  if(invoice&&!d.invoiceIssued){d.invoiceIssued=true;d.invoiceIssuedAt=d.invoiceIssuedAt||now;changed=true}
  if(paid&&!d.paid){d.paid=true;d.paidAt=d.paidAt||now;changed=true}
  if(changed){d.updatedAt=now;d.closedAt=d.paid&&d.invoiceIssued?(d.closedAt||now):null;scheduleSave('סטטוס חוב הלקוח עודכן ממסמך Morning');renderCustomers()}
  return changed;
}

async function refreshStatus({reconcile=false}={}){
  if(!activeDebtId)return;
  connectionStatus('loading','בודק חיבור ומסמכים קיימים…');
  try{
    const data=await backend('status',{debt_id:activeDebtId,reconcile});lastOperations=Array.isArray(data.operations)?data.operations:[];
    currentField('morningDocumentHistory')?.replaceChildren();const history=currentField('morningDocumentHistory');if(history)history.innerHTML=historyHtml(lastOperations);populateLinkedDocuments(lastOperations);applyCreatedOperations(lastOperations);
    const envLabel=data.environment==='sandbox'?'Sandbox':'Production';if(data.configured)connectionStatus(data.unresolved||data.environment==='sandbox'?'warning':'ready',data.unresolved?'יש ניסיון הפקה שדורש אימות לפני פעולה נוספת. לחץ „בדוק שוב”.':`מחובר ל-Morning ${envLabel} · ${lastOperations.filter(operationCreated).length} מסמכים מקושרים`);else connectionStatus('error',data.configuration_error==='invalid_environment'?'MORNING_ENV אינו תקין. יש לבחור production או sandbox.':'Morning אינו מוגדר בשרת. יש להגדיר את משתני הסביבה ב-Supabase.');
    const createButton=document.querySelector('[data-action="morning-create"]');if(createButton)createButton.disabled=!data.configured||!!data.unresolved;
    return data;
  }catch(error){connectionStatus('error',error.message||'לא ניתן לאמת את חיבור Morning');const createButton=document.querySelector('[data-action="morning-create"]');if(createButton)createButton.disabled=true;const history=currentField('morningDocumentHistory');if(history)history.innerHTML='<div class="morning-empty error">לא ניתן לקרוא כרגע את רישום מסמכי Morning. ההפקה חסומה ליתר ביטחון.</div>';return null}
}

async function previewMorningDocument(button){
  let payload;try{payload=readForm()}catch(error){return toast(error.message)}setBusy(button,true,'מכין…');
  try{const data=await backend('preview',payload),base64=String(data.pdfBase64||'');if(!base64)throw new Error('Morning לא החזירה קובץ תצוגה מקדימה');const binary=atob(base64),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);if(previewObjectUrl)URL.revokeObjectURL(previewObjectUrl);previewObjectUrl=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));const box=currentField('morningPreviewBox'),frame=currentField('morningPreviewFrame');if(frame)frame.src=previewObjectUrl;if(box){box.hidden=false;box.scrollIntoView({block:'nearest',behavior:'smooth'})}}
  catch(error){toast(error.message||'יצירת התצוגה המקדימה נכשלה')}finally{setBusy(button,false)}
}

async function createMorningDocument(button){
  let payload;try{payload=readForm()}catch(error){return toast(error.message)}
  const d=debt(),type=payload.document.type,amount=payload.document.amount;
  const missingTaxId=[305,320].includes(Number(type))&&!payload.document.client.taxId,allocationWarning=missingTaxId?'\n\nשים לב: לא הוזן מספר עוסק / ח.פ. ללקוח. אם זו חשבונית עסקית שנדרשת למספר הקצאה, Morning לא תוכל לבקש אותו בלי הפרט הזה.':'';
  const confirmed=await confirmDialog('הפקת מסמך רשמי',`להפיק עכשיו ${documentLabel(type)} על סך ${money(amount)} עבור ${d?.customerName||'הלקוח'}?\n\nלאחר ההפקה המסמך יקבל מספר רשמי ב-Morning.${allocationWarning}`,{confirmText:'הפק מסמך',cancelText:'חזור לעריכה',tone:'primary'});if(!confirmed)return;
  setBusy(button,true,'מפיק…');
  try{
    const data=await backend('create',payload);if(!data.document?.id)throw new Error('Morning אישרה את הבקשה אך לא החזירה מזהה מסמך');const allocation=cleanText(data.document.allocationNumber,40),taxDocument=[305,320].includes(Number(type));toast(`${documentLabel(type)} ${data.document.number?`#${data.document.number} `:''}הופק בהצלחה${allocation?` · מספר הקצאה ${allocation}`:taxDocument?' · מספר הקצאה לא חזר כרגע מ-Morning':''}`);activeOperationId=newOperationId();await refreshStatus({reconcile:false});
  }catch(error){
    if(error?.details?.uncertain){connectionStatus('warning','לא ניתן לדעת בוודאות אם Morning כבר הפיקה את המסמך. ההפקה נעצרה עד לאימות.');toast('החיבור נותק אחרי שליחת הבקשה. לא נשלח ניסיון נוסף כדי למנוע מסמך כפול.');await refreshStatus({reconcile:true})}else toast(error.message||'הפקת המסמך נכשלה');
  }finally{setBusy(button,false)}
}

async function openExistingDocument(documentId,button){setBusy(button,true,'פותח…');try{const data=await backend('open_document',{document_id:String(documentId||'')});const url=String(data.url||'');if(!/^https:\/\//.test(url))throw new Error('לא התקבל קישור מסמך תקין');const anchor=document.createElement('a');anchor.href=url;anchor.target='_blank';anchor.rel='noopener noreferrer';document.body.appendChild(anchor);anchor.click();anchor.remove()}catch(error){toast(error.message||'פתיחת המסמך נכשלה')}finally{setBusy(button,false)}}
async function reconcile(button){setBusy(button,true,'בודק…');try{await refreshStatus({reconcile:true})}finally{setBusy(button,false)}}

return {documentButton,openMorningDocument,syncDocumentType,syncPaymentType,previewMorningDocument,createMorningDocument,openExistingDocument,reconcile,refreshStatus};
}
