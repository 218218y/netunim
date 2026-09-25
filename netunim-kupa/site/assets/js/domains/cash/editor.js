import {esc,uid} from '../../core/values.js';
import {todayISO} from '../../core/dates.js';
import {wholeMoney,decimalMoney} from '../../core/money.js';
import {applyLedgerTypeSign,ledgerEditorAmount,ledgerTypeLabel,ledgerTypeOptions,ledgerTypePolarity} from './model.js';

function amountCue(collection,type){
  const operationLabel=ledgerTypeLabel(collection,type)||String(type||''),polarity=ledgerTypePolarity(type);
  if(polarity>0)return {tone:'positive',label:'סכום · יישמר כפלוס (+)',guide:`<b>${esc(operationLabel)}</b>: מקלידים סכום רגיל, והוא נשמר אוטומטית כחיובי (+). לדוגמה 500 → +500.`};
  if(polarity<0)return {tone:'negative',label:'סכום · יישמר כמינוס (−)',guide:`<b>${esc(operationLabel)}</b>: מקלידים סכום רגיל, והוא נשמר אוטומטית כשלילי (−). לדוגמה 500 → −500 — אין צורך להקליד מינוס.`};
  return {tone:'neutral',label:'סכום · נשמר כפי שהוזן',guide:`<b>${esc(operationLabel)}</b>: בסוג פעולה זה אין שינוי אוטומטי של הסימן; הסכום נשמר כפי שהוזן.`};
}

function syncAmountCue(collection){
  if(typeof document==='undefined')return;
  const type=document.getElementById('mType')?.value||'',cue=amountCue(collection,type),field=document.getElementById('ledgerAmountField'),label=document.getElementById('ledgerAmountLabel'),guide=document.getElementById('ledgerAmountGuide');
  if(field?.classList){field.classList.remove('is-positive','is-negative','is-neutral');field.classList.add(`is-${cue.tone}`)}
  if(label)label.textContent=cue.label;
  if(guide){guide.className=`soft-note ledger-amount-guide is-${cue.tone}`;guide.innerHTML=cue.guide}
}

function bindAmountCue(collection){
  if(typeof document==='undefined')return;
  const type=document.getElementById('mType');
  if(typeof type?.addEventListener==='function')type.addEventListener('change',()=>syncAmountCue(collection));
  syncAmountCue(collection);
}

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsCashEditor({model, armModalDraftGuard, modal, deleteRecord, saveState, toast, closeModal, dateEditorMarkup, renderCash}){
function ledgerModal(collection,id,labels){
  const r=id?model.state[collection].find(x=>x.id===id):{date:todayISO(),type:'הכנסה',description:'',amount:'',note:''};
  const supportsCents=labels.supportsCents===true,types=ledgerTypeOptions(collection),amountValue=ledgerEditorAmount(r.type,r.amount),cue=amountCue(collection,r.type);
  modal(id?labels.editTitle:labels.newTitle,`<div class="form-grid"><div class="form-group"><label>תאריך</label>${dateEditorMarkup('mDate',r.date||todayISO(),{label:'תאריך'})}</div><div class="form-group"><label>סוג פעולה</label><select id="mType">${types.map(option=>`<option value="${esc(option.value)}" ${r.type===option.value?'selected':''}>${esc(option.label)}</option>`).join('')}</select></div><div class="form-group"><label>תיאור</label><input id="mDesc" value="${esc(r.description)}"></div><div id="ledgerAmountField" class="form-group ledger-amount-field is-${cue.tone}"><label id="ledgerAmountLabel" for="mAmount">${esc(cue.label)}</label><input id="mAmount" type="number" step="1" inputmode="${supportsCents?'decimal':'numeric'}" value="${esc(amountValue)}" aria-describedby="ledgerAmountGuide"></div><div class="form-group full"><div id="ledgerAmountGuide" class="soft-note ledger-amount-guide is-${cue.tone}">${cue.guide}</div></div></div>`,id?'שמור':'הוסף תנועה',()=>saveLedger(collection,id||'',labels),id?()=>deleteRecord(collection,id):null);
  bindAmountCue(collection);armModalDraftGuard()
}
function saveLedger(collection,id,labels){
  const amountParser=labels.supportsCents===true?decimalMoney:wholeMoney,type=document.getElementById('mType').value,parsedAmount=amountParser(document.getElementById('mAmount').value),existing=id?model.state[collection].find(x=>x.id===id):null;
  const rec={id:id||uid(labels.idPrefix),date:document.getElementById('mDate').value,type,description:document.getElementById('mDesc').value.trim(),amount:applyLedgerTypeSign(type,parsedAmount),note:String(existing?.note||'')};
  if(!rec.date||!rec.amount)return toast('יש למלא תאריך וסכום');
  if(id)model.state[collection][model.state[collection].findIndex(x=>x.id===id)]=rec;else model.state[collection].push(rec);
  closeModal(true);saveState(labels.savedMessage,{domains:[collection],operations:[{type:'put',collection,id:rec.id,mode:id?'replace':'insert',index:model.state[collection].findIndex(row=>row.id===rec.id),record:rec}]});renderCash()
}
const CASH_LABELS={editTitle:'עריכת תנועת מזומן',newTitle:'תנועת מזומן חדשה',idPrefix:'CASH',savedMessage:'תנועת המזומן נשמרה'};
const RIGHTS_LABELS={editTitle:'עריכת תנועת מעשר',newTitle:'תנועת מעשר חדשה',idPrefix:'RIGHT',savedMessage:'תנועת המעשר נשמרה',supportsCents:true};
function openCashModal(id){ledgerModal('cash',id,CASH_LABELS)}
function saveCash(id){saveLedger('cash',id,CASH_LABELS)}
function openRightModal(id){ledgerModal('rights',id,RIGHTS_LABELS)}
function saveRight(id){saveLedger('rights',id,RIGHTS_LABELS)}

return { openCashModal, saveCash, openRightModal, saveRight };
}
