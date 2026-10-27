import {esc} from '../../core/values.js';
import {expenseBimonth, validReportDate} from '../../core/morning-report-period.js';
import {readExpenseCatalogPage} from './morning-expense-catalog.js';
import {expenseTableHead, expenseTableRow, expenseTableTotals, expenseMoney} from './morning-expense-table.js';

export function expenseHistoryRows(items, period) {
  const seen = new Set();
  for (const row of items) {
    if (seen.has(row.id) || !validReportDate(row.reportingDate) || expenseBimonth(row.reportingDate).key !== period.key) {
      throw new Error('רשימת ההוצאות השתנתה או אינה שייכת לתקופת הדיווח. יש לרענן.');
    }
    seen.add(row.id);
  }
  return items.filter(row => row.status !== 100).sort((a, b) =>
    String(b.sourceDocumentDate).localeCompare(String(a.sourceDocumentDate)) || a.id.localeCompare(b.id));
}

// Finish reading a reporting period before publishing it: Morning has no
// documented expense sort, so sorting individual API pages would be misleading.
export async function readExpenseHistoryPeriod(request, capabilities, period, check, options) {
  const filter = {fromDate:period.months[0], toDate:period.months[1]};
  const first = await readExpenseCatalogPage(request, capabilities, 'expenses', filter, 0, check, options);
  if (first.pages > 20) throw new Error('תקופת הדיווח חורגת ממגבלת 1,000 ההוצאות לקריאה במסך זה. יש לעיין בתקופה המלאה ב־Morning.');
  const items = [...first.items];
  for (let page = 1; page < first.pages; page++) {
    const result = await readExpenseCatalogPage(request, capabilities, 'expenses', filter, page, check, options);
    if (result.total !== first.total) throw new Error('רשימת ההוצאות השתנתה בזמן הטעינה. יש לרענן.');
    items.push(...result.items);
  }
  return expenseHistoryRows(items, period);
}

export function createExpenseHistory({request, capabilities, capture, run, todayISO}) {
  let groups = [], visible = 0, next = '', busy = false, paused = false, message = '', revision = 0, controller = null, observer = null;
  const host = () => document.querySelector('[data-expense-history]');
  function render() {
    const target = host(); if (!target) return;
    const scroller = target.closest('.view-scroll'), top = scroller?.scrollTop;
    target.outerHTML = markup();
    if (scroller && Number.isFinite(top)) scroller.scrollTop = top;
    bind();
  }
  function reset() {revision++; controller?.abort(); observer?.disconnect(); observer = null; controller = null; groups = []; visible = 0; next = expenseBimonth(todayISO()).months[0]; busy = false; paused = false; message = '';}
  function bind() {
    observer?.disconnect(); observer = null;
    const sentinel = host()?.querySelector('[data-expense-history-more]');
    if (!sentinel || busy || message) return;
    observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting) && sentinel.isConnected && host()?.contains(sentinel)) more();
    }, {root:sentinel.closest('.view-scroll'), rootMargin:'0px 0px 180px 0px'});
    observer.observe(sentinel);
  }
  function more() {
    if (busy || !capabilities()) return false;
    const loaded = groups.reduce((sum, group) => sum + group.items.length, 0);
    if (visible < loaded) {visible = Math.min(loaded, visible + 20); render(); return true;}
    if (!next || next < '2010-01-01') return false;
    let assertCurrent;
    try {assertCurrent = capture();} catch (error) {message = error.message; render(); return false;}
    const epoch = revision;
    const check = () => {assertCurrent(); if (epoch !== revision) throw new DOMException('הקריאה בוטלה', 'AbortError');};
    controller = new AbortController(); const signal = controller.signal;
    busy = true; paused = false; message = ''; render();
    return run(async () => {
      try {
        // Skip up to a year of empty periods per click, then allow continuation.
        const before = groups.length;
        for (let count = 0; count < 6 && next >= '2010-01-01'; count++) {
          const period = expenseBimonth(next);
          const items = await readExpenseHistoryPeriod(request, capabilities(), period, check, {signal});
          check(); if (epoch !== revision) return false;
          const date = new Date(period.fromDate + 'T00:00:00Z'); date.setUTCMonth(date.getUTCMonth() - 2);
          next = date.toISOString().slice(0, 10);
          if (items.length) {groups.push({period, items}); visible = loaded + Math.min(20, items.length); break;}
        }
        // An empty viewport keeps an IntersectionObserver intersecting. Pause
        // explicitly after one empty year instead of scanning back to 2010.
        paused = groups.length === before;
      } catch (error) {if (epoch === revision && error.name !== 'AbortError') message = 'לא ניתן להשלים את קריאת ההוצאות. ' + error.message;}
      finally {if (epoch === revision) {busy = false; controller = null; render();}}
    });
  }
  function refresh() {reset(); return more();}
  function markup() {
    let remaining = visible;
    const shown = groups.map(group => {
      const rows = group.items.slice(0, Math.max(0, remaining)); remaining -= rows.length;
      const totals = expenseTableTotals(group.items);
      return rows.length ? `<tbody class="morning-expense-history-period"><tr class="morning-expense-period-heading">
        <th colspan="5" scope="rowgroup"><h3>דיווח ${esc(group.period.label)} <small>(${group.items.length})</small></h3></th>
        <td data-label="סה״כ כולל מע״מ"><bdi>${esc(expenseMoney(totals.grossCents))}</bdi></td>
        <td data-label="סה״כ מע״מ"><bdi>${esc(expenseMoney(totals.vatCents))}</bdi></td></tr>
        ${rows.map(row => expenseTableRow(row)).join('')}</tbody>` : '';
    }).join('');
    const loaded = groups.reduce((sum, group) => sum + group.items.length, 0), hasMore = visible < loaded || next >= '2010-01-01';
    return `<section class="morning-expense-history" data-expense-history aria-label="הוצאות לפי תקופות דיווח">
      <div class="morning-expense-history-heading"><h2>הוצאות לפי תקופות דיווח</h2>
      <button type="button" class="btn" data-action="morning-expense-command" data-expense-command="history-refresh" ${busy ? 'disabled' : ''}>רענון רשימה</button></div>
      <p>בכל תקופה תאריך החשבונית מהחדש לישן · הסיכומים כוללים את כל הוצאות התקופה</p>
      ${shown ? `<table class="morning-expense-table" aria-label="הוצאות Morning לפי תקופות דיווח">${expenseTableHead()}${shown}</table>` : !busy && !message ? '<p>לא נמצאו הוצאות בתקופות שנבדקו.</p>' : ''}
      <p role="status" aria-live="polite">${esc(busy ? 'טוען הוצאות מ־Morning…' : message)}</p>
      ${message ? '<button type="button" class="btn" data-action="morning-expense-command" data-expense-command="history-more">ניסיון נוסף</button>' : hasMore && !busy ? paused ? '<button type="button" class="btn" data-action="morning-expense-command" data-expense-command="history-more">בדיקת שנה קודמת ללא הוצאות שהוצגו</button>' : '<div data-expense-history-more aria-hidden="true"></div>' : ''}</section>`;
  }
  reset();
  return {markup, more, refresh, reset, bind};
}
