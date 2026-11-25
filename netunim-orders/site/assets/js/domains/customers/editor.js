import {esc,uid,clone} from '../../core/values.js';
import {money} from '../../core/money.js';
import {customerDebtProgressData,customerDebtProgressEntries,customerDebtActiveProgressEntries,customerDebtVisibleProgressEntries,customerDebtProgressMode} from '../../shared/customer-debt-progress.js';
import {normalizeNoteReminderDate} from '../../contracts/note-reminder-date.js';
import {checkDateFmt} from '../../core/dates.js';
import {applyVerifiedMorningDocumentToDebt,morningDebtAllocationMatches} from './morning-debt.js';
import {addVerifiedMorningDebtDocument,morningDebtDocuments} from './morning-debt-documents.js';
import {morningDocumentLabel} from '../../core/morning-document-types.js';
import {$} from '../../state/constants.js';

function saveDebtChange(debt,message,scheduleSave){
  debt.updatedAt=new Date().toISOString();
  scheduleSave(message,{
    domains:['customerDebts'],
    operations:[{type:'put',collection:'customerDebts',id:debt.id,mode:'replace',record:debt}],
  });
}

export function updateDebtNote(debt,note,scheduleSave){
  if(note===String(debt.note||''))return false;
  debt.note=note;
  saveDebtChange(debt,'הערת הלקוח עודכנה',scheduleSave);
  return true;
}

export function updateDebtUrgency(debt,note,scheduleSave,reminderDate=normalizeNoteReminderDate(debt.urgency?.reminderDate)){
  if(note===(debt.urgency?.note??null)&&reminderDate===(debt.urgency?.reminderDate??''))return false;
  if(note===null)delete debt.urgency;
  else debt.urgency=reminderDate?{note,reminderDate}:{note};
  saveDebtChange(debt,note===null?'סימון הדחיפות הוסר':'סימון הדחיפות נשמר',scheduleSave);
  return true;
}

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsCustomersEditor({model, customerUi, modal, toast, scheduleSave, commitSave, closeModal, renderCustomers, confirmDialog,reminderPicker,rejectMutation=()=>false,hydrateMorningDebtDocuments=()=>{},isDebtRecoveryPending=()=>false,rejectDebtRecoveryMutation=()=>false,morningMetadataState=()=> ''}){

const uncommittedMorningDebts=new WeakSet();

const CUSTOMER_ORDER_FIELDS=new Set(['orderNumber','customerName','mark1','mark2','mark3','mattresses','note','urgent']);
const DEBT_SCALAR_FIELDS=['customerName','amount','phone','email','customerId','clearingApproval','paid','supplied','invoiceIssued','note'];

function addCustomerOrder(){
  const now=new Date().toISOString(),row={id:uid('CORDER'),orderNumber:'',customerName:'',mark1:'',mark2:'',mark3:'',mattresses:'',note:'',urgent:false,createdAt:now,updatedAt:now};
  model.state.customerOrders=Array.isArray(model.state.customerOrders)?model.state.customerOrders:[];
  model.state.customerOrders.push(row);
  if(customerUi)customerUi.customerSearch=''
  scheduleSave('שורת מעקב הזמנה נוספה',{domains:['customerOrders'],operations:[{type:'put',collection:'customerOrders',id:row.id,mode:'insert',index:model.state.customerOrders.length-1,record:row}]});renderCustomers({resultsOnly:true});return row.id;
}

function saveCustomerOrderField(id,field,el){
  if(!CUSTOMER_ORDER_FIELDS.has(field))return;
  const o=(model.state.customerOrders||[]).find(x=>x.id===id);if(!o)return;
  const booleanField=field==='urgent',value=booleanField?String(el?.value??'').trim()==='true':String(el?.value??'').trim(),before=booleanField?o[field]===true:String(o[field]||'');
  if(before===value)return;
  o[field]=value;o.updatedAt=new Date().toISOString();scheduleSave(booleanField?'סימון הדחיפות של ההזמנה עודכן':'מעקב ההזמנה עודכן',{domains:['customerOrders'],operations:[{type:'put',collection:'customerOrders',id:o.id,mode:'replace',record:o}]});
}

async function deleteCustomerOrder(id){
  const o=(model.state.customerOrders||[]).find(x=>x.id===id);if(!o)return;
  const label=o.customerName||o.orderNumber||'השורה הנבחרת';
  if(confirmDialog&&!await confirmDialog('מחיקת שורת מעקב',`למחוק את ${label}?`,{confirmText:'מחק שורה'}))return;
  model.state.customerOrders=model.state.customerOrders.filter(x=>x.id!==id);customerUi?.customerBulkSelected?.delete(id);
  scheduleSave('שורת מעקב ההזמנה נמחקה',{deleteIntents:{customerOrders:[id]},mutationType:'delete',surface:'orders.delete.customerOrders',domains:['customerOrders'],operations:[{type:'delete',collection:'customerOrders',id}]});renderCustomers({resultsOnly:true});
}

function progressModeOptions(mode,kind,p){
  const partialAmount=kind==='payment'?p.paymentApplied:p.invoiceApplied;
  return `<option value="false" ${mode==='false'?'selected':''}>לא</option><option value="partial" ${mode==='partial'?'selected':''}>חלקי${mode==='partial'?` · ${money(partialAmount)}`:''}</option><option value="true" ${mode==='true'?'selected':''}>כן · במלואו</option>`;
}

function syncDebtProgressAddField(selectSelector,fieldSelector,inputSelector,{clearInactive=false}={}){
  const select=$(selectSelector),field=$(fieldSelector),input=$(inputSelector);if(!select||!field||!input)return;
  const partial=select.value==='partial';field.hidden=!partial;input.disabled=!partial;
  if(!partial&&clearInactive)input.value='';
}

function bindDebtProgressEditorFields(){
  if(typeof document==='undefined')return;
  const pairs=[['#dPaid','#dAddPaymentField','#dAddPayment'],['#dInvoice','#dAddInvoiceField','#dAddInvoice']];
  for(const [selectSelector,fieldSelector,inputSelector] of pairs){
    const select=$(selectSelector);if(!select)continue;
    select.addEventListener('change',()=>syncDebtProgressAddField(selectSelector,fieldSelector,inputSelector,{clearInactive:true}));
    syncDebtProgressAddField(selectSelector,fieldSelector,inputSelector);
  }
}

function openDebtModal(id=null){
  const d=id?model.state.customerDebts.find(x=>x.id===id):null,amountValue=d?Number(d.amount??0):'',p=customerDebtProgressData(d||{}),paidMode=customerDebtProgressMode(p,'payment'),invoiceMode=customerDebtProgressMode(p,'invoice');
  const progressSummary=d?`<section class="debt-progress-editor-summary"><div><span>תשלום</span><b>${money(p.paymentApplied)}</b><small>נותר ${money(p.remainingPayment)}</small></div><div><span>חשבוניות</span><b>${money(p.invoiceApplied)}</b><small>נותר ${money(p.remainingInvoice)}</small></div><button type="button" class="btn small" data-action="open-debt-progress-details" data-click-arg0="${esc(d.id)}">פירוט תנועות</button></section>`:'';
  const paymentHidden=paidMode==='partial'?'':' hidden',invoiceHidden=invoiceMode==='partial'?'':' hidden';
  modal(d?'עריכת חוב לקוח':'חוב לקוח חדש',`<div class="form-grid"><div class="field"><label>שם לקוח</label><input id="dName" value="${esc(d?.customerName||'')}"></div><div class="field"><label>סכום חוב</label><input id="dAmount" class="number-input" type="number" step="1" value="${esc(Number.isFinite(amountValue)?amountValue:'')}"></div><div class="field"><label>טלפון</label><input id="dPhone" value="${esc(d?.phone||'')}"></div><div class="field"><label>אימייל <small>(למסמכי Morning)</small></label><input id="dEmail" type="email" value="${esc(d?.email||'')}"></div><div class="field"><label>שולם</label><select id="dPaid">${progressModeOptions(paidMode,'payment',p)}</select></div><div class="field"><label>סופק</label><select id="dSupplied"><option value="false" ${d?.supplied!==true?'selected':''}>לא</option><option value="true" ${d?.supplied===true?'selected':''}>כן</option></select></div><div class="field"><label>חשבונית יצאה</label><select id="dInvoice">${progressModeOptions(invoiceMode,'invoice',p)}</select></div><div id="dAddPaymentField" class="field debt-progress-add-field"${paymentHidden}><label>הוסף תשלום לחוב</label><input id="dAddPayment" class="number-input" type="number" step="1" min="0" inputmode="decimal" placeholder="סכום נוסף"${paidMode==='partial'?'':' disabled'}></div><div id="dAddInvoiceField" class="field debt-progress-add-field"${invoiceHidden}><label>הוסף סכום חשבונית</label><input id="dAddInvoice" class="number-input" type="number" step="1" min="0" inputmode="decimal" placeholder="סכום נוסף"${invoiceMode==='partial'?'':' disabled'}></div><div class="field full"><div class="debt-progress-editor-help">כדי לרשום סכום חלקי בחר <b>חלקי</b>; רק אז יופיע שדה הסכום המתאים. הקלד בכל פעם רק את הסכום שנוסף עכשיו. אפשר להקליד אגורות ידנית, אבל החיצים משנים בשקלים שלמים. בחירה ב־<b>לא</b> מאפסת את ההתקדמות של אותו סוג באמצעות אירוע איפוס שמבטל את התנועות הקודמות בלי למחוק היסטוריה.</div></div>${progressSummary}<div class="field full"><label>הערה</label><textarea id="dNote">${esc(d?.note||'')}</textarea></div><div class="field"><label>סליקה</label><input id="dClearingApproval" inputmode="numeric" maxlength="20" autocomplete="off" value="${esc(d?.clearingApproval||'')}"></div><div class="field"><label>ת.ז</label><input id="dCustomerId" inputmode="numeric" maxlength="9" autocomplete="off" value="${esc(d?.customerId||'')}"></div></div>`,`<button class="btn primary" data-action="save-debt" data-click-arg0="${esc(id||'')}">שמור</button>${d?`<button class="btn danger" data-action="delete-debt" data-click-arg0="${esc(d.id)}">מחק</button>`:''}<button class="btn" data-action="close-modal">ביטול</button>`);
  bindDebtProgressEditorFields();
  if(d&&isDebtRecoveryPending(d.id)){
    for(const id of ['dAmount','dPaid','dInvoice','dAddPayment','dAddInvoice']){const field=$('#'+id);if(field)field.disabled=true}
    const button=document.querySelector('[data-action="delete-debt"]');if(button)button.disabled=true;
    const notice=document.createElement('p');notice.className='debt-progress-editor-help';notice.setAttribute('role','status');notice.textContent='קיימת הפקת Morning שממתינה לאימות עבור חוב זה. יש להשלים בדיקת מצב הפקה לפני שינוי התשלום/חשבונית.';$('#dAmount')?.closest('.form-grid')?.prepend(notice);
  }
}

function openDebtUrgency(id){
  const debt=model.state.customerDebts.find(row=>row.id===id);
  if(!debt)return toast('חוב הלקוח לא נמצא');
  const urgency=debt.urgency,date=normalizeNoteReminderDate(urgency?.reminderDate);
  modal('דחוף לטיפול',
    `<div class="field customer-debt-urgency-dialog"><b>${esc(debt.customerName)}</b>
      <label for="debtUrgencyNote">הערת דחיפות</label><textarea id="debtUrgencyNote" rows="3">${esc(urgency?.note??'')}</textarea>
      <div class="debt-urgency-reminder-actions">
        <button type="button" class="btn small" data-action="open-debt-urgency-reminder" data-click-arg0="${esc(id)}"
      aria-controls="debtUrgencyReminder" aria-expanded="false">${date?`התראה · ${esc(checkDateFmt(date))}`:'התראה'}</button>
        ${date?`<button type="button" class="btn small" data-action="remove-debt-urgency-reminder" data-click-arg0="${esc(id)}">בטל התראה</button>`:''}</div>
      <div id="debtUrgencyReminder" hidden></div></div>`,
    `<button type="button" class="btn primary" data-action="save-debt-urgency" data-click-arg0="${esc(id)}">${urgency?'שמור':'אישור'}</button>${urgency?`<button type="button" class="btn danger" data-action="remove-debt-urgency" data-click-arg0="${esc(id)}">הסר סימון</button>`:''}<button type="button" class="btn" data-action="close-modal">ביטול</button>`);
  $('#debtUrgencyNote')?.focus();
}

function openDebtUrgencyReminder(id,button){
  const debt=model.state.customerDebts.find(row=>row.id===id),host=$('#debtUrgencyReminder');
  if(!debt||!host)return false;
  if(host.hidden){
    host.innerHTML=reminderPicker.markup({date:debt.urgency?.reminderDate});
    host.hidden=false;
  }
  button.setAttribute('aria-expanded','true');
  reminderPicker.focus();
  return true;
}

function saveDebtUrgency(id,urgent){
  const debt=model.state.customerDebts.find(row=>row.id===id);
  if(!debt)return toast('חוב הלקוח לא נמצא');
  const note=urgent?$('#debtUrgencyNote')?.value.trim():null;
  if(note===undefined)return;
  const editingDate=urgent&&$('#debtUrgencyReminder')?.hidden===false;
  const date=editingDate?reminderPicker.readDate():undefined;
  if(editingDate&&!date)return;
  closeModal();
  if(updateDebtUrgency(debt,note,scheduleSave,date))renderCustomers({resultsOnly:true});
}

async function removeDebtUrgencyReminder(id,{button,expectedDate}={}){
  const getDebt=()=>model.state.customerDebts.find(row=>row.id===id);
  const date=normalizeNoteReminderDate(getDebt()?.urgency?.reminderDate);
  if(!date||(expectedDate&&date!==expectedDate)||!await confirmDialog('ביטול התראה',`לבטל את התראת הדחיפות ל־${checkDateFmt(date)}?`,{confirmText:'בטל התראה'}))return false;
  const debt=getDebt();
  if(normalizeNoteReminderDate(debt?.urgency?.reminderDate)!==date||rejectMutation())return false;
  updateDebtUrgency(debt,debt.urgency.note??'',scheduleSave,'');
  if(button?.isConnected){
    const host=$('#debtUrgencyReminder'),toggle=$('[aria-controls="debtUrgencyReminder"]');
    host.hidden=true;
    host.replaceChildren();
    toggle.textContent='התראה';
    toggle.setAttribute('aria-expanded','false');
    button.remove();
    toggle.focus();
  }
  return true;
}

function parseAddedAmount(selector,label){
  const raw=$(selector)?.value?.trim()||'';if(!raw)return 0;const value=Number(raw);
  if(!Number.isFinite(value)||value<=0){toast(`יש להזין ${label} חיובי ותקין`);return null}return Math.round(value*100)/100;
}

function addProgressEntry(entries,kind,amount,now){entries.push({id:uid(kind==='payment'?'DPAY':'DINV'),kind,action:'add',amount:Math.round(Number(amount)*100)/100,source:'manual',createdAt:now})}
function addProgressReset(entries,debt,kind,now){const clears=customerDebtActiveProgressEntries(debt,kind).map(row=>row.id);if(clears.length)entries.push({id:uid(kind==='payment'?'DPAYRESET':'DINVRESET'),kind,action:'reset',clears,source:'manual',createdAt:now});return clears.length>0}
function sameScalar(a,b){return DEBT_SCALAR_FIELDS.every(key=>JSON.stringify(a?.[key]??null)===JSON.stringify(b?.[key]??null))}

function applyProgressMode(work,entries,kind,mode,addAmount,now){
  const flag=kind==='payment'?'paid':'invoiceIssued';
  if(mode==='false'){
    work[flag]=false;if(addAmount>0){toast(`לא ניתן להוסיף ${kind==='payment'?'תשלום':'חשבונית'} כאשר המצב מוגדר "לא"`);return false}
    if(addProgressReset(entries,work,kind,now))work.debtProgress=entries;
    return true;
  }
  if(mode==='true'){
    if(addAmount>0){toast(`כדי להוסיף סכום חלקי יש לבחור במצב "חלקי"`);return false}return true;
  }
  work[flag]=false;work.debtProgress=entries;
  let p=customerDebtProgressData(work),remaining=kind==='payment'?p.remainingPaymentMagnitude:p.remainingInvoiceMagnitude;
  if(addAmount>remaining+0.004){toast(`הסכום שהוזן (${money(addAmount)}) גבוה מהיתרה שנותרה (${money(remaining)})`);return false}
  if(addAmount>0){addProgressEntry(entries,kind,addAmount,now);work.debtProgress=entries;p=customerDebtProgressData(work)}
  const partial=kind==='payment'?p.paymentPartial:p.invoicePartial,complete=kind==='payment'?p.paymentComplete:p.invoiceComplete;
  if(!partial&&!complete){toast(`כדי לסמן ${kind==='payment'?'תשלום':'חשבונית'} כחלקי יש להזין סכום`);return false}
  return true;
}

function saveDebt(id=''){
  const name=$('#dName').value.trim(),rawAmount=$('#dAmount').value.trim(),amount=rawAmount===''?0:Number(rawAmount);
  if(!name)return toast('יש להזין שם לקוח');if(!Number.isFinite(amount))return toast('יש להזין סכום חוב תקין');
  const addPayment=parseAddedAmount('#dAddPayment','סכום תשלום');if(addPayment===null)return;const addInvoice=parseAddedAmount('#dAddInvoice','סכום חשבונית');if(addInvoice===null)return;
  let d=id?model.state.customerDebts.find(x=>x.id===id):null;const now=new Date().toISOString(),base=d||{},currentProgress=customerDebtProgressData(base),currentPaidMode=customerDebtProgressMode(currentProgress,'payment'),currentInvoiceMode=customerDebtProgressMode(currentProgress,'invoice');
  const paidMode=$('#dPaid').value,invoiceMode=$('#dInvoice').value,supplied=$('#dSupplied').value==='true',entries=clone(customerDebtProgressEntries(base));
  if(d&&(amount!==Number(d.amount)||paidMode!==currentPaidMode||invoiceMode!==currentInvoiceMode||addPayment>0||addInvoice>0)&&rejectDebtRecoveryMutation(id))return;
  const work={...base,amount,debtProgress:entries};
  work.paid=paidMode==='true'?(d&&currentPaidMode==='true'?d.paid===true:true):false;
  work.invoiceIssued=invoiceMode==='true'?(d&&currentInvoiceMode==='true'?d.invoiceIssued===true:true):false;
  if(!applyProgressMode(work,entries,'payment',paidMode,addPayment,now))return;
  if(!applyProgressMode(work,entries,'invoice',invoiceMode,addInvoice,now))return;
  const finalProgress=customerDebtProgressData(work),row={...base,id:d?.id||uid('DEBT'),customerName:name,amount,phone:$('#dPhone').value.trim(),email:$('#dEmail')?.value.trim()||'',customerId:$('#dCustomerId')?.value.replace(/\D/g,'').slice(0,9)||'',clearingApproval:$('#dClearingApproval')?.value.replace(/\D/g,'').slice(0,20)||'',paid:work.paid===true,supplied,invoiceIssued:work.invoiceIssued===true,note:$('#dNote').value.trim()};delete row.orderNumber;delete row.taxId;
  if(entries.length)row.debtProgress=entries;else delete row.debtProgress;
  const scalarChanged=!d||!sameScalar(d,row),progressChanged=JSON.stringify(customerDebtProgressEntries(d||{}))!==JSON.stringify(entries);
  if(scalarChanged||progressChanged||!d){const wasClosed=currentProgress.paymentComplete&&currentProgress.invoiceComplete;row.updatedAt=now;row.paidAt=finalProgress.paymentComplete?(currentProgress.paymentComplete?(d?.paidAt||now):now):null;row.suppliedAt=supplied?(d?.suppliedAt||now):null;row.invoiceIssuedAt=finalProgress.invoiceComplete?(currentProgress.invoiceComplete?(d?.invoiceIssuedAt||now):now):null;row.closedAt=finalProgress.paymentComplete&&finalProgress.invoiceComplete?(wasClosed?(d?.closedAt||now):now):null}else{row.updatedAt=d.updatedAt;row.paidAt=d.paidAt;row.suppliedAt=d.suppliedAt;row.invoiceIssuedAt=d.invoiceIssuedAt;row.closedAt=d.closedAt}
  if(d)Object.assign(d,row);else model.state.customerDebts.push(row);
  closeModal();if(scalarChanged||progressChanged||!d)scheduleSave(d?'חוב הלקוח עודכן':'חוב הלקוח נוסף',{domains:['customerDebts'],operations:[{type:'put',collection:'customerDebts',id:row.id,mode:d?'replace':'insert',index:model.state.customerDebts.findIndex(item=>item.id===row.id),record:row}]});renderCustomers({resultsOnly:true});
}

function localDateTime(value){const date=new Date(value||'');return Number.isFinite(date.getTime())?date.toLocaleString('he-IL',{dateStyle:'short',timeStyle:'short'}):'ללא תאריך'}
function progressSourceLabel(source){return source==='manual'?'ידני':source==='morning'?'Morning':source||'מערכת'}
function progressEntryMarkup(debt,row,link,blocked){
  const label=row.kind==='payment'?'תשלום':'חשבונית',reset=row.action==='reset';
  const removeLabel=reset?`מחק איפוס ${label}`:`מחק תנועת ${label} בסך ${money(row.amount)}`;
  const remove=`<button type="button" class="icon-btn debt-progress-remove" title="${esc(removeLabel)}"
    aria-label="${esc(removeLabel)}" data-action="remove-debt-progress-entry"
    data-click-arg0="${esc(debt.id)}" data-click-arg1="${esc(row.kind)}" data-click-arg2="${esc(row.id)}"${blocked?' disabled':''}>
    <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/></svg></button>`;
  let documentButton='';
  if(link){
    const status=morningMetadataState(debt,link.operationId),unresolved=!link.documentId||!link.documentNumber||!Number(link.documentType)||!!status;
    const title=morningDocumentLabel(link,unresolved?'טוען פרטי מסמך…':'מסמך Morning')+(status==='unconfirmed'?' · לא נשמר בחוב':status==='pending'?' · שומר פרטים…':'');
    documentButton=`<button type="button" class="bank-row-morning-doc" data-action="morning-open-document"
      data-click-arg0="${esc(link.documentId)}" data-click-arg1="${esc(link.operationId)}"
      ${unresolved?`data-morning-debt-operation="${esc(link.operationId)}"`:''}
      title="צפה במסמך Morning ${esc(link.documentNumber||'')}">
      <span aria-hidden="true">▤</span><span data-morning-debt-label>${esc(title)}</span></button>`;
  }
  return `<div class="debt-progress-history-row"><div><b>${reset?'איפוס':label}</b><small>${esc(localDateTime(row.createdAt))} · ${esc(progressSourceLabel(row.source))}${reset?` · ${esc((row.clears||[]).length)} תנועות בוטלו`:''}</small>${documentButton}</div><strong class="${reset?'warntext':'goodtext'}">${reset?'':money(row.amount)}</strong>${remove}</div>`;
}

function progressHistoryMarkup(debt,kind,links,blocked){
  const rows=customerDebtVisibleProgressEntries(debt,kind).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))||String(b.id||'').localeCompare(String(a.id||'')));
  const entries=rows.map(row=>{
    const operation=/^MORNING:([^:]+):(payment|invoice)$/.exec(String(row.id||''))?.[1];
    return progressEntryMarkup(debt,row,links.get(operation),blocked);
  }).join('');
  const title=kind==='payment'?'תנועות חוב':'תנועות חשבונית';
  return `<section class="debt-progress-history" data-debt-progress-kind="${kind}"><h4>${title}</h4>${entries||'<div class="empty debt-progress-empty">אין תנועות שנרשמו</div>'}</section>`;
}

function openDebtProgressDetails(id){
  const d=(model.state.customerDebts||[]).find(x=>x.id===id);
  if(!d)return toast('חוב הלקוח לא נמצא');
  const p=customerDebtProgressData(d),blocked=isDebtRecoveryPending(id);
  const links=new Map(morningDebtDocuments(d).map(link=>[link.operationId,link]));
  const paymentHistory=progressHistoryMarkup(d,'payment',links,blocked),invoiceHistory=progressHistoryMarkup(d,'invoice',links,blocked);
  const remainingLabel=p.paymentPartial?'נותר לתשלום':p.invoicePartial?'נותר לחשבונית':'יתרה שנותרה',remainingValue=p.paymentPartial?p.remainingPayment:p.invoicePartial?p.remainingInvoice:p.remainingPayment;
  modal(`פירוט חוב · ${d.customerName||'לקוח'}`,`<div class="debt-progress-details">
    <section class="debt-progress-total debt-progress-total-remaining">
    <div><span>${esc(remainingLabel)}</span><small>מתוך חוב מקורי ${money(d.amount)}</small></div><b>${money(remainingValue)}</b></section>
    <section class="debt-progress-detail-grid"><div><span>שולם</span><b>${money(p.paymentApplied)}</b><small>מתוך ${money(p.targetMagnitude)}</small></div>
    <div><span>חשבוניות</span><b>${money(p.invoiceApplied)}</b><small>נותר ${money(p.remainingInvoice)}</small></div></section>
    <div class="debt-progress-history-grid" dir="rtl">${paymentHistory}${invoiceHistory}</div>
    </div>`,`<button class="btn primary" data-action="open-debt-modal-2" data-click-arg0="${esc(d.id)}">עריכת החוב</button><button class="btn" data-action="close-modal">סגור</button>`);
  hydrateMorningDebtDocuments(globalThis.document);
}

async function removeDebtProgressEntry(id,kind,entryId){
  if(!['payment','invoice'].includes(kind))return false;
  const findDebt=()=>model.state.customerDebts.find(row=>row.id===id);
  const findEntry=debt=>customerDebtVisibleProgressEntries(debt,kind).find(row=>row.id===entryId);
  const entry=findEntry(findDebt());
  if(!entry||rejectDebtRecoveryMutation(id))return false;
  const label=kind==='payment'?'תשלום':'חשבונית';
  const detail=entry.action==='reset'?`למחוק את איפוס ה${label}? תנועות שבוטלו רק באיפוס הזה ישובו להיכלל בחישוב.`:`למחוק תנועת ${label} בסך ${money(entry.amount)} מרישום החוב?`;
  if(!await confirmDialog('מחיקת תנועה',detail,{confirmText:'מחק תנועה'}))return false;
  const debt=findDebt();
  if(!findEntry(debt)||rejectMutation()||rejectDebtRecoveryMutation(id))return false;
  const before=customerDebtProgressData(debt),now=new Date().toISOString();
  debt.debtProgress=[...customerDebtProgressEntries(debt),{id:uid('DREMOVE'),kind,action:'reset',clears:[entryId],removesEntry:true,source:'manual',createdAt:now}];
  const after=customerDebtProgressData(debt);
  if(kind==='payment')debt.paidAt=after.paymentComplete?(before.paymentComplete?debt.paidAt:now):null;
  else debt.invoiceIssuedAt=after.invoiceComplete?(before.invoiceComplete?debt.invoiceIssuedAt:now):null;
  debt.closedAt=after.paymentComplete&&after.invoiceComplete?(debt.closedAt||now):null;
  saveDebtChange(debt,'התנועה נמחקה מרישום החוב',scheduleSave);
  renderCustomers({resultsOnly:true});
  openDebtProgressDetails(id);
  return true;
}

async function applyVerifiedMorningDocument({debtId,operationId,documentId,documentNumber,type,amount,verifiedAt,applyPayment=true,applyInvoice=true}={}){
  const d=(model.state.customerDebts||[]).find(row=>row.id===debtId);if(!d)return {changed:false,reason:'missing-debt'};
  const command={operationId,type,amount,verifiedAt,applyPayment,applyInvoice};
  if(!morningDebtAllocationMatches(d,command,true))return {changed:false,reason:'conflicting-recovery'};
  const result=applyVerifiedMorningDocumentToDebt(d,command);
  const linkChanged=addVerifiedMorningDebtDocument(d,{operationId,documentId,documentNumber,type,verifiedAt});
  const linked=d.morningDocuments?.some(link=>link.operationId===operationId&&link.documentId===documentId&&link.documentType===type);
  const changed=result.changed||linkChanged;
  if(!linked||!morningDebtAllocationMatches(d,command))return {changed,reason:'conflicting-recovery',persisted:false};
  if(!changed&&!uncommittedMorningDebts.has(d))return {...result,persisted:true};
  uncommittedMorningDebts.add(d);
  const commit=commitSave(changed?'חוב הלקוח עודכן לפי מסמך Morning מאומת':'',{surface:'orders.morning.customerDebt',domains:['customerDebts'],operations:[{type:'put',collection:'customerDebts',id:d.id,mode:'replace',record:d}]});
  if(changed)renderCustomers({resultsOnly:true});
  const persisted=await commit===true;
  if(persisted)uncommittedMorningDebts.delete(d);
  return {...result,changed,persisted};
}

async function deleteDebt(id){const d=model.state.customerDebts.find(x=>x.id===id);if(!d||rejectDebtRecoveryMutation(id))return;if(!await confirmDialog('מחיקת חוב',`למחוק את החוב של ${d.customerName}?`,{confirmText:'מחק חוב'}))return;if(rejectDebtRecoveryMutation(id))return;model.state.customerDebts=model.state.customerDebts.filter(x=>x.id!==id);closeModal();scheduleSave('חוב הלקוח נמחק',{deleteIntents:{customerDebts:[id]},mutationType:'delete',surface:'orders.delete.customerDebts',domains:['customerDebts'],operations:[{type:'delete',collection:'customerDebts',id}]});renderCustomers({resultsOnly:true})}

return { addCustomerOrder, saveCustomerOrderField, deleteCustomerOrder, openDebtModal, saveDebt, openDebtUrgency, openDebtUrgencyReminder, saveDebtUrgency, removeDebtUrgencyReminder, openDebtProgressDetails, removeDebtProgressEntry, applyVerifiedMorningDocument, deleteDebt };
}
