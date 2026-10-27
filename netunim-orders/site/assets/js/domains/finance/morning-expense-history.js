import {esc} from '../../core/values.js';
import {expenseBimonth, validReportDate} from '../../core/morning-report-period.js';
import {readExpenseCatalogPage} from './morning-expense-catalog.js';

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
  if (first.pages > 1000) throw new Error('תקופת הדיווח חורגת ממגבלת הקריאה. יש לעיין בה ב־Morning.');
  const items = [...first.items];
  for (let page = 1; page < first.pages; page++) {
    const result = await readExpenseCatalogPage(request, capabilities, 'expenses', filter, page, check, options);
    if (result.total !== first.total) throw new Error('רשימת ההוצאות השתנתה בזמן הטעינה. יש לרענן.');
    items.push(...result.items);
  }
  return expenseHistoryRows(items, period);
}

export function createExpenseHistory({request, capabilities, capture, run, todayISO}) {
  let groups = [], visible = 0, next = '', busy = false, message = '', revision = 0, controller = null;
  const host = () => document.querySelector('[data-expense-history]');
  function render() {
    const target = host(); if (!target) return;
    const top = target.querySelector('.morning-expense-history-list')?.scrollTop || 0;
    target.outerHTML = markup();
    const list = host()?.querySelector('.morning-expense-history-list'); if (list) list.scrollTop = top;
  }
  function reset() {revision++; controller?.abort(); controller = null; groups = []; visible = 0; next = expenseBimonth(todayISO()).months[0]; busy = false; message = '';}
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
    busy = true; message = ''; render();
    return run(async () => {
      try {
        // Skip up to a year of empty periods per click, then allow continuation.
        for (let count = 0; count < 6 && next >= '2010-01-01'; count++) {
          const period = expenseBimonth(next);
          const items = await readExpenseHistoryPeriod(request, capabilities(), period, check, {signal});
          check(); if (epoch !== revision) return false;
          const date = new Date(period.fromDate + 'T00:00:00Z'); date.setUTCMonth(date.getUTCMonth() - 2);
          next = date.toISOString().slice(0, 10);
          if (items.length) {groups.push({period, items}); visible = loaded + Math.min(20, items.length); break;}
        }
      } catch (error) {if (epoch === revision && error.name !== 'AbortError') message = 'לא ניתן להשלים את קריאת ההוצאות. ' + error.message;}
      finally {if (epoch === revision) {busy = false; controller = null; render();}}
    });
  }
  function refresh() {reset(); return more();}
  function markup() {
    let remaining = visible;
    const money = row => Number.isSafeInteger(row.grossCents) ? new Intl.NumberFormat('he-IL', {style:'currency', currency:'ILS'}).format(row.grossCents / 100) : 'סכום לא זמין';
    const date = value => validReportDate(value) ? value.split('-').reverse().join('/') : 'תאריך לא זמין';
    const shown = groups.map(group => {
      const rows = group.items.slice(0, Math.max(0, remaining)); remaining -= rows.length;
      return rows.length ? `<section class="morning-expense-history-period"><h3>דיווח ${esc(group.period.label)}</h3><ol>${rows.map(row =>
        `<li data-expense-history-id="${esc(row.id)}"><div><strong>${esc(row.name)}</strong><span>${esc(row.type === 330 ? 'חשבונית זיכוי' : 'חשבונית')} ${esc(row.number)}</span><small>${esc(row.category || row.classification?.title || row.description)}</small></div><div><time datetime="${esc(row.sourceDocumentDate)}">${esc(date(row.sourceDocumentDate))}</time><bdi>${esc(money(row))}</bdi></div></li>`
      ).join('')}</ol></section>` : '';
    }).join('');
    const loaded = groups.reduce((sum, group) => sum + group.items.length, 0), hasMore = visible < loaded || next >= '2010-01-01';
    return `<section class="morning-expense-history" data-expense-history aria-label="הוצאות אחרונות מ־Morning"><div class="morning-expense-history-heading"><h2>הוצאות אחרונות מ־Morning</h2><button type="button" class="btn" data-action="morning-expense-command" data-expense-command="history-refresh" ${busy ? 'disabled' : ''}>רענון רשימה</button></div><p>לפי תקופת דיווח מע״מ · בכל תקופה תאריך החשבונית מהחדש לישן</p><div class="morning-expense-history-list" tabindex="0" aria-label="רשימת הוצאות לפי תקופות דיווח">${shown || (!busy && !message ? '<p>לא נמצאו הוצאות בתקופות שנבדקו.</p>' : '')}<p role="status" aria-live="polite">${esc(busy ? 'טוען הוצאות מ־Morning…' : message)}</p>${hasMore ? `<button type="button" class="btn" data-action="morning-expense-command" data-expense-command="history-more" ${busy ? 'disabled' : ''}>${message ? 'ניסיון נוסף' : 'הצגת הוצאות נוספות'}</button>` : ''}</div></section>`;
  }
  reset();
  return {markup, more, refresh, reset};
}
