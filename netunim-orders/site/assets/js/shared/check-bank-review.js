import {esc} from './html.js';

const labels={deposited:'סומן הופקד בעקבות התאמה בבנק — נדרש אישור ההתאמה',cleared:'סומן נפרע לאחר תקופת המעקב וסנכרון בנק חדש',returned:'זוהתה החזרת הצ׳ק בבנק',missing:'הפקדת הצ׳ק חסרה או השתנתה — נדרשת בדיקה',ambiguous:'אין התאמה ודאית — יש לבדוק ולסמן ידנית',overdue:'הגיע מועד ההפקדה ולא נמצאה התאמה בבנק',unverified:'הצ׳ק סומן הופקד ידנית, אך לא נמצאה התאמה בבנק',manual:'המעקב האוטומטי נעצר בעקבות שינוי ידני'};
const warnings={possible_return:'נמצאה החזרת צ׳ק בסכום מתאים; לא ניתן לקבוע בוודאות למי היא שייכת. הפירעון האוטומטי הושהה.',calendar:'אין לוח מסלקה מאומת לתקופה זו. הפירעון האוטומטי הושהה.',changed:'פרטי התנועה השתנו לאחר ההתאמה.',batch_missing:'הצ׳ק הזה חסר מההפקדה המקורית לפי פרטי השיקים או לפי התאמה יחידה של הסכומים.',batch_ambiguous:'השינוי בהפקדה מתאים לכמה אפשרויות. אין זיהוי ודאי של הצ׳קים החסרים.',invalid_items:'פרטי השיקים שהתקבלו מהבנק אינם שלמים או אינם תואמים לסכום ההפקדה. נדרשת בדיקה.',number_amount_conflict:'מספר הצ׳ק נמצא, אך הסכום או פרטי החשבון אינם תואמים לרישום. נדרשת בדיקה.',redeposit_unverified:'זוהתה הפקדה חוזרת, אך אין מספיק פרטים לקשר אותה בוודאות למחזור ההפקדה הקודם.',identity_conflict:'התנועה מקושרת לכמה רישומים סותרים. המעקב הושהה עד לבירור.',details_unavailable:'תנועת ההפקדה קיימת, אך פרטי השיקים שהופיעו בה אינם זמינים כעת. הפירעון האוטומטי הושהה.'};

function remainderMarkup(m){
  const r=m.remainder;if(!r)return '';
  const missing=Array.isArray(r.missingMembers)?r.missingMembers:[];
  return `<p>ההפקדה המקורית: ${esc(r.originalAmount)} ₪ · נותר מההפקדה: ${esc(r.observedAmount)} ₪${r.missingAmount!==undefined?` · חסר: ${esc(r.missingAmount)} ₪`:''}</p>${missing.length?`<p><b>הצ׳קים החסרים מההפקדה:</b> ${missing.map(c=>`${esc(c.name||c.id)}${c.checkNumber?` (צ׳ק ${esc(c.checkNumber)})`:''} — ${esc(c.amount)} ₪`).join(' · ')}</p><p>${r.evidence==='bank_items'?'הזיהוי מבוסס על פרטי השיקים שהופיעו בהפקדה המקורית.':'הזיהוי מבוסס על יתרת ההפקדה והקבוצה המקורית.'} אין בכך לבדו אישור שהצ׳ק חזר.</p>`:''}`;
}

function evidenceMarkup(m){
  if(!m.transactionId)return `<p>מועד ההפקדה: ${esc(m.date)} · נבדק בסנכרון מלא מ־${esc(m.observedDate)}</p><p>לא נמצאה התאמה ודאית בתנועות שנבדקו. יש לבדוק את פרטי הרישום ואת ההפקדה.</p>`;
  const b=m.bankItem;
  return `<p>${esc(m.description)} · ${esc(m.amount)} ₪ · ${esc(m.date)}${m.checkIds?.length>1?` · קבוצה של ${esc(m.checkIds.length)} צ׳קים`:''}</p>${b?`<p>פרטי השיק בבנק: ${esc(b.checkNumber||'ללא מספר')} · ${esc(b.amount)} ₪${b.bankNumber?` · בנק ${esc(b.bankNumber)}`:''}${b.branchNumber?` · סניף ${esc(b.branchNumber)}`:''}${b.accountNumber?` · חשבון ${esc(b.accountNumber)}`:''}</p>`:''}${m.matchMethod?`<p>${m.matchMethod==='number'?'התאמה לפי מספר השיק והסכום':'התאמה חלופית לפי סכום ומועד; מספר השיק לא אומת מול הרישום'}</p>`:''}${m.provisional?'<p><b>זיהוי ראשוני — התנועה עדיין ממתינה.</b> אסמכתת הפקדה אינה בהכרח מספר שיק. תנועה ממתינה אינה מאשרת פירעון.</p>':''}`;
}

function incidentLabel(m){
  if(m?.phase==='missing'&&!m.warning)return 'תנועת ההפקדה נעלמה מתנועות הבנק — הצ׳ק נשמר ונדרשת בדיקה';
  return labels[m?.phase]||'התאמת צ׳ק בבנק';
}

export function checkBankReviewItems(checks){
  return (Array.isArray(checks)?checks:[]).filter(c=>c.bankMatch?.eventId&&c.bankMatch.phase!=='manual'&&c.bankReview!==c.bankMatch.eventId).map(c=>({
    id:`check_bank:${c.id}:${c.bankMatch.eventId}`,kind:'check_bank',checkId:c.id,account:c.account||'עסקי',name:c.name,amount:c.amount,checkNumber:c.checkNumber,
    match:c.bankMatch,title:incidentLabel(c.bankMatch),
  }));
}

export function checkBankReviewCard(item){
  const m=item.match,canConfirm=m.phase==='deposited'&&!m.warning;
  return `<div class="check-bank-review notice" role="status"><b>${esc(item.title)}</b><p>${esc(item.name)} · חשבון ${esc(item.account)} · ${esc(item.amount)} ₪${item.checkNumber?` · צ׳ק ${esc(item.checkNumber)}`:''}</p>${evidenceMarkup(m)}${remainderMarkup(m)}${m.warning?`<p>${esc(warnings[m.warning]||'נדרשת בדיקת תנועת הבנק')}</p>`:''}${m.reason?`<p>${esc(m.reason)}</p>`:''}${canConfirm?'<p>מעבר לנפרע דורש אישור ההתאמה לתנועה הסופית וסנכרון בנק מלא חדש לאחר 3 ימי עסקים בנקאיים נוספים, לפי לוח המסלקה. הספירה מתחילה לא לפני זיהוי התנועה הסופית. זהו חישוב מהנתונים, ולא אישור פירעון של הבנק.</p>':''}<div class="row-actions"><button type="button" class="btn" data-action="review-check-bank" data-click-arg0="${esc(item.checkId)}" data-click-arg1="${esc(m.eventId)}" data-click-arg2="accept">${canConfirm?'מאשר את ההתאמה':'ראיתי · הסר התראה'}</button>${canConfirm?`<button type="button" class="btn" data-action="review-check-bank" data-click-arg0="${esc(item.checkId)}" data-click-arg1="${esc(m.eventId)}" data-click-arg2="reject">ההתאמה שגויה · בטל</button>`:''}<button type="button" class="btn" data-action="open-check-modal-2" data-click-arg0="${esc(item.checkId)}">בדיקה / עריכה</button></div></div>`;
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
  const label=check.bankAutomationDisabled?labels.manual:m?.phase==='deposited'&&m.provisional?'זיהוי ראשוני · תנועת בנק ממתינה':m?.phase==='deposited'&&check.bankReview===m.eventId?'זוהתה הפקדה בבנק · ההתאמה אושרה':incidentLabel(m);
  return m?`<small class="check-bank-status">${esc(label||'התאמה לבנק')}${m.clearAfter&&!check.bankAutomationDisabled?` · בדיקת פירעון מ־${esc(m.clearAfter)}`:''}</small>`:'';
}
