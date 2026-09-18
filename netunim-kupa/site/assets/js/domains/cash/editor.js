import {esc,uid} from '../../core/values.js';
import {todayISO} from '../../core/dates.js';
import {wholeMoney,decimalMoney} from '../../core/money.js';
import {applyLedgerTypeSign,ledgerEditorAmount,ledgerTypeOptions} from './model.js';

function amountGuide(labels){
  return `<div class="soft-note"><b>איך מזינים סכום?</b><br>מקלידים סכום רגיל, למשל 500 — אין צורך להוסיף מינוס.<br><b>${esc(labels.positiveLabel)}</b> נשמרת כ־+500 · <b>${esc(labels.negativeLabel)}</b> נשמרת כ־−500.<br>ביתרת פתיחה / ספירה ובהתאמה הסכום נשמר כפי שהוזן.</div>`;
}

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsCashEditor({model, armModalDraftGuard, modal, deleteRecord, saveState, toast, closeModal, dateEditorMarkup, renderCash}){
function ledgerModal(collection,id,labels){
  const r=id?model.state[collection].find(x=>x.id===id):{date:todayISO(),type:'הכנסה',description:'',amount:'',note:''};
  const supportsCents=labels.supportsCents===true,types=ledgerTypeOptions(collection),amountValue=ledgerEditorAmount(r.type,r.amount);
  modal(id?labels.editTitle:labels.newTitle,`<div class="form-grid"><div class="form-group"><label>תאריך</label>${dateEditorMarkup('mDate',r.date||todayISO(),{label:'תאריך'})}</div><div class="form-group"><label>סוג פעולה</label><select id="mType">${types.map(option=>`<option value="${esc(option.value)}" ${r.type===option.value?'selected':''}>${esc(option.label)}</option>`).join('')}</select></div><div class="form-group full"><label>תיאור</label><input id="mDesc" value="${esc(r.description)}"></div><div class="form-group"><label>סכום</label><input id="mAmount" type="number" step="1" inputmode="${supportsCents?'decimal':'numeric'}" value="${esc(amountValue)}"></div><div class="form-group full"><label>הערה</label><textarea id="mNote">${esc(r.note)}</textarea></div><div class="form-group full">${amountGuide(labels)}</div></div>`,id?'שמור':'הוסף תנועה',()=>saveLedger(collection,id||'',labels),id?()=>deleteRecord(collection,id):null);
  armModalDraftGuard()
}
function saveLedger(collection,id,labels){
  const amountParser=labels.supportsCents===true?decimalMoney:wholeMoney,type=document.getElementById('mType').value,parsedAmount=amountParser(document.getElementById('mAmount').value);
  const rec={id:id||uid(labels.idPrefix),date:document.getElementById('mDate').value,type,description:document.getElementById('mDesc').value.trim(),amount:applyLedgerTypeSign(type,parsedAmount),note:document.getElementById('mNote').value.trim()};
  if(!rec.date||!rec.amount)return toast('יש למלא תאריך וסכום');
  if(id)model.state[collection][model.state[collection].findIndex(x=>x.id===id)]=rec;else model.state[collection].push(rec);
  closeModal(true);saveState(labels.savedMessage);renderCash()
}
const CASH_LABELS={editTitle:'עריכת תנועת מזומן',newTitle:'תנועת מזומן חדשה',idPrefix:'CASH',savedMessage:'תנועת המזומן נשמרה',positiveLabel:'הכנסה',negativeLabel:'הוצאה'};
const RIGHTS_LABELS={editTitle:'עריכת תנועת מעשר',newTitle:'תנועת מעשר חדשה',idPrefix:'RIGHT',savedMessage:'תנועת המעשר נשמרה',supportsCents:true,positiveLabel:'זכות למעשר',negativeLabel:'חובה למעשר'};
function openCashModal(id){ledgerModal('cash',id,CASH_LABELS)}
function saveCash(id){saveLedger('cash',id,CASH_LABELS)}
function openRightModal(id){ledgerModal('rights',id,RIGHTS_LABELS)}
function saveRight(id){saveLedger('rights',id,RIGHTS_LABELS)}

return { openCashModal, saveCash, openRightModal, saveRight };
}
