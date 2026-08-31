import {esc, uid} from '../../core/values.js';
import {todayISO} from '../../core/dates.js';
import {wholeMoney} from '../../core/money.js';
import {CREDIT_PROVIDER_LABELS,creditCardMappingKey,normalizeCreditSync} from './sync-feed.js';

function uniqueSorted(values){return [...new Set(values.map(v=>String(v||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'he'))}

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsCreditEditor({model, armModalDraftGuard, modal, nextChargeDate, deleteRecord, saveState, toast, closeModal}){
function suggestions(){
  const sync=normalizeCreditSync(model.state.creditSync),cards=(model.state.cards||[]).filter(x=>x.active).map(x=>x.name),owners=sync.profiles.map(p=>p.ownerLabel);
  for(const profile of sync.profiles)for(const account of profile.accounts){
    const mapping=sync.cardMappings[creditCardMappingKey(profile.profileId,account.accountNumber)]||{};
    if(mapping.hidden===true)continue;
    cards.push(mapping.cardName||`${CREDIT_PROVIDER_LABELS[profile.provider]||profile.label} ••${String(account.accountNumber||'').slice(-4)}`);
  }
  for(const cr of model.state.credits||[])if(cr.ownerLabel)owners.push(cr.ownerLabel);
  return {cards:uniqueSorted(cards),owners:uniqueSorted(owners)};
}
function openCreditModal(id){
  const opts=suggestions(),cr=id?model.state.credits.find(x=>x.id===id):{account:'עסקי',ownerLabel:'',card:opts.cards[0]||'',description:'',transactionDate:todayISO(),totalAmount:'',installments:1,firstChargeDate:'',active:true,note:''};
  const defaultFirst=cr.firstChargeDate||nextChargeDate(cr.card,cr.transactionDate);
  modal(id?'עריכת תוספת אשראי ידנית':'תוספת אשראי ידנית',`<div class="form-grid">
    <div class="form-group"><label>חשבון</label><select id="cAccount"><option ${cr.account==='עסקי'?'selected':''}>עסקי</option><option ${cr.account==='ביתי'?'selected':''}>ביתי</option></select></div>
    <div class="form-group"><label>בעל הכרטיס</label><input id="cOwner" list="creditOwnerSuggestions" value="${esc(cr.ownerLabel||'')}" placeholder="רשות"><datalist id="creditOwnerSuggestions">${opts.owners.map(x=>`<option value="${esc(x)}"></option>`).join('')}</datalist></div>
    <div class="form-group"><label>כרטיס</label><input id="cCard" list="creditCardSuggestions" data-change="prefill-charge-date" value="${esc(cr.card||'')}" placeholder="שם הכרטיס"><datalist id="creditCardSuggestions">${opts.cards.map(x=>`<option value="${esc(x)}"></option>`).join('')}</datalist></div>
    <div class="form-group full"><label>תיאור</label><input id="cDesc" value="${esc(cr.description)}" placeholder="למשל: חיוב שלא התקבל מהחברה"></div>
    <div class="form-group"><label>תאריך עסקה</label><input id="cTx" type="date" value="${esc(cr.transactionDate||todayISO())}" data-change="prefill-charge-date"></div>
    <div class="form-group"><label>תאריך חיוב ראשון</label><input id="cFirst" type="date" value="${esc(defaultFirst)}"></div>
    <div class="form-group"><label>סכום כולל</label><input id="cTotal" type="number" step="1" inputmode="numeric" min="0" value="${esc(cr.totalAmount||'')}"></div>
    <div class="form-group"><label>מספר תשלומים</label><input id="cParts" type="number" min="1" max="60" step="1" inputmode="numeric" value="${esc(cr.installments||1)}"></div>
    <div class="form-group"><label>פעיל</label><select id="cActive"><option ${cr.active?'selected':''}>כן</option><option ${!cr.active?'selected':''}>לא</option></select></div>
    <div class="form-group full"><label>הערה</label><textarea id="cNote">${esc(cr.note)}</textarea></div>
    <div class="form-group full"><div class="notice">הנתונים מחברות האשראי הם תמיד בסיס החישוב. הרשומה הזאת היא תוספת ידנית נקודתית בלבד ותתווסף לסנכרון — היא לא מחליפה אותו.</div></div>
  </div>`,id?'שמור שינויים':'הוסף תוספת',()=>saveCredit(id||''),id?()=>deleteRecord('credits',id):null);armModalDraftGuard()
}

function prefillChargeDate(){const tx=document.getElementById('cTx').value,card=document.getElementById('cCard').value;document.getElementById('cFirst').value=nextChargeDate(card,tx)}

function saveCredit(id){const rec={id:id||uid('CR'),account:document.getElementById('cAccount').value,ownerLabel:document.getElementById('cOwner').value.trim(),card:document.getElementById('cCard').value.trim(),description:document.getElementById('cDesc').value.trim(),transactionDate:document.getElementById('cTx').value,totalAmount:wholeMoney(document.getElementById('cTotal').value),installments:Number(document.getElementById('cParts').value),firstChargeDate:document.getElementById('cFirst').value,active:document.getElementById('cActive').value==='כן',note:document.getElementById('cNote').value.trim(),createdAt:id?model.state.credits.find(x=>x.id===id)?.createdAt:todayISO()};if(!rec.card||!rec.totalAmount||!rec.installments||!rec.firstChargeDate)return toast('יש למלא כרטיס, סכום, תשלומים וחיוב ראשון');if(id)model.state.credits[model.state.credits.findIndex(x=>x.id===id)]=rec;else model.state.credits.push(rec);closeModal(true);saveState(id?'התוספת הידנית עודכנה':'התוספת הידנית נוספה')}

return { openCreditModal, prefillChargeDate, saveCredit };
}
