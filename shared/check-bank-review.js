import {esc} from './html.js';
import {bankChequeImageWithinRetention} from './bank-cheque-images.js';

// Locate the actual claimed bank row and individual cheque. Never select a
// batch's first image or reuse a number from another account/deposit cycle.
export function checkBankFrontImageMarkup(m,{bank,imageAction='view-bank-cheque-image',now=Date.now}={}){
  if(!m?.transactionId||!m.bankItem)return '';
  const feed=m.accountRole==='home'?bank?.homeFeed:m.accountRole==='business'?bank?.feed:null;
  if(!feed||String(feed.accountNumber)!==String(m.accountKey))return '';
  const rows=(feed.transactions||[]).filter(row=>String(row.id)===String(m.transactionId));
  if(rows.length!==1)return '';
  const row=rows[0],date=row.date||row.processedDate;
  const digits=value=>String(value??'').replace(/\D/g,'').replace(/^0+(?=\d)/,'');
  const b=m.bankItem,items=(row.checkDetails?.checkItems||[]).filter(i=>digits(b.checkNumber)&&digits(b.checkNumber)===digits(i.checkNumber)&&Math.round(Number(b.amount)*100)===Math.round(Number(i.amount)*100)&&['bankNumber','branchNumber','accountNumber'].every(key=>!b[key]||!i[key]||digits(b[key])===digits(i[key])));
  if(items.length!==1||!items[0].imageFrontKey||!bankChequeImageWithinRetention(date,{now}))return '';
  return `<button type="button" class="btn bank-cheque-image-btn" data-action="${esc(imageAction)}" data-click-arg0="${esc(date)}" data-click-arg1="${esc(items[0].imageFrontKey)}" data-click-arg2="חזית">צפייה בחזית השיק</button>`;
}

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

export function removableCheckBankEvents(check,{bulk=false}={}){
  const events=new Map((check.bankHistory||[]).map(m=>[m.eventId,m]));
  if(check.bankMatch?.eventId&&check.bankMatch.phase!=='manual')events.set(check.bankMatch.eventId,check.bankMatch);
  const pending=new Set(check.bankHistoryDismiss||[]);
  return [...events.values()].filter(m=>m.eventId&&m.phase!=='manual'&&!pending.has(m.eventId)&&m.eventId!==check.bankHistoryHiddenEvent&&
    (quietBankEvent(m)||check.bankReview===m.eventId||(!bulk&&m.eventId!==check.bankMatch?.eventId)||
      (bulk&&m.phase==='deposited'&&!m.warning&&m.transactionId&&String(m.transactionId)===String(check.bankMatch?.transactionId)&&quietBankEvent(check.bankMatch))));
}

export function removeCheckBankEvents(check,eventIds){
  const allowed=new Set(removableCheckBankEvents(check).map(m=>m.eventId)),ids=eventIds.filter(id=>allowed.has(id));
  if(!ids.length)return false;
  check.bankHistoryDismiss=[...new Set([...(check.bankHistoryDismiss||[]),...ids])];
  check.bankHistory=(check.bankHistory||[]).filter(m=>!ids.includes(m.eventId));
  if(ids.includes(check.bankMatch?.eventId))check.bankHistoryHiddenEvent=check.bankMatch.eventId;
  return true;
}

export function checkBankReviewItems(checks){
  return (Array.isArray(checks)?checks:[]).filter(c=>c.bankMatch?.eventId&&c.bankMatch.phase!=='manual'&&!quietBankEvent(c.bankMatch)&&c.bankReview!==c.bankMatch.eventId).map(c=>({
    id:`check_bank:${c.id}:${c.bankMatch.eventId}`,kind:'check_bank',checkId:c.id,account:c.account||'עסקי',name:c.name,amount:c.amount,checkNumber:c.checkNumber,
    match:c.bankMatch,title:incidentLabel(c.bankMatch),
  }));
}

export function checkBankReviewCard(item,{activity=false,current=true,...imageOptions}={}){
  const m=item.match,canReject=current&&m.phase==='deposited'&&!m.warning,canConfirm=canReject&&!m.autoConfirmed;
  const reviewButton=current&&!item.reviewed&&!quietBankEvent(m)?`<button type="button" class="btn" data-action="review-check-bank" data-click-arg0="${esc(item.checkId)}" data-click-arg1="${esc(m.eventId)}" data-click-arg2="accept">${canConfirm?'מאשר את ההתאמה':'ראיתי · הסר התראה'}</button>`:'';
  const removeButton=activity&&(!current||quietBankEvent(m)||item.reviewed)?`<button type="button" class="btn" data-action="review-check-bank" data-click-arg0="${esc(item.checkId)}" data-click-arg1="${esc(JSON.stringify([...(item.updates||[]).map(update=>update.match.eventId),m.eventId]))}" data-click-arg2="remove">אישור והסרת ההודעה</button>`:'';
  const clearingText=current&&m.phase==='deposited'&&!m.warning?`<p>${m.autoConfirmed?'ההתאמה אושרה אוטומטית.':'נדרש אישור ידני להתאמה זו.'} מעבר לנפרע יתבצע בסנכרון בנק מלא חדש לאחר 3 ימי עסקים בנקאיים נוספים, לפי לוח המסלקה. הספירה מתחילה לא לפני זיהוי התנועה הסופית.</p>`:'';
  return `<div class="check-bank-review${activity?'':' notice'}"${activity?'':' role="status"'}><b>${esc(item.title)}</b><p>${esc(item.name)} · חשבון ${esc(item.account)} · ${esc(item.amount)} ₪${item.checkNumber?` · צ׳ק ${esc(item.checkNumber)}`:''}</p>${evidenceMarkup(m)}${checkBankFrontImageMarkup(m,imageOptions)}${remainderMarkup(m)}${m.warning?`<p>${esc(warnings[m.warning]||'נדרשת בדיקת תנועת הבנק')}</p>`:''}${m.reason?`<p>${esc(m.reason)}</p>`:''}${clearingText}<div class="row-actions">${reviewButton}${removeButton}${canReject?`<button type="button" class="btn" data-action="review-check-bank" data-click-arg0="${esc(item.checkId)}" data-click-arg1="${esc(m.eventId)}" data-click-arg2="reject">ההתאמה שגויה · בטל</button>`:''}<button type="button" class="btn" data-action="open-check-modal-2" data-click-arg0="${esc(item.checkId)}">בדיקה / עריכה</button></div></div>`;
}

export function checkBankReviewMarkup(checks,account){return checkBankReviewItems(checks).filter(x=>!account||x.account===account).map(item=>checkBankReviewCard(item)).join('')}

export function checkBankActivityMarkup(checks,account,page=0,imageOptions={}){
  const items=[];
  for(const c of Array.isArray(checks)?checks:[]){
    if(account&&(c.account||'עסקי')!==account)continue;
    const events=Array.isArray(c.bankHistory)?c.bankHistory:[],seen=new Set();
    let previous=null;
    for(const m of [...events,...(c.bankMatch?.eventId?[c.bankMatch]:[])]){
      if(!m?.eventId||m.phase==='manual'||seen.has(m.eventId)||m.eventId===c.bankHistoryHiddenEvent||(c.bankHistoryDismiss||[]).includes(m.eventId))continue;
      seen.add(m.eventId);
      const current=m.eventId===c.bankMatch?.eventId&&m.phase===c.bankMatch?.phase&&c.bankAutomationDisabled!==true;
      const item={checkId:c.id,reviewed:c.bankReview===m.eventId,name:m.checkName??c.name,amount:m.checkAmount??c.amount,account:m.checkAccount||c.account||'עסקי',checkNumber:m.checkNumber??c.checkNumber,match:current?c.bankMatch:m,title:!current&&m.phase==='deposited'&&!m.autoConfirmed&&!m.warning?'התבקש אישור התאמה בעבר':incidentLabel(current?c.bankMatch:m),current,time:m.recordedAt||m.detectedAt||m.observedDate||m.date||''};
      // Pending/final evidence and approval upgrades update one deposit card.
      // Adverse events and later deposit cycles remain separate and visible.
      if(previous&&previous.match.phase==='deposited'&&m.phase==='deposited'&&!previous.match.warning&&!m.warning&&m.transactionId&&String(previous.match.transactionId)===String(m.transactionId)&&previous.match.accountKey===m.accountKey){
        item.updates=[...(previous.updates||[]),previous];items[items.length-1]=item;
      }else items.push(item);
      previous=item;
    }
  }
  items.sort((a,b)=>b.time.localeCompare(a.time)||String(a.checkId).localeCompare(String(b.checkId)));
  const pages=Math.max(1,Math.ceil(items.length/25)),currentPage=Math.max(0,Math.min(pages-1,Math.trunc(Number(page)||0)));
  const navigation=pages>1?`<nav class="row-actions" aria-label="עמודי הודעות הבנק"><button type="button" class="btn" data-action="check-bank-history-page" data-click-arg0="${currentPage-1}" ${currentPage===0?'disabled':''}>הקודם</button><span>עמוד ${currentPage+1} מתוך ${pages}</span><button type="button" class="btn" data-action="check-bank-history-page" data-click-arg0="${currentPage+1}" ${currentPage===pages-1?'disabled':''}>הבא</button></nav>`:'';
  return `<details class="section check-bank-activity"><summary>הודעות ופעולות אוטומטיות בבנק (${items.length})</summary><div class="section-body">${items.length?items.slice(currentPage*25,(currentPage+1)*25).map(item=>`<details class="check-bank-activity-item"><summary>${esc(item.name)} · ${esc(item.title)}${item.time?` · ${esc(item.time.slice(0,10))}`:''}</summary>${checkBankReviewCard(item,{activity:true,current:item.current,...imageOptions})}${item.updates?.length?`<details class="check-bank-activity-updates"><summary>עדכונים קודמים להפקדה (${item.updates.length})</summary>${item.updates.map(update=>checkBankReviewCard(update,{activity:true,current:false,...imageOptions})).join('')}</details>`:''}</details>`).join(''):'<p>פעולות הזיהוי והמעקב יופיעו כאן לאחר סנכרון הבנק. התאמות ודאיות ופירעון תקין מתועדים כאן ללא אזהרה.</p>'}${navigation}</div></details>`;
}

export function applyCheckBankReview(checks,id,eventId,action){
  const check=checks.find(x=>x.id===id),m=check?.bankMatch;
  if(action==='remove'){
    if(!check)return false;
    let ids;try{ids=JSON.parse(eventId)}catch{return false}
    return Array.isArray(ids)&&removeCheckBankEvents(check,ids);
  }
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
