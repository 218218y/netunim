import {esc, uid} from '../../core/values.js';
import {todayISO} from '../../core/dates.js';
import {wholeMoney} from '../../core/money.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsCashEditor({model, armModalDraftGuard, modal, deleteRecord, saveState, toast, closeModal}){
function openCashModal(id){const r=id?model.state.cash.find(x=>x.id===id):{date:todayISO(),type:'הכנסה',description:'',amount:'',note:''};modal(id?'עריכת תנועת מזומן':'תנועת מזומן חדשה',`<div class="form-grid"><div class="form-group"><label>תאריך</label><input id="mDate" type="date" value="${esc(r.date||todayISO())}"></div><div class="form-group"><label>סוג</label><select id="mType">${['יתרת פתיחה / ספירה','הכנסה','הוצאה','התאמה'].map(s=>`<option ${r.type===s?'selected':''}>${esc(s)}</option>`).join('')}</select></div><div class="form-group full"><label>תיאור</label><input id="mDesc" value="${esc(r.description)}"></div><div class="form-group"><label>סכום</label><input id="mAmount" type="number" step="1" inputmode="numeric" value="${esc(r.amount||'')}"></div><div class="form-group full"><label>הערה</label><textarea id="mNote">${esc(r.note)}</textarea></div><div class="form-group full"><div class="notice warn">להוצאה יש להזין סכום שלילי, לדוגמה ‎-1,200.</div></div></div>`,id?'שמור':'הוסף תנועה',()=>saveCash(id||''),id?()=>deleteRecord('cash',id):null);armModalDraftGuard()}

function saveCash(id){const rec={id:id||uid('CASH'),date:document.getElementById('mDate').value,type:document.getElementById('mType').value,description:document.getElementById('mDesc').value.trim(),amount:wholeMoney(document.getElementById('mAmount').value),note:document.getElementById('mNote').value.trim()};if(!rec.date||!rec.amount)return toast('יש למלא תאריך וסכום');if(id)model.state.cash[model.state.cash.findIndex(x=>x.id===id)]=rec;else model.state.cash.push(rec);closeModal(true);saveState('תנועת המזומן נשמרה')}

return { openCashModal, saveCash };
}
