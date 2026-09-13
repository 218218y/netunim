import {esc} from './html.js';

const labels={deposited:'סומן הופקד בעקבות התאמה בבנק — נדרש אישור ההתאמה',cleared:'סומן נפרע לאחר תקופת המעקב וסנכרון בנק חדש',returned:'זוהתה החזרת הצ׳ק בבנק',missing:'הפקדת הצ׳ק חסרה או השתנתה — נדרשת בדיקה',ambiguous:'נמצאו כמה התאמות אפשריות — יש לבדוק ולסמן ידנית',manual:'המעקב האוטומטי נעצר בעקבות שינוי ידני'};
const warnings={possible_return:'נמצאה החזרת צ׳ק בסכום מתאים; לא ניתן לקבוע בוודאות למי היא שייכת. הפירעון האוטומטי הושהה.',calendar:'אין לוח מסלקה מאומת לתקופה זו. הפירעון האוטומטי הושהה.',changed:'פרטי התנועה השתנו לאחר ההתאמה.',batch_missing:'סכום ההפקדה קטן. הצ׳ק הזה חסר לפי התאמה יחידה של היתרה לצ׳קים בקבוצה המקורית.',batch_ambiguous:'סכום ההפקדה קטן, אך כמה צירופים מסבירים את ההפרש. אין זיהוי ודאי של הצ׳קים החסרים.'};

function remainderMarkup(m){
  const r=m.remainder;if(!r)return '';
  const missing=Array.isArray(r.missingMembers)?r.missingMembers:[];
  return `<p>ההפקדה המקורית: ${esc(r.originalAmount)} ₪ · נותר בחשבון: ${esc(r.observedAmount)} ₪${r.missingAmount!==undefined?` · חסר: ${esc(r.missingAmount)} ₪`:''}</p>${missing.length?`<p><b>הצ׳קים החסרים לפי ההפרש:</b> ${missing.map(c=>`${esc(c.name||c.id)}${c.checkNumber?` (צ׳ק ${esc(c.checkNumber)})`:''} — ${esc(c.amount)} ₪`).join(' · ')}</p><p>הזיהוי מבוסס על יתרת ההפקדה והקבוצה המקורית; אין בכך לבדו אישור שהצ׳ק חזר.</p>`:''}`;
}

export function checkBankReviewItems(checks){
  return (Array.isArray(checks)?checks:[]).filter(c=>c.bankMatch?.eventId&&c.bankMatch.phase!=='manual'&&c.bankReview!==c.bankMatch.eventId).map(c=>({
    id:`check_bank:${c.id}:${c.bankMatch.eventId}`,kind:'check_bank',checkId:c.id,account:c.account||'עסקי',name:c.name,amount:c.amount,checkNumber:c.checkNumber,
    match:c.bankMatch,title:labels[c.bankMatch.phase]||'התאמת צ׳ק בבנק',
  }));
}

export function checkBankReviewCard(item){
  const m=item.match,canConfirm=m.phase==='deposited'&&!m.warning;
  return `<div class="check-bank-review notice" role="status"><b>${esc(item.title)}</b><p>${esc(item.name)} · חשבון ${esc(item.account)} · ${esc(item.amount)} ₪${item.checkNumber?` · צ׳ק ${esc(item.checkNumber)}`:''}</p><p>${esc(m.description)} · ${esc(m.amount)} ₪ · ${esc(m.date)}${m.checkIds?.length>1?` · קבוצה של ${esc(m.checkIds.length)} צ׳קים`:''}</p>${remainderMarkup(m)}${m.warning?`<p>${esc(warnings[m.warning]||'נדרשת בדיקת תנועת הבנק')}</p>`:''}${m.reason?`<p>${esc(m.reason)}</p>`:''}${canConfirm?'<p>לאחר האישור: מעבר לנפרע רק בסנכרון בנק מלא, אחרי לפחות 6 ימים ו־3 ימי עסקים מלאים. זוהי הסקה מתנועות החשבון.</p>':''}<div class="row-actions"><button type="button" class="btn" data-action="review-check-bank" data-click-arg0="${esc(item.checkId)}" data-click-arg1="${esc(m.eventId)}" data-click-arg2="accept">${canConfirm?'מאשר את ההתאמה':'ראיתי · הסר התראה'}</button>${canConfirm?`<button type="button" class="btn" data-action="review-check-bank" data-click-arg0="${esc(item.checkId)}" data-click-arg1="${esc(m.eventId)}" data-click-arg2="reject">ההתאמה שגויה · בטל</button>`:''}<button type="button" class="btn" data-action="open-check-modal-2" data-click-arg0="${esc(item.checkId)}">בדיקה / עריכה</button></div></div>`;
}

export function checkBankReviewMarkup(checks,account){return checkBankReviewItems(checks).filter(x=>!account||x.account===account).map(checkBankReviewCard).join('')}

export function applyCheckBankReview(checks,id,eventId,action){
  const check=checks.find(x=>x.id===id),m=check?.bankMatch;
  if(!m||m.eventId!==eventId||check.bankReview===eventId||!['accept','reject'].includes(action))return false;
  if(action==='reject'){
    if(m.phase!=='deposited'||m.warning)return false;
    check.status=m.previousStatus||'בקופה';check.depositDate=m.previousDepositDate||null;check.clearedDate=null;
    check.bankAutomationDisabled=true;
    check.bankMatch={...m,phase:'manual'};
  }
  check.bankReview=eventId;
  return true;
}

export function checkBankStatusMarkup(check){
  const m=check.bankMatch;
  const label=check.bankAutomationDisabled?labels.manual:m?.phase==='deposited'&&check.bankReview===m.eventId?'זוהתה הפקדה בבנק · ההתאמה אושרה':labels[m?.phase];
  return m?`<small class="check-bank-status">${esc(label||'התאמה לבנק')}${m.clearAfter&&!check.bankAutomationDisabled?` · בדיקת פירעון מ־${esc(m.clearAfter)}`:''}</small>`:'';
}
