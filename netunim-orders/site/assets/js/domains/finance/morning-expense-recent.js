import {esc} from '../../core/values.js';
import {readExpenseCatalogPage} from './morning-expense-catalog.js';
import {expenseTableHead, expenseTableRow} from './morning-expense-table.js';

export function recentExpenseRows(items) {
  const rows = items.filter(row => row.status !== 100);
  if (rows.some(row => typeof row.createdAt !== 'string' || !row.createdAt || !Number.isFinite(Date.parse(row.createdAt)))) {
    throw new Error('חסר זמן יצירה בחלק מההוצאות; לא ניתן לקבוע בוודאות את סדר הקליטה.');
  }
  return rows.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id)).slice(0, 10);
}

// The documented expense search has no creation-time ordering or cursor. Read
// every canonical page without a reporting-date filter before claiming "last 10".
export async function readRecentExpenses(request, capabilities, check, {signal, progress = () => {}} = {}) {
  let pages = 1, total = null;
  let items = [];
  const seen = new Set();
  for (let page = 0; page < pages; page++) {
    const value = await readExpenseCatalogPage(request, capabilities, 'expenses', {}, page, check, {signal});
    if (total !== null && total !== value.total || value.items.some(row => seen.has(row.id))) {
      throw new Error('רשימת ההוצאות השתנתה בזמן הטעינה. יש לרענן את הקליטות האחרונות.');
    }
    pages = value.pages; total = value.total;
    if (pages > 1000) throw new Error('רשימת ההוצאות חורגת ממגבלת הקריאה.');
    value.items.forEach(row => seen.add(row.id));
    items = recentExpenseRows([...items, ...value.items]);
    progress(seen.size, total);
  }
  return items;
}

export function createExpenseRecent({request, capabilities, capture, run}) {
  let rows = [], message = '', revision = 0, busy = false, progressText = '', controller = null;
  const host = () => document.querySelector('[data-expense-recent]');
  function render() {const target = host(); if (target) target.outerHTML = markup();}
  function reset() {revision++; controller?.abort(); controller = null; rows = []; message = ''; busy = false; progressText = '';}
  function load() {
    if (busy || !capabilities()) return false;
    const epoch = revision;
    controller = new AbortController(); const signal = controller.signal;
    busy = true; message = ''; progressText = 'טוען הוצאות אחרונות מכל חשבון Morning…'; render();
    return run(async () => {
      try {
        const assertCurrent = capture();
        const check = () => {assertCurrent(); if (epoch !== revision) throw new DOMException('הקריאה בוטלה', 'AbortError');};
        const found = await readRecentExpenses(request, capabilities(), check, {signal, progress:(count, total) => {
          check(); progressText = `נקראו ${count} מתוך ${total} הוצאות מ־Morning…`;
          const status = host()?.querySelector('[data-expense-recent-status]'); if (status) status.textContent = progressText;
        }});
        check(); rows = found;
      } catch (error) {
        if (epoch !== revision) return false;
        if (error.name !== 'AbortError') message = 'לא ניתן לרענן את ההוצאות האחרונות. ' + error.message;
      } finally {if (epoch === revision) {busy = false; controller = null; render();}}
    });
  }
  function record(result) {
    if (!result?.verified) return false;
    reset(); return load();
  }
  function markup() {
    const content = rows.length ? `<table class="morning-expense-table morning-expense-table-compact" aria-label="עשר ההוצאות האחרונות שנקלטו במורנינג">
      ${expenseTableHead()}<tbody>${rows.map(row => expenseTableRow(row, 'recent')).join('')}</tbody></table>` :
      !busy && !message ? '<p>לא נמצאו הוצאות בחשבון Morning.</p>' : '';
    return `<section class="morning-expense-recent" data-expense-recent aria-label="הוצאות אחרונות שנקלטו במורנינג">
      <div class="morning-expense-history-heading"><h2>10 ההוצאות האחרונות שנקלטו במורנינג</h2>
      <button type="button" class="btn" data-action="morning-expense-command" data-expense-command="recent-refresh" ${busy ? 'disabled' : ''}>רענון קליטות</button></div>
      <p>מכל החשבון, גם מקליטה ישירה במורנינג · לפי זמן הקליטה, ללא קשר לתאריך החשבונית או לתקופת הדיווח</p>
      ${content}<p role="status" aria-live="polite" data-expense-recent-status>${esc(busy ? progressText : message)}</p></section>`;
  }
  return {markup, record, load, reset};
}
