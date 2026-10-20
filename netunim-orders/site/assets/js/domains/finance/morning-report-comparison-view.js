import {esc} from '../../core/values.js';
import {money} from '../../core/money.js';
import {REPORT_METHODS, validReportDate} from './morning-report-model.js';
import {morningComparisonRange} from './morning-report-analysis.js';

const METRICS = {incomeCents:'הכנסות לפני מע״מ', expensesCents:'הוצאות לפני מע״מ', expenseCostCents:'עלות הוצאות ניהולית',
  profitCents:'רווח / הפסד ניהולי', receiptsCents:'סכום קבלות', outputVatCents:'מע״מ עסקאות', inputVatCents:'מע״מ תשומות מותר', vatBalanceCents:'יתרת מע״מ ניהולית'};
const amount = value => Number.isSafeInteger(value) ? money(value / 100) : '—';
const dateLabel = value => validReportDate(value) ? value.split('-').reverse().join('.') : '—';
const rangeLabel = range => range ? `${dateLabel(range.fromDate)}–${dateLabel(range.toDate)}` : 'יש לבחור טווח תאריכים תקין';
const sameRange = (left, right) => !!left && !!right && left.fromDate === right.fromDate && left.toDate === right.toDate;
function percentLabel(metric) {
  if (!Number.isSafeInteger(metric?.current) || !Number.isSafeInteger(metric?.previous) || metric.previous === 0 || !Number.isFinite(metric.percent)) return '—';
  return `${metric.percent > 0 ? '+' : ''}${new Intl.NumberFormat('he-IL', {maximumFractionDigits:2}).format(metric.percent)}%`;
}
function comparisonTable(metrics, labels, caption) {
  return `<div class="morning-report-table-wrap"><table class="morning-report-table morning-report-comparison-table">
    <caption>${esc(caption)}</caption><thead><tr>${['מדד', 'תקופה נוכחית', 'תקופת השוואה', 'שינוי בש״ח', 'שינוי באחוזים'].map(label => `<th scope="col">${label}</th>`).join('')}</tr></thead>
    <tbody>${Object.entries(labels).map(([field, label]) => {
      const metric = metrics?.[field];
      const complete = Number.isSafeInteger(metric?.current) && Number.isSafeInteger(metric?.previous) && Number.isSafeInteger(metric?.deltaCents);
      return `<tr><th scope="row">${esc(label)}${!complete ? '<small>חסרים נתונים להשוואה מלאה</small>' : ''}</th>
        <td data-label="תקופה נוכחית" class="morning-report-amount"><span>${esc(amount(metric?.current))}</span></td>
        <td data-label="תקופת השוואה" class="morning-report-amount"><span>${esc(amount(metric?.previous))}</span></td>
        <td data-label="שינוי בש״ח" class="morning-report-amount ${complete && metric.deltaCents < 0 ? 'negative' : ''}"><span>${esc(amount(complete ? metric.deltaCents : null))}</span></td>
        <td data-label="שינוי באחוזים"><bdi dir="ltr">${esc(complete ? percentLabel(metric) : '—')}</bdi></td></tr>`;
    }).join('')}</tbody></table></div>`;
}
export function morningComparisonMarkup({comparison = null, error = '', busy = false, mode = 'previous', fromDate, toDate, reportType, readAt} = {}) {
  const currentRange = fromDate && toDate ? {fromDate, toDate} : comparison?.currentRange;
  let requestedRange = null;
  try { requestedRange = morningComparisonRange(currentRange, mode); }
  catch { /* Incomplete custom date inputs do not invalidate the loaded report. */ }
  const accepted = comparison && sameRange(currentRange, comparison.currentRange) && sameRange(requestedRange, comparison.comparisonRange);
  const fields = {receipts:['receiptsCents'], profit:['incomeCents', 'expensesCents', 'expenseCostCents', 'profitCents'], vat:['outputVatCents', 'inputVatCents', 'vatBalanceCents']}[reportType];
  const labels = fields ? Object.fromEntries(fields.map(field => [field, METRICS[field]])) : METRICS;
  return `<section class="morning-report-comparison" aria-busy="${busy}">
    <h3>השוואת תקופות</h3><p>הצגת ההשוואה קוראת ממורנינג את התקופה הנוספת רק בלחיצה על הכפתור.</p>
    <div class="morning-report-toolbar" role="group" aria-label="בחירת תקופת השוואה">
      ${[['previous', 'לתקופה הקודמת'], ['year', 'לתקופה המקבילה אשתקד']].map(([value, label]) => `<button type="button" class="btn ${mode === value ? 'primary' : ''}" aria-pressed="${mode === value}" data-action="morning-report-option" data-report-option="comparison:mode" value="${value}" ${busy ? 'disabled' : ''}>${label}</button>`).join('')}
      <button type="button" class="btn primary" data-action="morning-report-option" data-report-option="comparison:load" value="1" ${busy || !requestedRange ? 'disabled' : ''}>${busy ? 'קורא את תקופת ההשוואה…' : accepted ? 'רענון ההשוואה' : 'הצגת ההשוואה'}</button>
      ${busy ? '<button type="button" class="btn" data-action="morning-report-option" data-report-option="comparison:cancel" value="1">ביטול ההשוואה</button>' : ''}
    </div><dl class="morning-report-comparison-ranges"><div><dt>תקופה נוכחית</dt><dd>${esc(rangeLabel(currentRange))}</dd></div>
      <div><dt>תקופת השוואה</dt><dd>${esc(rangeLabel(requestedRange))}</dd></div></dl>
    ${error ? `<p class="morning-report-warning" role="alert">${esc(error)}</p>` : ''}
    ${accepted ? `${comparisonTable(comparison.metrics, labels, 'סיכום ההשוואה לפי המדדים הזמינים')}
      ${Number.isFinite(Date.parse(readAt)) ? `<p>מועד קריאת תקופת ההשוואה: ${esc(new Intl.DateTimeFormat('he-IL', {dateStyle:'short', timeStyle:'short', timeZone:'Asia/Jerusalem'}).format(new Date(readAt)))}</p>` : ''}
      <details><summary>השוואת אמצעי תשלום</summary>${comparisonTable(comparison.methods, REPORT_METHODS, 'השוואת תקבולים לפי אמצעי תשלום')}</details>
      <p>השינוי מחושב רק כאשר שני הסכומים מלאים. מקף באחוזים מציין חוסר בנתונים או בסיס השוואה אפס; בבסיס שלילי האחוז מחושב ביחס לערכו המוחלט.
      ההשוואה מתייחסת לכל מסמכי התקופה, לפני סינון הפירוט. תקופות פתוחות הן נתוני ביניים.</p>` : comparison ? '<p>בחירת התקופה השתנתה; יש להציג את ההשוואה מחדש.</p>' : ''}
  </section>`;
}
