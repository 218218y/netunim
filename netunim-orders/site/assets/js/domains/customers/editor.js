import {esc,uid,clone} from '../../core/values.js';
import {money} from '../../core/money.js';
import {customerDebtProgressData,customerDebtProgressEntries,customerDebtActiveProgressEntries,customerDebtProgressMode} from '../../shared/customer-debt-progress.js';
import {applyVerifiedMorningDocumentToDebt} from './morning-debt.js';
import {$} from '../../state/constants.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsCustomersEditor({model, customerUi, modal, toast, scheduleSave, closeModal, renderCustomers, confirmDialog,isDebtRecoveryPending=()=>false,rejectDebtRecoveryMutation=()=>false}){

const persistedMorningDebts=new WeakMap();

const CUSTOMER_ORDER_FIELDS=new Set(['orderNumber','customerName','mark1','mark2','mark3','mattresses','note','urgent']);
const DEBT_SCALAR_FIELDS=['customerName','amount','orderNumber','phone','email','taxId','paid','supplied','invoiceIssued','note'];

function addCustomerOrder(){
  const now=new Date().toISOString(),row={id:uid('CORDER'),orderNumber:'',customerName:'',mark1:'',mark2:'',mark3:'',mattresses:'',note:'',urgent:false,createdAt:now,updatedAt:now};
  model.state.customerOrders=Array.isArray(model.state.customerOrders)?model.state.customerOrders:[];
  model.state.customerOrders.push(row);
  if(customerUi)customerUi.customerSearch=''
  scheduleSave('שורת מעקב הזמנה נוספה');renderCustomers();return row.id;
}

function saveCustomerOrderField(id,field,el){
  if(!CUSTOMER_ORDER_FIELDS.has(field))return;
  const o=(model.state.customerOrders||[]).find(x=>x.id===id);if(!o)return;
  const booleanField=field==='urgent',value=booleanField?String(el?.value??'').trim()==='true':String(el?.value??'').trim(),before=booleanField?o[field]===true:String(o[field]||'');
  if(before===value)return;
  o[field]=value;o.updatedAt=new Date().toISOString();scheduleSave(booleanField?'סימון הדחיפות של ההזמנה עודכן':'מעקב ההזמנה עודכן');
}

async function deleteCustomerOrder(id){
  const o=(model.state.customerOrders||[]).find(x=>x.id===id);if(!o)return;
  const label=o.customerName||o.orderNumber||'השורה הנבחרת';
  if(confirmDialog&&!await confirmDialog('מחיקת שורת מעקב',`למחוק את ${label}?`,{confirmText:'מחק שורה'}))return;
  model.state.customerOrders=model.state.customerOrders.filter(x=>x.id!==id);customerUi?.customerBulkSelected?.delete(id);
  scheduleSave('שורת מעקב ההזמנה נמחקה',{deleteIntents:{customerOrders:[id]},mutationType:'delete',surface:'orders.delete.customerOrders'});renderCustomers();
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
  modal(d?'עריכת חוב לקוח':'חוב לקוח חדש',`<div class="form-grid"><div class="field"><label>שם לקוח</label><input id="dName" value="${esc(d?.customerName||'')}"></div><div class="field"><label>סכום חוב</label><input id="dAmount" class="number-input" type="number" step="1" value="${esc(Number.isFinite(amountValue)?amountValue:'')}"></div><div class="field"><label>מספר הזמנה</label><input id="dOrder" value="${esc(d?.orderNumber||'')}"></div><div class="field"><label>טלפון</label><input id="dPhone" value="${esc(d?.phone||'')}"></div><div class="field"><label>אימייל <small>(למסמכי Morning)</small></label><input id="dEmail" type="email" value="${esc(d?.email||'')}"></div><div class="field"><label>מספר עוסק / ח.פ. <small>(למסמכי Morning)</small></label><input id="dTaxId" inputmode="numeric" maxlength="9" value="${esc(d?.taxId||'')}"></div><div class="field"><label>שולם</label><select id="dPaid">${progressModeOptions(paidMode,'payment',p)}</select></div><div class="field"><label>סופק</label><select id="dSupplied"><option value="false" ${d?.supplied!==true?'selected':''}>לא</option><option value="true" ${d?.supplied===true?'selected':''}>כן</option></select></div><div class="field"><label>חשבונית יצאה</label><select id="dInvoice">${progressModeOptions(invoiceMode,'invoice',p)}</select></div><div id="dAddPaymentField" class="field debt-progress-add-field"${paymentHidden}><label>הוסף תשלום לחוב</label><input id="dAddPayment" class="number-input" type="number" step="1" min="0" inputmode="decimal" placeholder="סכום נוסף"${paidMode==='partial'?'':' disabled'}></div><div id="dAddInvoiceField" class="field debt-progress-add-field"${invoiceHidden}><label>הוסף סכום חשבונית</label><input id="dAddInvoice" class="number-input" type="number" step="1" min="0" inputmode="decimal" placeholder="סכום נוסף"${invoiceMode==='partial'?'':' disabled'}></div><div class="field full"><div class="debt-progress-editor-help">כדי לרשום סכום חלקי בחר <b>חלקי</b>; רק אז יופיע שדה הסכום המתאים. הקלד בכל פעם רק את הסכום שנוסף עכשיו. אפשר להקליד אגורות ידנית, אבל החיצים משנים בשקלים שלמים. בחירה ב־<b>לא</b> מאפסת את ההתקדמות של אותו סוג באמצעות אירוע איפוס שמבטל את התנועות הקודמות בלי למחוק היסטוריה.</div></div>${progressSummary}<div class="field full"><label>הערה</label><textarea id="dNote">${esc(d?.note||'')}</textarea></div></div>`,`<button class="btn primary" data-action="save-debt" data-click-arg0="${esc(id||'')}">שמור</button>${d?`<button class="btn danger" data-action="delete-debt" data-click-arg0="${esc(d.id)}">מחק</button>`:''}<button class="btn" data-action="close-modal">ביטול</button>`);
  bindDebtProgressEditorFields();
  if(d&&isDebtRecoveryPending(d.id)){
    for(const id of ['dAmount','dPaid','dInvoice','dAddPayment','dAddInvoice']){const field=$('#'+id);if(field)field.disabled=true}
    const button=document.querySelector('[data-action="delete-debt"]');if(button)button.disabled=true;
    const notice=document.createElement('p');notice.className='debt-progress-editor-help';notice.setAttribute('role','status');notice.textContent='קיימת הפקת Morning שממתינה לאימות עבור חוב זה. יש להשלים בדיקת מצב הפקה לפני שינוי התשלום/חשבונית.';$('#dAmount')?.closest('.form-grid')?.prepend(notice);
  }
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
  const finalProgress=customerDebtProgressData(work),row={...base,id:d?.id||uid('DEBT'),customerName:name,amount,orderNumber:$('#dOrder').value.trim(),phone:$('#dPhone').value.trim(),email:$('#dEmail')?.value.trim()||'',taxId:$('#dTaxId')?.value.replace(/\D/g,'').slice(0,9)||'',paid:work.paid===true,supplied,invoiceIssued:work.invoiceIssued===true,note:$('#dNote').value.trim()};
  if(entries.length)row.debtProgress=entries;else delete row.debtProgress;
  const scalarChanged=!d||!sameScalar(d,row),progressChanged=JSON.stringify(customerDebtProgressEntries(d||{}))!==JSON.stringify(entries);
  if(scalarChanged||progressChanged||!d){const wasClosed=currentProgress.paymentComplete&&currentProgress.invoiceComplete;row.updatedAt=now;row.paidAt=finalProgress.paymentComplete?(currentProgress.paymentComplete?(d?.paidAt||now):now):null;row.suppliedAt=supplied?(d?.suppliedAt||now):null;row.invoiceIssuedAt=finalProgress.invoiceComplete?(currentProgress.invoiceComplete?(d?.invoiceIssuedAt||now):now):null;row.closedAt=finalProgress.paymentComplete&&finalProgress.invoiceComplete?(wasClosed?(d?.closedAt||now):now):null}else{row.updatedAt=d.updatedAt;row.paidAt=d.paidAt;row.suppliedAt=d.suppliedAt;row.invoiceIssuedAt=d.invoiceIssuedAt;row.closedAt=d.closedAt}
  if(d)Object.assign(d,row);else model.state.customerDebts.push(row);
  closeModal();if(scalarChanged||progressChanged||!d)scheduleSave(d?'חוב הלקוח עודכן':'חוב הלקוח נוסף');renderCustomers();
}

function localDateTime(value){const date=new Date(value||'');return Number.isFinite(date.getTime())?date.toLocaleString('he-IL',{dateStyle:'short',timeStyle:'short'}):'ללא תאריך'}
function progressSourceLabel(source){return source==='manual'?'ידני':source==='morning'?'Morning':source||'מערכת'}
function progressEntryMarkup(row){const payment=row.kind==='payment',reset=row.action==='reset',label=payment?'תשלום':'חשבונית',action=reset?'איפוס':'נוסף';return `<div class="debt-progress-history-row"><div><b>${esc(label)} · ${esc(action)}</b><small>${esc(localDateTime(row.createdAt))} · ${esc(progressSourceLabel(row.source))}${reset?` · ${esc((row.clears||[]).length)} תנועות בוטלו`:''}</small></div><strong class="${esc(reset?'warntext':'goodtext')}">${reset?'איפוס':money(row.amount)}</strong></div>`}

function openDebtProgressDetails(id){
  const d=(model.state.customerDebts||[]).find(x=>x.id===id);if(!d)return toast('חוב הלקוח לא נמצא');const p=customerDebtProgressData(d),rows=customerDebtProgressEntries(d).slice().sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))||String(b.id||'').localeCompare(String(a.id||'')));
  modal(`פירוט חוב · ${d.customerName||'לקוח'}`,`<div class="debt-progress-details"><section class="debt-progress-total"><span>סכום החוב המקורי</span><b>${money(d.amount)}</b></section><section class="debt-progress-detail-grid"><div><span>שולם</span><b>${money(p.paymentApplied)}</b><small>נותר ${money(p.remainingPayment)}</small></div><div><span>חשבוניות</span><b>${money(p.invoiceApplied)}</b><small>נותר ${money(p.remainingInvoice)}</small></div></section><div class="debt-progress-history"><h4>תנועות שנרשמו</h4>${rows.map(progressEntryMarkup).join('')||'<div class="empty debt-progress-empty">אין תנועות חלקיות. מצב מלא שסומן ידנית נשמר בשדות הסטטוס הרגילים.</div>'}</div></div>`,`<button class="btn primary" data-action="open-debt-modal-2" data-click-arg0="${esc(d.id)}">עריכת החוב</button><button class="btn" data-action="close-modal">סגור</button>`);
}


function applyVerifiedMorningDocument({debtId,operationId,type,amount,verifiedAt,applyPayment=true,applyInvoice=true}={}){
  const d=(model.state.customerDebts||[]).find(row=>row.id===debtId);if(!d)return {changed:false,reason:'missing-debt'};
  const result=applyVerifiedMorningDocumentToDebt(d,{operationId,type,amount,verifiedAt,applyPayment,applyInvoice});
  if(result.changed||result.reason==='already-applied'){
    if(!result.changed&&persistedMorningDebts.get(d)===JSON.stringify(d))return {...result,persisted:true};
    // A replay can mean the first verified application changed memory but localSnapshot failed.
    // Re-attempt durable persistence before recovery is allowed to clear its operation binding.
    const persisted=scheduleSave(result.changed?'חוב הלקוח עודכן לפי מסמך Morning מאומת':'עדכון החוב מ-Morning נשמר מחדש לאחר התאוששות',{surface:'orders.morning.customerDebt'});
    if(persisted!==false)persistedMorningDebts.set(d,JSON.stringify(d));
    if(result.changed)renderCustomers();return {...result,persisted:persisted!==false};
  }
  return result;
}

async function deleteDebt(id){const d=model.state.customerDebts.find(x=>x.id===id);if(!d||rejectDebtRecoveryMutation(id))return;if(!await confirmDialog('מחיקת חוב',`למחוק את החוב של ${d.customerName}?`,{confirmText:'מחק חוב'}))return;if(rejectDebtRecoveryMutation(id))return;model.state.customerDebts=model.state.customerDebts.filter(x=>x.id!==id);closeModal();scheduleSave('חוב הלקוח נמחק',{deleteIntents:{customerDebts:[id]},mutationType:'delete',surface:'orders.delete.customerDebts'});renderCustomers()}

return { addCustomerOrder, saveCustomerOrderField, deleteCustomerOrder, openDebtModal, saveDebt, openDebtProgressDetails, applyVerifiedMorningDocument, deleteDebt };
}
