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

// A bounded batch is an internal scheduling unit. The UI continues batches
// automatically. A second pass detects changed content even with the same total.
export function recentReadPause(ms, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => {clearTimeout(timer); reject(signal.reason || new DOMException('Cancelled', 'AbortError'));};
    const timer = setTimeout(() => {signal?.removeEventListener('abort', abort); resolve();}, ms);
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, {once:true});
  });
}
async function fingerprint(items) {
  const bytes = new TextEncoder().encode(JSON.stringify(items));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}
export async function readRecentExpenses(request, capabilities, check, {signal, progress = () => {}, scan = {next:0, pages:1, total:null, items:[], seen:new Set()}, maxPages = 4, pause = recentReadPause} = {}) {
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 20) throw new Error('invalid_recent_page_budget');
  scan.fingerprints ||= [];
  const assertCurrent = () => {signal?.throwIfAborted(); check();};
  for (let count = 0; count < maxPages; count++) {
    assertCurrent();
    const verifying = scan.next >= scan.pages;
    if (verifying && scan.verified >= scan.pages) return scan.items;
    const page = verifying ? (scan.verified || 0) : scan.next;
    let value;
    for (let attempt = 0; ; attempt++) {
      try {value = await readExpenseCatalogPage(request, capabilities, 'expenses', {}, page, assertCurrent, {signal}); break;}
      catch (error) {
        assertCurrent();
        // Retry this read only; never move retry policy into the financial writer.
        // The Edge transport already bounded provider retries and honored its
        // Retry-After. Do not multiply those attempts or bypass a long cooldown.
        if (attempt >= 2 || error.code === 'morning_expenses_source_failed' ||
            !(error instanceof TypeError || [429,502,503,504].includes(error.status))) throw error;
        await pause(1000 * 2 ** attempt, signal); assertCurrent();
      }
    }
    if (value.pages > 1000) throw new Error('רשימת ההוצאות חורגת ממגבלת 50,000 ההוצאות לקריאה במסך זה. יש לעיין בחשבון המלא ב־Morning.');
    const signature = await fingerprint(value.items); assertCurrent();
    if (scan.total !== null && scan.total !== value.total ||
        (verifying ? scan.fingerprints[page] !== signature : value.items.some(row => scan.seen.has(row.id)))) {
      throw new Error('רשימת ההוצאות השתנתה בזמן הטעינה. יש לרענן את הקליטות האחרונות.');
    }
    if (verifying) scan.verified = page + 1;
    else {
      scan.pages = Math.max(1, value.pages); scan.total = value.total;
      scan.items = recentExpenseRows([...scan.items, ...value.items]);
      scan.fingerprints[page] = signature;
      value.items.forEach(row => scan.seen.add(row.id)); scan.next++;
    }
    progress(scan.seen.size, scan.total, verifying ? 'verifying' : 'reading');
  }
  return scan.next >= scan.pages && scan.verified >= scan.pages ? scan.items : null;
}

export function createExpenseRecent({request, capabilities, capture, run, now = Date.now, pause = recentReadPause}) {
  let rows = [], siteRows = [], mode = 'site', message = '', revision = 0, busy = false, progressText = '', controller = null, scan = null, started = 0, readAt = 0, stale = false;
  const host = () => document.querySelector('[data-expense-recent]');
  function render() {const target = host(); if (target) target.outerHTML = markup();}
  function reset() {revision++; controller?.abort(); controller = null; rows = []; siteRows = []; mode = 'site'; message = ''; busy = false; progressText = ''; scan = null; started = 0; readAt = 0; stale = false;}
  function loadSite() {
    if (busy || !capabilities()) return false;
    if (!capabilities().siteRecent) {message = 'היסטוריית קליטות האתר תהיה זמינה לאחר עדכון שירות ההוצאות. קליטות חדשות יוצגו כאן מיד.'; render(); return false;}
    const epoch = revision, assertCurrent = capture(), caps = capabilities();
    const currentController = new AbortController(); controller = currentController;
    const check = () => {assertCurrent(); currentController.signal.throwIfAborted(); if (epoch !== revision) throw new DOMException('Cancelled','AbortError');};
    busy = true; progressText = 'טוען את קליטות האתר האחרונות…'; render();
    return run(async () => {
      try {
        const value = await request('site_recent', {expectedEnvironment:caps.environment}, check, {signal:currentController.signal}); check();
        if (value.version !== 1 || value.environment !== caps.environment || value.source !== 'site' || !Array.isArray(value.items) || value.items.length > 10 ||
            value.items.some(row => row?.kind !== 'expense' || typeof row.id !== 'string') || new Set(value.items.map(row => row.id)).size !== value.items.length) throw new Error('תשובת קליטות האתר אינה תקינה.');
        siteRows = recentExpenseRows(value.items); rows = siteRows; mode = 'site'; message = '';
      } catch (error) {if (epoch === revision) message = 'לא ניתן לטעון את קליטות האתר. ' + error.message;}
      finally {if (epoch === revision) {busy = false; controller = null; render();}}
    });
  }
  function load() {
    if (busy || !capabilities()) return false;
    if (!scan || now() - started >= 600000) {scan = {next:0, pages:1, total:null, items:[], seen:new Set()}; started = now();}
    const currentScan = scan;
    const epoch = revision;
    const currentController = new AbortController(); controller = currentController; const signal = currentController.signal;
    const timer = setTimeout(() => currentController.abort(new DOMException('Time limit', 'TimeoutError')), 300000);
    busy = true; message = ''; progressText = 'טוען הוצאות אחרונות מכל חשבון Morning…'; render();
    return run(async () => {
      try {
        const assertCurrent = capture();
        const check = () => {assertCurrent(); if (epoch !== revision) throw new DOMException('הקריאה בוטלה', 'AbortError');};
        const caps = capabilities();
        let found = null;
        do {
          found = await readRecentExpenses(request, caps, check, {signal, scan:currentScan, pause, progress:(count, total, phase) => {
            check(); progressText = phase === 'verifying' ? `נבדקת יציבות הרשימה · ${count} הוצאות נקראו` : `נקראו ${count} מתוך ${total} הוצאות מ־Morning…`;
            const status = host()?.querySelector('[data-expense-recent-status]'); if (status) status.textContent = progressText;
          }});
          check(); if (!found) await pause(100, signal);
        } while (!found);
        rows = found; mode = 'account'; readAt = now(); stale = false; scan = null;
        message = 'תמונת מצב מלאה לפי זמן קליטה · ' + new Date(readAt).toLocaleTimeString('he-IL');
      } catch (error) {
        if (epoch !== revision) return false;
        if (['AbortError','TimeoutError'].includes(error.name)) message = 'הטעינה נעצרה ללא הצגת תוצאה חלקית. אפשר להמשיך את הסריקה.';
        else {scan = null; message = 'לא ניתן לרענן את ההוצאות האחרונות. ' + error.message;}
      } finally {clearTimeout(timer); if (epoch === revision) {busy = false; controller = null; render();}}
    });
  }
  function record(result) {
    if (!result?.verified || !result.item || result.item.id !== result.expenseId) return false;
    const item = {...result.item, createdAt:result.siteCreatedAt || result.item.createdAt};
    // Only a canonical successful readback may enter the automatic list.
    let updated;
    try {updated = recentExpenseRows([item, ...siteRows.filter(row => row.id !== item.id)]);} catch {return false;}
    revision++; controller?.abort(); controller = null; busy = false; scan = null; stale = true;
    siteRows = updated; rows = siteRows; mode = 'site';
    message = 'קליטות האתר עודכנו מיד לאחר אימות ההוצאה.'; render(); return true;
  }
  function markup() {
    const content = rows.length ? `<table class="morning-expense-table morning-expense-table-compact" aria-label="עשר הקליטות האחרונות · ${mode === 'site' ? 'דרך האתר' : 'מכל חשבון Morning'}">
      ${expenseTableHead()}<tbody>${rows.map(row => expenseTableRow(row, 'recent')).join('')}</tbody></table>` :
      !busy && !message ? '<p>טרם נקלטו הוצאות להצגה ברשימה זו.</p>' : '';
    return `<section class="morning-expense-recent" data-expense-recent aria-label="הוצאות אחרונות שנקלטו במורנינג">
      <div class="morning-expense-history-heading"><h2>10 ההוצאות האחרונות · ${mode === 'site' ? 'קליטות האתר' : 'כל חשבון Morning'}</h2>
      <button type="button" class="btn" data-action="morning-expense-command" data-expense-command="recent-refresh" ${busy ? 'disabled' : ''}>${scan ? 'המשך רענון מכל Morning' : 'רענון מכל Morning ומהאתר'}</button>${busy ? '<button type="button" class="btn" data-action="morning-expense-command" data-expense-command="recent-cancel">ביטול טעינה</button>' : ''}</div>
      <p>${mode === 'site' ? 'ברירת מחדל: קליטות מאומתות דרך האתר בלבד · נתונים כפי שנשמרו בעת הקליטה, ללא סריקת Morning' : 'תמונת מצב מכל החשבון, כולל קליטה ישירה במורנינג'} · לפי זמן הקליטה. קליטה חדשה באתר מעדכנת את הרשימה אוטומטית.</p>
      ${mode === 'account' && readAt && (stale || now() - readAt >= 120000) ? '<p>תמונת המצב המוצגת אינה מעודכנת; נדרש רענון.</p>' : ''}
      ${content}<p role="status" aria-live="polite" data-expense-recent-status>${esc(busy ? progressText : message)}</p></section>`;
  }
  return {markup, record, load, loadSite, reset, cancel:() => controller?.abort()};
}
