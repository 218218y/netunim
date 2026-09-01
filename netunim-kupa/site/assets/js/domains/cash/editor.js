import {esc,uid} from '../../core/values.js';
import {todayISO} from '../../core/dates.js';
import {wholeMoney} from '../../core/money.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsCashEditor({model, armModalDraftGuard, modal, deleteRecord, saveState, toast, closeModal}){
function ledgerModal(collection,id,labels){
  const r=id?model.state[collection].find(x=>x.id===id):{date:todayISO(),type:'הכנסה',description:'',amount:'',note:''};
  modal(id?labels.editTitle:labels.newTitle,`<div class="form-grid"><div class="form-group"><label>תאריך</label><input id="mDate" type="date" value="${esc(r.date||todayISO())}"></div><div class="form-group"><label>סוג</label><select id="mType">${['יתרת פתיחה / ספירה','הכנסה','הוצאה','התאמה'].map(s=>`<option ${r.type===s?'selected':''}>${esc(s)}</option>`).join('')}</select></div><div class="form-group full"><label>תיאור</label><input id="mDesc" value="${esc(r.description)}"></div><div class="form-group"><label>סכום</label><input id="mAmount" type="number" step="1" inputmode="numeric" value="${esc(r.amount||'')}"></div><div class="form-group full"><label>הערה</label><textarea id="mNote">${esc(r.note)}</textarea></div><div class="form-group full"><div class="notice warn">להוצאה יש להזין סכום שלילי, לדוגמה ‎-1,200.</div></div></div>`,id?'שמור':'הוסף תנועה',()=>saveLedger(collection,id||'',labels),id?()=>deleteRecord(collection,id):null);
  armModalDraftGuard()
}
function saveLedger(collection,id,labels){
  const rec={id:id||uid(labels.idPrefix),date:document.getElementById('mDate').value,type:document.getElementById('mType').value,description:document.getElementById('mDesc').value.trim(),amount:wholeMoney(document.getElementById('mAmount').value),note:document.getElementById('mNote').value.trim()};
  if(!rec.date||!rec.amount)return toast('יש למלא תאריך וסכום');
  if(id)model.state[collection][model.state[collection].findIndex(x=>x.id===id)]=rec;else model.state[collection].push(rec);
  closeModal(true);saveState(labels.savedMessage)
}
const CASH_LABELS={editTitle:'עריכת תנועת מזומן',newTitle:'תנועת מזומן חדשה',idPrefix:'CASH',savedMessage:'תנועת המזומן נשמרה'};
const RIGHTS_LABELS={editTitle:'עריכת תנועת זכות',newTitle:'תנועת זכות חדשה',idPrefix:'RIGHT',savedMessage:'תנועת הזכות נשמרה'};
function openCashModal(id){ledgerModal('cash',id,CASH_LABELS)}
function saveCash(id){saveLedger('cash',id,CASH_LABELS)}
function openRightModal(id){ledgerModal('rights',id,RIGHTS_LABELS)}
function saveRight(id){saveLedger('rights',id,RIGHTS_LABELS)}

return { openCashModal, saveCash, openRightModal, saveRight };
}
