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
export async function readRecentExpenses(request, capabilities, check, {signal, progress = () => {}, scan = {next:0, pages:1, total:null, items:[], seen:new Set()}, maxPages = 4} = {}) {
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 20) throw new Error('invalid_recent_page_budget');
  for (let count = 0; count < maxPages && scan.next < scan.pages; count++) {
    const page = scan.next;
    const value = await readExpenseCatalogPage(request, capabilities, 'expenses', {}, page, check, {signal});
    if (scan.total !== null && scan.total !== value.total || value.items.some(row => scan.seen.has(row.id))) {
      throw new Error('רשימת ההוצאות השתנתה בזמן הטעינה. יש לרענן את הקליטות האחרונות.');
    }
    if (value.pages > 1000) throw new Error('רשימת ההוצאות חורגת ממגבלת הקריאה.');
    const items = recentExpenseRows([...scan.items, ...value.items]);
    scan.pages = value.pages; scan.total = value.total; scan.items = items;
    value.items.forEach(row => scan.seen.add(row.id)); scan.next++;
    progress(scan.seen.size, scan.total);
  }
  return scan.next >= scan.pages ? scan.items : null;
}

export function createExpenseRecent({request, capabilities, capture, run, now = Date.now}) {
  let rows = [], message = '', revision = 0, busy = false, progressText = '', controller = null, scan = null, started = 0, readAt = 0, stale = false;
  const host = () => document.querySelector('[data-expense-recent]');
  function render() {const target = host(); if (target) target.outerHTML = markup();}
  function reset() {revision++; controller?.abort(); controller = null; rows = []; message = ''; busy = false; progressText = ''; scan = null; started = 0; readAt = 0; stale = false;}
  function load() {
    if (busy || !capabilities()) return false;
    if (readAt && !stale && now() - readAt < 120000) {message = 'מוצגת תמונת מצב מלאה מהשתי דקות האחרונות. אפשר לרענן לאחר תפוגת המטמון.'; render(); return true;}
    if (!scan || now() - started >= 300000) {scan = {next:0, pages:1, total:null, items:[], seen:new Set()}; started = now();}
    const currentScan = scan;
    const epoch = revision;
    controller = new AbortController(); const signal = controller.signal;
    busy = true; message = ''; progressText = 'טוען הוצאות אחרונות מכל חשבון Morning…'; render();
    return run(async () => {
      try {
        const assertCurrent = capture();
        const check = () => {assertCurrent(); if (epoch !== revision) throw new DOMException('הקריאה בוטלה', 'AbortError');};
        const found = await readRecentExpenses(request, capabilities(), check, {signal, scan:currentScan, progress:(count, total) => {
          check(); progressText = `נקראו ${count} מתוך ${total} הוצאות מ־Morning…`;
          const status = host()?.querySelector('[data-expense-recent-status]'); if (status) status.textContent = progressText;
        }});
        check();
        if (found) {rows = found; readAt = now(); stale = false; scan = null; message = 'תמונת מצב מלאה לפי זמן קליטה · ' + new Date(readAt).toLocaleTimeString('he-IL');}
        else message = `נקראו ${currentScan.seen.size} מתוך ${currentScan.total} הוצאות. יש להמשיך בטעינה כדי לקבוע את עשר האחרונות מכל החשבון.`;
      } catch (error) {
        if (epoch !== revision) return false;
        scan = null;
        if (error.name !== 'AbortError') message = 'לא ניתן לרענן את ההוצאות האחרונות. ' + error.message;
      } finally {if (epoch === revision) {busy = false; controller = null; render();}}
    });
  }
  function record(result) {
    if (!result?.verified) return false;
    revision++; controller?.abort(); controller = null; busy = false; scan = null; stale = true;
    message = 'החשבון עודכן. יש לטעון מחדש את הקליטות האחרונות לפי הצורך.'; render(); return true;
  }
  function markup() {
    const content = rows.length ? `<table class="morning-expense-table morning-expense-table-compact" aria-label="עשר ההוצאות האחרונות שנקלטו במורנינג">
      ${expenseTableHead()}<tbody>${rows.map(row => expenseTableRow(row, 'recent')).join('')}</tbody></table>` :
      !busy && !message ? '<p>הרשימה נטענת לפי בקשה, עד ארבעה עמודים בכל לחיצה. הטופס זמין בזמן הטעינה.</p>' : '';
    return `<section class="morning-expense-recent" data-expense-recent aria-label="הוצאות אחרונות שנקלטו במורנינג">
      <div class="morning-expense-history-heading"><h2>10 ההוצאות האחרונות שנקלטו במורנינג</h2>
      <button type="button" class="btn" data-action="morning-expense-command" data-expense-command="recent-refresh" ${busy ? 'disabled' : ''}>${scan ? 'המשך טעינת קליטות' : 'טעינת קליטות'}</button></div>
      <p>מכל החשבון, גם מקליטה ישירה במורנינג · לפי זמן הקליטה, ללא קשר לתאריך החשבונית או לתקופת הדיווח</p>
      ${readAt && (stale || now() - readAt >= 120000) ? '<p>תמונת המצב המוצגת אינה מעודכנת; נדרש רענון.</p>' : ''}
      ${content}<p role="status" aria-live="polite" data-expense-recent-status>${esc(busy ? progressText : message)}</p></section>`;
  }
  return {markup, record, load, reset};
}
