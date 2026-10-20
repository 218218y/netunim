import {reportMetric} from './morning-report-model.js';
import {parseReportAmount, reconcileMorningReport, RECONCILIATION_METRICS} from './morning-report-reconciliation.js';

const TYPES = {
  receipts:['receiptsCents'],
  profit:['incomeCents', 'expensesCents', 'expenseCostCents', 'unrecoverableVatCents', 'profitCents'],
  vat:['outputVatCents', 'inputVatCents', 'vatBalanceCents'],
};
const BASES = {
  incomeCents:'הכנסות לפי תאריך מסמך, ללא מע״מ, לפי סיווג מסמכי ההכנסה במורנינג',
  receiptsCents:'קבלות לפי תאריך מסמך, כולל מע״מ וניכוי במקור; סכום המסמכים ולא יתרה בבנק',
  expensesCents:'הוצאות לפי חודש הדיווח, ללא מע״מ, כולל רכישות שנרשמו כהוצאות',
  expenseCostCents:'הוצאות ורכישות שנרשמו כהוצאות, בניכוי מע״מ התשומות המותר; ללא התאמות מס ופחת',
  unrecoverableVatCents:'מע״מ ההוצאות פחות מע״מ התשומות המותר, לפי חודש הדיווח',
  profitCents:'הכנסות ללא מע״מ פחות העלות הניהולית הכוללת רכישות ומע״מ שאינו ניתן לקיזוז; לפני התאמות מס ופחת',
  outputVatCents:'מע״מ במסמכי ההכנסה לפי תאריך מסמך, כולל זיכויים; ללא חשבוניות עצמיות הדורשות התאמה',
  inputVatCents:'מע״מ תשומות מותר ממורנינג לפי חודש הדיווח, לאחר זיכויי הוצאה',
  vatBalanceCents:'מע״מ עסקאות פחות מע״מ התשומות המותר, לפי תאריכי המסמך וחודשי הדיווח בהתאמה',
};
const STATES = {
  'no-official':'לא הוזן סכום ייחוס', 'missing-source':'חסרים נתונים באתר', incomparable:'טרם הושלמה התאמת הבסיס',
  match:'התאמה מספרית ידנית', difference:'קיים הפרש', 'invalid-value':'סכום ייחוס לא תקין', 'calculation-error':'לא ניתן לחשב הפרש',
};
const REASONS = {
  'scope-mismatch':'יש לאשר שדוח הייחוס מתייחס בדיוק לתקופה ולסביבה המוצגות.',
  'basis-mismatch':'יש לאשר בנפרד שהסכום במדד זה מחושב לפי אותו בסיס.',
  'reference-missing':'יש לציין שם או תיאור של דוח הייחוס.',
  'source-incomplete':'הסכום באתר אינו מלא; אין השוואה של סכום חלקי לסכום רשמי.',
  'official-value-missing':'שדה ריק אינו נחשב לאפס.',
};
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[character]));
const checked = value => value === true ? ' checked' : '';
function amount(value) {
  if (!Number.isSafeInteger(value)) return '—';
  const cents = BigInt(value), absolute = cents < 0 ? -cents : cents;
  const whole = new Intl.NumberFormat('he-IL').format(absolute / 100n);
  return `<bdi dir="ltr">${cents < 0 ? '-' : ''}${escape(whole)}.${String(absolute % 100n).padStart(2, '0')} ₪</bdi>`;
}
function comparison(report, environment, metric, inputs) {
  let value;
  try { value = parseReportAmount(inputs.values?.[metric.key]); }
  catch (error) { return {state:'invalid-value', reasonText:error.message, differenceCents:null}; }
  try {
    return reconcileMorningReport({report, environment, official:{
      reference:inputs.reference,
      scope:inputs.scopeConfirmed === true ? {fromDate:report.fromDate, toDate:report.toDate, environment} : undefined,
      valuesCents:{[metric.key]:value},
      basis:inputs.basisConfirmed?.[metric.key] === true ? {[metric.key]:metric.basis} : {},
    }}).metrics.find(item => item.key === metric.key);
  } catch (error) { return {state:'calculation-error', reasonText:error.message, differenceCents:null}; }
}
// Pure markup: drafts remain the caller's memory-only state. Every control uses
// the existing lazy report-option binding; no registry, storage, or API writes.
export function morningReconciliationMarkup({report, environment, reportType, inputs = {}, error = ''}) {
  if (!Object.hasOwn(TYPES, reportType) || !report?.total || !['production', 'sandbox'].includes(environment)) throw new Error('invalid_reconciliation_view');
  const metrics = TYPES[reportType].map(key => RECONCILIATION_METRICS.find(metric => metric.key === key));
  const hasDraft = !!inputs.reference || inputs.scopeConfirmed === true || Object.values(inputs.values || {}).some(value => value !== '' && value !== null && value !== undefined) || Object.values(inputs.basisConfirmed || {}).some(value => value === true) || !!error;
  const open = typeof inputs.open === 'boolean' ? inputs.open : hasDraft;
  const environmentLabel = environment === 'sandbox' ? 'סביבת בדיקה (Sandbox)' : 'סביבת אמת (Production)';
  const rows = metrics.map(metric => {
    const result = comparison(report, environment, metric, inputs);
    const reason = result.reasonText || REASONS[result.reason] || '';
    const state = Object.hasOwn(STATES, result.state) ? result.state : 'calculation-error';
    return `<tr>
      <th scope="row">${escape(metric.label)}</th>
      <td data-label="סכום באתר">${amount(reportMetric(report.total, metric.key))}</td>
      <td data-label="סכום בדוח הייחוס"><input class="morning-reconciliation-amount" type="text" inputmode="decimal" dir="ltr" autocomplete="off" maxlength="80" aria-label="${escape(`סכום בדוח הייחוס — ${metric.label}`)}" placeholder="ללא סכום" value="${escape(inputs.values?.[metric.key] ?? '')}" data-change="morning-report-option" data-report-option="official:value:${metric.key}"></td>
      <td data-label="בסיס החישוב"><label class="morning-reconciliation-basis"><input type="checkbox"${checked(inputs.basisConfirmed?.[metric.key])} data-change="morning-report-option" data-report-option="official:basis:${metric.key}"> סכום הייחוס משתמש בבסיס: ${escape(BASES[metric.key])}.</label></td>
      <td data-label="הפרש האתר פחות הייחוס">${amount(result.differenceCents)}</td>
      <td data-label="מצב ההשוואה"><span class="morning-reconciliation-state" data-reconciliation-state="${state}">${escape(STATES[state])}</span>${reason ? `<small class="morning-reconciliation-reason">${escape(reason)}</small>` : ''}</td>
    </tr>`;
  }).join('');
  return `<details class="morning-report-reconciliation"${open ? ' open' : ''}>
    <summary>השוואה ידנית לדוח שהופק במורנינג</summary>
    <div class="morning-report-reconciliation-content">
      <p>זו השוואה מספרית לערכים שתזינו מדוח הייחוס. היא אינה מאמתת את הקובץ ואינה מהווה אימות חשבונאי או הגשה לרשויות. פרטי ההשוואה אינם נשמרים בענן.</p>
      <p class="morning-report-note">תקופת הדוח: <bdi dir="ltr">${escape(report.fromDate)}–${escape(report.toDate)}</bdi> · ${escape(environmentLabel)}. שדה ריק אינו אפס; אפשר להזין סכום עד שתי ספרות אחרי הנקודה, כולל סכום שלילי.</p>
      ${reportType === 'profit' ? '<p class="morning-report-note">העלות והרווח הניהוליים כוללים רכישות שנרשמו כהוצאות. דוח רווח והפסד רשמי במורנינג עשוי להחריג רכוש קבוע ולכלול התאמות אחרות. אין לאשר בסיס זהה לפני בדיקת ההבדלים האלה.</p>' : ''}
      <div class="morning-reconciliation-reference"><label>שם או תיאור דוח הייחוס <input type="text" autocomplete="off" maxlength="240" value="${escape(inputs.reference || '')}" placeholder="למשל: דוח מע״מ יולי–אוגוסט 2026" data-change="morning-report-option" data-report-option="official:reference"></label>
      <label class="morning-reconciliation-scope"><input type="checkbox"${checked(inputs.scopeConfirmed)} data-change="morning-report-option" data-report-option="official:scope"> בדקתי שדוח הייחוס מתייחס בדיוק לתקופה ולסביבת מורנינג המוצגות כאן.</label></div>
      ${error ? `<p class="morning-report-note" role="alert">${escape(error)}</p>` : ''}
      <table class="morning-report-table morning-reconciliation-table"><caption>השוואה ידנית — הפרש מחושב כסכום באתר פחות סכום הייחוס</caption>
        <thead><tr><th scope="col">מדד</th><th scope="col">סכום באתר</th><th scope="col">סכום בדוח הייחוס (ש״ח)</th><th scope="col">אישור בסיס החישוב</th><th scope="col">הפרש האתר פחות הייחוס</th><th scope="col">מצב ההשוואה</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </details>`;
}
