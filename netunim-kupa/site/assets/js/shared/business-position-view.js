import {esc} from './html.js';

const money=value=>value===null||value===undefined?'—':new Intl.NumberFormat('he-IL',{style:'currency',currency:'ILS',maximumFractionDigits:2}).format(value);
const date=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')?value.split('-').reverse().join('/'):'לא ידוע';

// Render the actual contributing rows, never a second financial calculation.
export function businessPositionDetailsMarkup(position,{includeCash=false,customerOpen=null,supplierNet=null,total=null}={}){
  if(!position)return '<p class="muted">ממתין לנתוני המאזן מהענן.</p>';
  const component=(label,amount)=>`<tr><th scope="row">${esc(label)}</th><td dir="ltr">${esc(money(amount))}</td></tr>`;
  const rows=(title,list,description,day)=>`<details class="position-rows"><summary>${esc(title)} · ${list.length} שורות</summary><ul>${list.map(row=>`<li><span>${esc(description(row)||'ללא תיאור')} · ${esc(date(day(row)))}</span><b dir="ltr">${esc(money(row.amountStatus&&row.amountStatus!=='known_ils'?null:row.amount))}</b></li>`).join('')||'<li>אין תנועות לחישוב</li>'}</ul></details>`;
  const creditRows=position.creditRows||[],expenseRows=position.expenseRows||[],checkRows=position.checkRows||[],incomplete=position.incompleteCreditRows||[];
  return `<details class="business-position-details" dir="rtl"><summary>פירוט חישוב המאזן</summary>
    <p>המאזן כולל את כל הצ׳קים העסקיים שבקופה ואת כל חיובי האשראי העסקיים הידועים שטרם נפרעו, גם מעבר לאופק התחזית הקרובה. הוצאות: ${esc(date(position.expenseStart))} עד ${esc(date(position.expenseEnd))}. סכומים נשמרים באגורות.</p>
    <table aria-label="רכיבי המאזן"><tbody>${component('עו״ש עסקי',position.bank)}${component('צ׳קים עסקיים שבקופה (+)',position.checks)}${component('אשראי עסקי שטרם נפרע (−)',position.credit)}${component('הוצאות עסקיות בחלון המוצג (−)',position.expenses)}${includeCash?component('מזומן בקופה (+)',position.cash):''}${component('חוב לקוחות פתוח (+)',customerOpen)}${component('נטו ספקים (+)',supplierNet)}</tbody><tfoot>${component('מאזן כולל לפי הנתונים הידועים',total)}</tfoot></table>
    ${rows('אשראי עסקי שטרם נפרע',creditRows,row=>[row.card,row.description].filter(Boolean).join(' · '),row=>row.date)}
    ${rows('הוצאות עסקיות בחלון המוצג',expenseRows,row=>row.description||row.name,row=>row.dueDate)}
    ${rows('כל הצ׳קים העסקיים שבקופה',checkRows,row=>[row.name,row.checkNumber].filter(Boolean).join(' · '),row=>row.dueDate)}
    ${position.forecastIncomplete?`<p class="soft-note" role="status">המאזן חלקי. ${incomplete.length?`${incomplete.length} שורות אשראי עם סכום חסר, כיסוי חלקי או מועד לא ידוע.`:'נדרשת בדיקה של הוצאות קבועות בבנק.'}</p>`:''}
    ${incomplete.length?rows('אשראי הדורש בדיקה',incomplete,row=>[row.card,row.description,row.amountStatus!=='known_ils'?'סכום ₪ לא ידוע':'כיסוי חלקי',!row.date?'מועד חיוב לא ידוע':''].filter(Boolean).join(' · '),row=>row.date):''}
    <p class="muted">צ׳קים שהופקדו אינם נוספים שוב ליתרת הבנק. ${includeCash?'המזומן נוסף פעם אחת.':'המזומן אינו כלול במאזן זה.'} חוב לקוחות ויתרת ספקים מחושבים מכל השנים; סינון תקופה בטבלאות אינו משנה את המאזן. הסכום תלוי גם ברישום תשלומים ותקבולים בכרטיסי הספקים והלקוחות.</p>
  </details>`;
}
