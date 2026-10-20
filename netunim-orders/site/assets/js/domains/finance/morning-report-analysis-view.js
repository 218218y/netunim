import {esc} from '../../core/values.js';
import {money} from '../../core/money.js';
import {REPORT_METHODS, validReportDate} from './morning-report-model.js';
import {morningRecordFilterOptions} from './morning-report-filters.js';

const SERIES_LABELS = {incomeCents:'הכנסות לפני מע״מ', expenseCostCents:'עלות הוצאות ניהולית', profitCents:'רווח / הפסד ניהולי', receiptsCents:'סכום קבלות',
  outputVatCents:'מע״מ עסקאות', inputVatCents:'מע״מ תשומות מותר', vatBalanceCents:'יתרת מע״מ ניהולית'};
const COLORS = ['#28795e', '#b66738', '#5658a9', '#217e9b', '#aa405f'];
const select = (key, label, choices, selected = '', all = true) => `<label>${esc(label)}<select data-change="morning-report-option" data-report-option="filter:${esc(key)}">${all ? '<option value="">הכול</option>' : ''}${choices.map(choice => `<option value="${esc(choice.value)}" ${String(choice.value) === String(selected) ? 'selected' : ''}>${esc(choice.label)}</option>`).join('')}</select></label>`;
function filterAmount(cents) {
  if (!Number.isSafeInteger(cents)) return '';
  const absolute = Math.abs(cents);
  return `${cents < 0 ? '-' : ''}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}
export function morningRecordFiltersMarkup(records, filters = {}, sort = {}) {
  const choices = morningRecordFilterOptions(records);
  return `<fieldset class="morning-report-local-filters"><legend>חיפוש וסינון מסמכי המקור</legend>
    <label>חיפוש לקוח, ספק, מספר או תיאור<input type="search" value="${esc(filters.search || '')}" data-change="morning-report-option" data-report-option="filter:search" autocomplete="off"></label>
    ${select('kind', 'מקור', choices.kinds, filters.kind)}${select('type', 'סוג מסמך', choices.types, filters.type)}
    ${select('method', 'אמצעי תשלום', choices.methods, filters.method)}${select('category', 'סיווג הוצאה', choices.categories, filters.category)}
    <label>סכום מסמך מ־<input type="text" inputmode="decimal" value="${esc(filters.minAmount ?? filterAmount(filters.minCents))}" data-change="morning-report-option" data-report-option="filter:minAmount" placeholder="ללא מינימום"></label>
    <label>סכום מסמך עד<input type="text" inputmode="decimal" value="${esc(filters.maxAmount ?? filterAmount(filters.maxCents))}" data-change="morning-report-option" data-report-option="filter:maxAmount" placeholder="ללא מקסימום"></label>
    ${select('sortField', 'מיון לפי', [{value:'date', label:'תאריך הדוח'}, {value:'name', label:'לקוח / ספק'}, {value:'number', label:'מספר מסמך'}, {value:'amount', label:'סכום כולל מע״מ'}], sort.field || 'date', false)}
    ${select('sortDirection', 'סדר', [{value:'asc', label:'עולה'}, {value:'desc', label:'יורד'}], sort.direction || 'asc', false)}
    <button type="button" class="btn small" data-action="morning-report-option" data-report-option="filter:reset" value="1">איפוס סינון</button>
    <small>הסינון פועל במסמכים שכבר נטענו. סכומים הם סכומי המקור בשקלים כולל מע״מ; מסמך ללא סכום אינו נכלל בטווח סכומים.</small>
  </fieldset>`;
}
const periodLabel = key => `${key.slice(5, 7)}/${key.slice(0, 4)}`;
export function morningTrendMarkup(points, {title = 'מגמה חודשית ממורנינג', series = ['incomeCents', 'expenseCostCents']} = {}) {
  if (!Array.isArray(points) || points.length === 0) return '';
  const selected = [...new Set(series)].filter(field => Object.hasOwn(SERIES_LABELS, field) || field.startsWith('method:') && Object.hasOwn(REPORT_METHODS, field.slice(7))).slice(0, COLORS.length);
  if (!selected.length || points.some(point => !validReportDate(point.key + '-01'))) return '';
  const label = field => SERIES_LABELS[field] || REPORT_METHODS[field.slice(7)];
  const value = (point, field) => {
    const amount = field.startsWith('method:') ? point.methods?.[field.slice(7)] : point[field];
    return Number.isSafeInteger(amount) ? amount : null;
  };
  const amounts = points.flatMap(point => selected.map(field => value(point, field))).filter(amount => amount !== null);
  const minimum = Math.min(0, ...amounts), observedMaximum = Math.max(0, ...amounts);
  const maximum = observedMaximum === minimum ? minimum + 1 : observedMaximum, span = maximum - minimum;
  const width = 800, height = 240, left = 20, right = 20, top = 18, bottom = 38;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const y = amount => top + (maximum - amount) / span * plotHeight;
  const baseline = y(0), step = plotWidth / points.length, barWidth = Math.min(32, step * 0.76 / selected.length);
  const tickEvery = Math.max(1, Math.ceil(points.length / 10));
  const bars = points.map((point, index) => {
    const center = left + step * (index + 0.5);
    return selected.map((field, seriesIndex) => {
      const amount = value(point, field), x = center + (seriesIndex - selected.length / 2) * barWidth;
      const description = `${periodLabel(point.key)} · ${label(field)}: ${amount === null ? 'חסר נתון מלא' : money(amount / 100)}`;
      if (amount === null) return `<text x="${x + barWidth / 2}" y="${baseline - 5}" text-anchor="middle" fill="${COLORS[seriesIndex]}"><title>${esc(description)}</title>—</text>`;
      const barY = Math.min(baseline, y(amount)), barHeight = Math.abs(y(amount) - baseline);
      return `<rect x="${x}" y="${barY}" width="${Math.max(0.3, barWidth - 2)}" height="${Math.max(0.8, barHeight)}" fill="${COLORS[seriesIndex]}"><title>${esc(description)}</title></rect>`;
    }).join('') + (index % tickEvery === 0 || index === points.length - 1 ? `<text x="${center}" y="${height - 12}" text-anchor="middle" font-size="11" fill="currentColor">${esc(periodLabel(point.key))}</text>` : '');
  }).join('');
  return `<figure class="morning-report-trend"><figcaption>${esc(title)}</figcaption>
    <div class="morning-report-trend-legend">${selected.map((field, index) => `<span><svg width="12" height="12" aria-hidden="true"><rect width="12" height="12" fill="${COLORS[index]}"/></svg> ${esc(label(field))}</span>`).join('')}</div>
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}" direction="ltr" width="100%">
      <title>${esc(title)}</title><desc>סכומים בשקלים לפי חודשי הדוח. מקף מציין נתון חסר; הנתונים המלאים זמינים בטבלה שמתחת לתרשים.</desc>
      <line x1="${left}" x2="${width - right}" y1="${baseline}" y2="${baseline}" stroke="currentColor" stroke-opacity="0.25"/>${bars}
    </svg><p>הכנסות ותקבולים לפי תאריך המסמך; הוצאות לפי חודש הדיווח. מקף מציין נתון חסר.</p>
    <details class="morning-report-trend-data"><summary>נתוני התרשים לפי חודשים</summary><div class="morning-report-table-wrap"><table class="morning-report-table"><caption>${esc(title)}</caption>
      <thead><tr><th scope="col">חודש</th>${selected.map(field => `<th scope="col">${esc(label(field))}</th>`).join('')}</tr></thead>
      <tbody>${points.map(point => `<tr><th scope="row">${esc(periodLabel(point.key))}</th>${selected.map(field => `<td data-label="${esc(label(field))}">${value(point, field) === null ? '—' : esc(money(value(point, field) / 100))}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div></details></figure>`;
}
