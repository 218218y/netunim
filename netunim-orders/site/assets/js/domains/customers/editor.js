import {esc, uid} from '../../core/values.js';
import {$} from '../../state/constants.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsCustomersEditor({model, customerUi, modal, toast, scheduleSave, closeModal, renderCustomers, confirmDialog}){

const CUSTOMER_ORDER_FIELDS=new Set(['orderNumber','customerName','mark1','mark2','mark3','mattresses','note']);

function addCustomerOrder(){
  const now=new Date().toISOString(),row={id:uid('CORDER'),orderNumber:'',customerName:'',mark1:'',mark2:'',mark3:'',mattresses:'',note:'',createdAt:now,updatedAt:now};
  model.state.customerOrders=Array.isArray(model.state.customerOrders)?model.state.customerOrders:[];
  model.state.customerOrders.push(row);
  if(customerUi){customerUi.customerOrderFilter='all';customerUi.customerSearch=''}
  scheduleSave('שורת מעקב הזמנה נוספה');renderCustomers();return row.id
}

function saveCustomerOrderField(id,field,el){
  if(!CUSTOMER_ORDER_FIELDS.has(field))return;
  const o=(model.state.customerOrders||[]).find(x=>x.id===id);if(!o)return;
  const value=String(el?.value??'').trim(),before=String(o[field]||'');
  if(before===value)return;
  o[field]=value;
  o.updatedAt=new Date().toISOString();scheduleSave('מעקב ההזמנה עודכן')
}

async function deleteCustomerOrder(id){
  const o=(model.state.customerOrders||[]).find(x=>x.id===id);if(!o)return;
  const label=o.customerName||o.orderNumber||'השורה הנבחרת';
  if(confirmDialog&&!await confirmDialog('מחיקת שורת מעקב',`למחוק את ${label}?`,{confirmText:'מחק שורה'}))return;
  model.state.customerOrders=model.state.customerOrders.filter(x=>x.id!==id);
  customerUi?.customerBulkSelected?.delete(id);
  scheduleSave('שורת מעקב ההזמנה נמחקה',{deleteIntents:{customerOrders:[id]}});renderCustomers()
}

function openDebtModal(id=null){
  const d=id?model.state.customerDebts.find(x=>x.id===id):null,amountValue=d?Number(d.amount??0):'';
  modal(d?'עריכת חוב לקוח':'חוב לקוח חדש',`<div class="form-grid"><div class="field"><label>שם לקוח</label><input id="dName" value="${esc(d?.customerName||'')}"></div><div class="field"><label>סכום חוב</label><input id="dAmount" class="number-input" type="number" step="1" value="${esc(Number.isFinite(amountValue)?amountValue:'')}"></div><div class="field"><label>מספר הזמנה</label><input id="dOrder" value="${esc(d?.orderNumber||'')}"></div><div class="field"><label>טלפון</label><input id="dPhone" value="${esc(d?.phone||'')}"></div><div class="field"><label>שולם</label><select id="dPaid"><option value="false" ${!d?.paid?'selected':''}>לא</option><option value="true" ${d?.paid?'selected':''}>כן</option></select></div><div class="field"><label>סופק</label><select id="dSupplied"><option value="false" ${d?.supplied!==true?'selected':''}>לא</option><option value="true" ${d?.supplied===true?'selected':''}>כן</option></select></div><div class="field"><label>חשבונית יצאה</label><select id="dInvoice"><option value="false" ${!d?.invoiceIssued?'selected':''}>לא</option><option value="true" ${d?.invoiceIssued?'selected':''}>כן</option></select></div><div class="field full"><label>הערה</label><textarea id="dNote">${esc(d?.note||'')}</textarea></div></div>`,`<button class="btn primary" data-action="save-debt" data-click-arg0="${esc(id||'')}">שמור</button>${d?`<button class="btn danger" data-action="delete-debt" data-click-arg0="${esc(d.id)}">מחק</button>`:''}<button class="btn" data-action="close-modal">ביטול</button>`)
}

function saveDebt(id=''){
  const name=$('#dName').value.trim(),rawAmount=$('#dAmount').value.trim(),amount=rawAmount===''?0:Number(rawAmount);
  if(!name)return toast('יש להזין שם לקוח');
  if(!Number.isFinite(amount))return toast('יש להזין סכום חוב תקין');
  let d=id?model.state.customerDebts.find(x=>x.id===id):null;
  const paid=$('#dPaid').value==='true',supplied=$('#dSupplied').value==='true',invoiceIssued=$('#dInvoice').value==='true',now=new Date().toISOString();
  const row={...(d||{}),id:d?.id||uid('DEBT'),customerName:name,amount,orderNumber:$('#dOrder').value.trim(),phone:$('#dPhone').value.trim(),paid,supplied,invoiceIssued,note:$('#dNote').value.trim(),updatedAt:now,paidAt:paid?(d?.paidAt||now):null,suppliedAt:supplied?(d?.suppliedAt||now):null,invoiceIssuedAt:invoiceIssued?(d?.invoiceIssuedAt||now):null,closedAt:paid&&invoiceIssued?(d?.closedAt||now):null};
  if(d)Object.assign(d,row);else model.state.customerDebts.push(row);
  closeModal();scheduleSave(d?'חוב הלקוח עודכן':'חוב הלקוח נוסף');renderCustomers()
}

async function deleteDebt(id){const d=model.state.customerDebts.find(x=>x.id===id);if(!d)return;if(!await confirmDialog('מחיקת חוב',`למחוק את החוב של ${d.customerName}?`,{confirmText:'מחק חוב'}))return;model.state.customerDebts=model.state.customerDebts.filter(x=>x.id!==id);closeModal();scheduleSave('חוב הלקוח נמחק',{deleteIntents:{customerDebts:[id]}});renderCustomers()}

return { addCustomerOrder, saveCustomerOrderField, deleteCustomerOrder, openDebtModal, saveDebt, deleteDebt };
}
