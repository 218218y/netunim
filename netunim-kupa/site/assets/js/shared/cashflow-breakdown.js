import {esc} from './html.js';

const money=value=>new Intl.NumberFormat('he-IL',{style:'currency',currency:'ILS',minimumFractionDigits:0,maximumFractionDigits:2}).format(value);
const date=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')?value.split('-').reverse().join('/'):'לא ידוע';
const signed=value=>`${value>0?'+':''}${money(value)}`;

// Consume the exact contributing rows returned by the cash-flow calculation.
// Never reconstruct the horizon or re-read unreconciled issuer transactions here.
export function cashflowBreakdownMarkup(cashflow){
  const groups=new Map();
  for(const row of cashflow.creditRows||[]){
    const key=JSON.stringify([row.hidden?'hidden':row.creditAccountKey,row.date]),group=groups.get(key)||{label:`אשראי ${row.account} · ${row.card}`,date:row.date,cents:0,estimated:false};
    group.cents+=Math.round(row.amount*100);group.estimated ||= row.amountEstimated||row.billingDateConfidence==='inferred';groups.set(key,group);
  }
  const credit=[...groups.values()].map(row=>({...row,amount:-row.cents/100}));
  const expenses=(cashflow.expenseRows||[]).map(row=>({label:row.name||row.description||row.note||'הוצאה',date:row.dueDate,amount:-row.amount,estimated:row.amountEstimated,note:row.source==='bank_recurring'?`לפי חיוב בנק מ־${date(row.sourceDate)}${row.bankSettlementState==='awaiting'?' · ממתין לרישום בבנק':''}`:''}));
  const checks=(cashflow.checkRows||[]).map(row=>({label:[row.name||row.customerName||row.payer||'צ׳ק',row.checkNumber?`מס׳ ${row.checkNumber}`:''].filter(Boolean).join(' · '),date:row.dueDate,amount:Number(row.amount)}));
  const section=(title,rows,total)=>`<section class="cashflow-breakdown-section"><h3>${esc(title)}</h3>${rows.length?`<table><thead><tr><th>פירוט</th><th>מועד צפוי</th><th>שינוי בחשבון</th></tr></thead><tbody>${rows.sort((a,b)=>a.date.localeCompare(b.date)).map(row=>`<tr><td>${esc(row.label)}${row.estimated?'<small>אומדן · כולל סכום או מועד משוער</small>':''}${row.note?`<small>${esc(row.note)}</small>`:''}</td><td>${esc(date(row.date))}</td><td dir="ltr">${esc(signed(row.amount))}</td></tr>`).join('')}</tbody><tfoot><tr><th colspan="2">סה״כ ${esc(title)}</th><td dir="ltr">${esc(signed(total))}</td></tr></tfoot></table>`:'<p class="muted">אין תנועות בטווח החישוב · סה״כ 0 ₪</p>'}</section>`;
  const incomplete=cashflow.incompleteCreditRows||[],warnings=cashflow.expiredSettlementWarnings||[];
  const reason=row=>!row.date?'אין מחזור חיוב מוכח':row.status==='pending'&&!row.pendingFresh?'נתוני העסקה הממתינה אינם עדכניים':row.unconverted?'סכום במט״ח ללא המרה לשקלים':row.unknownAmount?'סכום החיוב חסר':'נתוני חברת האשראי חלקיים';
  return `<div class="cashflow-breakdown" dir="rtl"><p>חשבון ${esc(cashflow.account)} · יתרת בסיס ל־${esc(date(cashflow.start))} · תחזית עד ${esc(date(cashflow.targetDate))}</p><p class="muted">אשראי והוצאות מפחיתים את היתרה; צ׳קים שבקופה מוסיפים לתחזית לפי מועד הפירעון, עד ${esc(date(cashflow.checkCutoffDate))}. מועדים שחלפו הם סכומים שעדיין נכללים בחישוב. החיובים שנמצאו כפרועים בבנק הוסרו.</p>${section('אשראי',credit,-cashflow.credit)}${section('הוצאות',expenses,-cashflow.expenses)}${section('צ׳קים צפויים להפקדה',checks,cashflow.checks)}<div class="cashflow-breakdown-total"><span>סה״כ שינוי צפוי${cashflow.forecastIncomplete?' · חלקי':''}</span><b dir="ltr">${esc(signed(cashflow.expectedChange))}</b></div><div class="cashflow-breakdown-total"><span>יתרת בסיס + שינוי צפוי = עו״ש תזרימי</span><b dir="ltr">${cashflow.projected===null?'—':esc(money(cashflow.projected))}</b></div>${incomplete.length?`<aside class="soft-note"><b>התחזית חלקית</b><p>סכומים שאינם ידועים או אינם עדכניים לא נוספו לסכום המחושב. נתונים סופיים חלקיים נכללים לפי הסכום הידוע.</p><ul>${incomplete.map(row=>`<li>${esc(row.card)} · ${esc(row.description||'נתוני מחזור')} · ${esc(date(row.date))}: ${esc(reason(row))}</li>`).join('')}</ul></aside>`:''}${bankRecurringObligationsMarkup(cashflow)}${warnings.length?`<aside class="soft-note">חיובים ישנים הוצאו מהתחזית לאחר חלון ההמתנה, ללא התאמה מוכחת בבנק:<ul>${warnings.map(row=>`<li>${esc(row.card)} · ${esc(date(row.dueDate))} · ${row.amountKnown===false?'סכום לא ידוע':esc(money(row.amount))}</li>`).join('')}</ul></aside>`:''}</div>`;
}

export function bankRecurringObligationsMarkup(cashflow){
  const obligations=cashflow.recurringObligations||[],warnings=cashflow.recurringExpenseWarnings||[];
  if(!obligations.length)return '';
  return `<section class="cashflow-breakdown-section"><h3>חיובים קבועים במעקב בנקאי</h3><p class="muted">המועד הוא אומדן ל־15 בחודש, או ל־16 כשה־15 בשבת. האומדן נשאר בחישוב עד זיהוי החיוב החודשי בבנק, גם אם המועד חלף. החיוב הבא נכלל בסכומים רק כשהוא בטווח התחזית.</p><ul>${obligations.map(row=>`<li><b>${esc(row.name)}</b> · ${esc(row.account)}: ${row.lastDebit?`חיוב אחרון בבנק ${esc(date(row.lastDebit.date))} · ${esc(money(row.lastDebit.amount))}; ${row.status==='awaiting'?'ממתין לרישום בבנק':'אומדן הבא'} ${esc(date(row.nextDueDate))} · ${esc(money(row.nextAmount))}`:'טרם נמצא חיוב בנק מזוהה; אין אומדן אוטומטי'}</li>`).join('')}</ul>${warnings.length?`<aside class="soft-note"><b>התחזית חלקית · נדרשת בדיקה</b><ul>${warnings.map(row=>`<li>${esc(row.name)}${row.dueDate?` · ${esc(date(row.dueDate))}`:''}: ${row.kind==='ambiguous'?'נמצאו כמה חיובים באותו חודש; לא נקבעה התאמה אוטומטית. אומדן קודם, אם קיים, נשאר בחישוב.':'אין חיוב בנק סופי שממנו ניתן לחשב אומדן. יש לרענן את נתוני הבנק ולבדוק את התנועה.'}</li>`).join('')}</ul></aside>`:''}</section>`;
}
