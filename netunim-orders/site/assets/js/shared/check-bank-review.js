import {esc} from './html.js';

const labels={deposited:'סומן הופקד בעקבות התאמה בבנק — נדרש אישור ההתאמה',cleared:'סומן נפרע לאחר תקופת המעקב וסנכרון בנק חדש',returned:'זוהתה החזרת הצ׳ק בבנק',missing:'הפקדת הצ׳ק חסרה או השתנתה — נדרשת בדיקה',ambiguous:'אין התאמה ודאית — יש לבדוק ולסמן ידנית',overdue:'הגיע מועד ההפקדה ולא נמצאה התאמה בבנק',unverified:'הצ׳ק סומן הופקד ידנית, אך לא נמצאה התאמה בבנק',manual:'המעקב האוטומטי נעצר בעקבות שינוי ידני'};
const warnings={number_ambiguous:'פרטי השיק מתאימים לכמה רישומים או תנועות. הפירעון האוטומטי הושהה עד לבירור.',possible_return:'נמצאה החזרת צ׳ק בסכום מתאים; לא ניתן לקבוע בוודאות למי היא שייכת. הפירעון האוטומטי הושהה.',calendar:'אין לוח מסלקה מאומת לתקופה זו. הפירעון האוטומטי הושהה.',changed:'פרטי התנועה השתנו לאחר ההתאמה.',batch_missing:'הצ׳ק הזה חסר מההפקדה המקורית לפי פרטי השיקים או לפי התאמה יחידה של הסכומים.',batch_ambiguous:'השינוי בהפקדה מתאים לכמה אפשרויות. אין זיהוי ודאי של הצ׳קים החסרים.',invalid_items:'פרטי השיקים שהתקבלו מהבנק אינם שלמים או אינם תואמים לסכום ההפקדה. נדרשת בדיקה.',number_amount_conflict:'מספר הצ׳ק נמצא, אך הסכום או פרטי החשבון אינם תואמים לרישום. נדרשת בדיקה.',redeposit_unverified:'זוהתה הפקדה חוזרת, אך אין מספיק פרטים לקשר אותה בוודאות למחזור ההפקדה הקודם.',identity_conflict:'התנועה מקושרת לכמה רישומים סותרים. המעקב הושהה עד לבירור.',details_unavailable:'תנועת ההפקדה קיימת, אך פרטי השיקים שהופיעו בה אינם זמינים כעת. הפירעון האוטומטי הושהה.'};

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
  if(m?.phase==='deposited'&&m.autoConfirmed&&!m.warning)return m.provisional?'זוהתה הפקדה ממתינה לפי מספר השיק והסכום':'ההפקדה אושרה אוטומטית לפי מספר השיק והסכום';
  return labels[m?.phase]||'התאמת צ׳ק בבנק';
}

function quietBankEvent(m){return !m?.warning&&(m?.phase==='cleared'||m?.phase==='deposited'&&m.autoConfirmed===true)}

export function checkBankReviewItems(checks){
  return (Array.isArray(checks)?checks:[]).filter(c=>c.bankMatch?.eventId&&c.bankMatch.phase!=='manual'&&!quietBankEvent(c.bankMatch)&&c.bankReview!==c.bankMatch.eventId).map(c=>({
    id:`check_bank:${c.id}:${c.bankMatch.eventId}`,kind:'check_bank',checkId:c.id,account:c.account||'עסקי',name:c.name,amount:c.amount,checkNumber:c.checkNumber,
    match:c.bankMatch,title:incidentLabel(c.bankMatch),
  }));
}

export function checkBankReviewCard(item,{activity=false,current=true}={}){
  const m=item.match,canReject=current&&m.phase==='deposited'&&!m.warning,canConfirm=canReject&&!m.autoConfirmed;
  const reviewButton=current&&!quietBankEvent(m)?`<button type="button" class="btn" data-action="review-check-bank" data-click-arg0="${esc(item.checkId)}" data-click-arg1="${esc(m.eventId)}" data-click-arg2="accept">${canConfirm?'מאשר את ההתאמה':'ראיתי · הסר התראה'}</button>`:'';
  const clearingText=m.phase==='deposited'&&!m.warning?`<p>${m.autoConfirmed?'ההתאמה אושרה אוטומטית.':'נדרש אישור ידני להתאמה זו.'} מעבר לנפרע יתבצע בסנכרון בנק מלא חדש לאחר 3 ימי עסקים בנקאיים נוספים, לפי לוח המסלקה. הספירה מתחילה לא לפני זיהוי התנועה הסופית.</p>`:'';
  return `<div class="check-bank-review${activity?'':' notice'}"${activity?'':' role="status"'}><b>${esc(item.title)}</b><p>${esc(item.name)} · חשבון ${esc(item.account)} · ${esc(item.amount)} ₪${item.checkNumber?` · צ׳ק ${esc(item.checkNumber)}`:''}</p>${evidenceMarkup(m)}${remainderMarkup(m)}${m.warning?`<p>${esc(warnings[m.warning]||'נדרשת בדיקת תנועת הבנק')}</p>`:''}${m.reason?`<p>${esc(m.reason)}</p>`:''}${clearingText}<div class="row-actions">${reviewButton}${canReject?`<button type="button" class="btn" data-action="review-check-bank" data-click-arg0="${esc(item.checkId)}" data-click-arg1="${esc(m.eventId)}" data-click-arg2="reject">ההתאמה שגויה · בטל</button>`:''}<button type="button" class="btn" data-action="open-check-modal-2" data-click-arg0="${esc(item.checkId)}">בדיקה / עריכה</button></div></div>`;
}

export function checkBankReviewMarkup(checks,account){return checkBankReviewItems(checks).filter(x=>!account||x.account===account).map(item=>checkBankReviewCard(item)).join('')}

export function checkBankActivityMarkup(checks,account,page=0){
  const items=[];
  for(const c of Array.isArray(checks)?checks:[]){
    if(account&&(c.account||'עסקי')!==account)continue;
    const events=Array.isArray(c.bankHistory)?c.bankHistory:[],seen=new Set();
    for(const m of [...events,...(c.bankMatch?.eventId?[c.bankMatch]:[])]){
      if(!m?.eventId||m.phase==='manual'||seen.has(m.eventId))continue;
      seen.add(m.eventId);
      const current=m.eventId===c.bankMatch?.eventId&&m.phase===c.bankMatch?.phase&&c.bankAutomationDisabled!==true;
      items.push({checkId:c.id,name:m.checkName??c.name,amount:m.checkAmount??c.amount,account:m.checkAccount||c.account||'עסקי',checkNumber:m.checkNumber??c.checkNumber,match:current?c.bankMatch:m,title:incidentLabel(current?c.bankMatch:m),current,time:m.recordedAt||m.detectedAt||m.observedDate||m.date||''});
    }
  }
  items.sort((a,b)=>b.time.localeCompare(a.time)||String(a.checkId).localeCompare(String(b.checkId)));
  const pages=Math.max(1,Math.ceil(items.length/25)),currentPage=Math.max(0,Math.min(pages-1,Math.trunc(Number(page)||0)));
  const navigation=pages>1?`<nav class="row-actions" aria-label="עמודי הודעות הבנק"><button type="button" class="btn" data-action="check-bank-history-page" data-click-arg0="${currentPage-1}" ${currentPage===0?'disabled':''}>הקודם</button><span>עמוד ${currentPage+1} מתוך ${pages}</span><button type="button" class="btn" data-action="check-bank-history-page" data-click-arg0="${currentPage+1}" ${currentPage===pages-1?'disabled':''}>הבא</button></nav>`:'';
  return `<details class="section check-bank-activity"><summary>הודעות ופעולות אוטומטיות בבנק (${items.length})</summary><div class="section-body">${items.length?items.slice(currentPage*25,(currentPage+1)*25).map(item=>`<details class="check-bank-activity-item"><summary>${esc(item.name)} · ${esc(item.title)}${item.time?` · ${esc(item.time.slice(0,10))}`:''}</summary>${checkBankReviewCard(item,{activity:true,current:item.current})}</details>`).join(''):'<p>פעולות הזיהוי והמעקב יופיעו כאן לאחר סנכרון הבנק. התאמות ודאיות ופירעון תקין מתועדים כאן ללא אזהרה.</p>'}${navigation}</div></details>`;
}

export function applyCheckBankReview(checks,id,eventId,action){
  const check=checks.find(x=>x.id===id),m=check?.bankMatch;
  if(!m||m.eventId!==eventId||!['accept','reject'].includes(action)||(check.bankReview===eventId&&action==='accept'))return false;
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
  const label=check.bankAutomationDisabled?labels.manual:m?.phase==='deposited'&&m.provisional?'זיהוי ראשוני · תנועת בנק ממתינה':m?.phase==='deposited'&&m.autoConfirmed&&!m.warning?'זוהתה הפקדה בבנק · אושרה אוטומטית':m?.phase==='deposited'&&check.bankReview===m.eventId?'זוהתה הפקדה בבנק · ההתאמה אושרה':incidentLabel(m);
  return m?`<small class="check-bank-status">${esc(label||'התאמה לבנק')}${m.clearAfter&&!check.bankAutomationDisabled?` · בדיקת פירעון מ־${esc(m.clearAfter)}`:''}</small>`:'';
}
