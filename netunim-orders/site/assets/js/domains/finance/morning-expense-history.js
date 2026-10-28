import {esc} from '../../core/values.js';
import {expenseBimonth, validReportDate} from '../../core/morning-report-period.js';
import {readExpenseCatalogPage} from './morning-expense-catalog.js';
import {expenseTableHead, expenseTableRow, expenseTableTotals, expenseMoney} from './morning-expense-table.js';
import {newExpenseSearchScan, readExpenseSearch} from './morning-expense-search.js';

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
  let query = '', searched = '', scan = null, searchVisible = 20;
  let year = '', periodKey = '';
  const lowerBound = () => periodKey ? periodKey + '-01' : year ? year + '-01-01' : '2010-01-01';
  const withinRange = () => !!next && next >= lowerBound();
  function searchFilter() {
    if (periodKey) {const period = expenseBimonth(periodKey + '-01'); return {fromDate:period.months[0],toDate:period.months[1]};}
    return year ? {fromDate:year + '-01-01',toDate:year + (year === todayISO().slice(0,4) ? todayISO().slice(4,7) : '-12') + '-01'} : {};
  }
  function resetBrowse() {
    groups = []; visible = 0; paused = false;
    next = periodKey ? periodKey + '-01' : year && year !== todayISO().slice(0,4) ? year + '-11-01' : expenseBimonth(todayISO()).months[0];
  }
  const host = () => document.querySelector('[data-expense-history]');
  function render() {
    const target = host(); if (!target) return;
    const scroller = target.closest('.view-scroll'), top = scroller?.scrollTop;
    const input = target.querySelector('[data-input="morning-expense-history-query"]');
    const focused = input && document.activeElement === input, selection = focused ? [input.selectionStart, input.selectionEnd] : null;
    const focusedFilter = target.contains(document.activeElement) ? document.activeElement.dataset.expenseHistoryFilter : '';
    target.outerHTML = markup();
    if (focused) {
      const replacement = host()?.querySelector('[data-input="morning-expense-history-query"]');
      replacement?.focus({preventScroll:true}); replacement?.setSelectionRange(...selection);
    }
    if (focusedFilter) host()?.querySelector(`[data-expense-history-filter="${focusedFilter}"]`)?.focus({preventScroll:true});
    if (scroller && Number.isFinite(top)) scroller.scrollTop = top;
    bind();
  }
  function cancelRead() {revision++; controller?.abort(); observer?.disconnect(); observer = null; controller = null; busy = false; message = '';}
  function reset() {cancelRead(); year = ''; periodKey = ''; resetBrowse(); query = ''; searched = ''; scan = null; searchVisible = 20;}
  function chooseFilter(element) {
    const kind = element.dataset.expenseHistoryFilter, value = element.value;
    if (kind === 'year') {
      if (value !== '' && (!/^\d{4}$/.test(value) || value < '2026' || value > todayISO().slice(0,4))) return false;
      year = value; periodKey = '';
    } else if (kind === 'period') {
      if (value !== '' && (!year || !/^\d{4}-(01|03|05|07|09|11)$/.test(value) || value.slice(0,4) !== year || value + '-01' > todayISO())) return false;
      periodKey = value;
    } else return false;
    cancelRead(); resetBrowse(); scan = null;
    return searched ? search() : more();
  }
  function bind() {
    observer?.disconnect(); observer = null;
    const sentinel = host()?.querySelector('[data-expense-history-more]');
    if (!sentinel || busy || message || searched) return;
    observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting) && sentinel.isConnected && host()?.contains(sentinel)) more();
    }, {root:sentinel.closest('.view-scroll'), rootMargin:'0px 0px 180px 0px'});
    observer.observe(sentinel);
  }
  function more() {
    if (searched) return false;
    if (busy || !capabilities()) return false;
    const loaded = groups.reduce((sum, group) => sum + group.items.length, 0);
    if (visible < loaded) {visible = Math.min(loaded, visible + 20); render(); return true;}
    if (!withinRange()) return false;
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
        for (let count = 0; count < 6 && withinRange(); count++) {
          const period = expenseBimonth(next);
          const items = await readExpenseHistoryPeriod(request, capabilities(), period, check, {signal});
          check(); if (epoch !== revision) return false;
          const date = new Date(period.fromDate + 'T00:00:00Z'); date.setUTCMonth(date.getUTCMonth() - 2);
          next = date.toISOString().slice(0, 10);
          if (items.length) {groups.push({period, items}); visible = loaded + Math.min(20, items.length); break;}
        }
        // An empty viewport keeps an IntersectionObserver intersecting. Pause
        // explicitly after one empty year instead of scanning back to 2010.
        paused = groups.length === before && withinRange();
      } catch (error) {if (epoch === revision && error.name !== 'AbortError') message = 'לא ניתן להשלים את קריאת ההוצאות. ' + error.message;}
      finally {if (epoch === revision) {busy = false; controller = null; render();}}
    });
  }
  function setQuery(value) {query = value.slice(0, 250); if (!query.trim() && searched) clearSearch();}
  function clearSearch() {cancelRead(); query = ''; searched = ''; scan = null; render();}
  function search() {
    if (!query.trim()) {clearSearch(); return true;}
    cancelRead(); searched = query.trim(); scan = newExpenseSearchScan(); searchVisible = 20;
    return searchMore();
  }
  function searchMore() {
    if (busy || !searched || !scan || !capabilities()) return false;
    if (searchVisible < scan.items.length) {searchVisible += 20; render(); return true;}
    if (scan.next >= scan.pages) return false;
    let assertCurrent;
    try {assertCurrent = capture();} catch (error) {message = error.message; render(); return false;}
    const epoch = revision, currentScan = scan, term = searched;
    const check = () => {assertCurrent(); if (epoch !== revision) throw new DOMException('הקריאה בוטלה', 'AbortError');};
    controller = new AbortController(); const signal = controller.signal;
    busy = true; message = ''; render();
    return run(async () => {
      try {
        await readExpenseSearch(request, capabilities(), term, check, {signal, scan:currentScan, filter:searchFilter()}); check();
      } catch (error) {
        if (epoch === revision && error.name !== 'AbortError') {
          scan = null; message = 'לא ניתן להשלים את החיפוש. ' + error.message;
        }
      } finally {if (epoch === revision) {busy = false; controller = null; render();}}
    });
  }
  function refresh() {if (searched) {query = searched; return search();} cancelRead(); resetBrowse(); return more();}
  function markup() {
    let remaining = searched ? searchVisible : visible;
    let displayedGroups = groups;
    if (searched) {
      const periods = new Map();
      for (const item of scan?.items || []) {
        const period = expenseBimonth(item.reportingDate);
        if (!periods.has(period.key)) periods.set(period.key, {period, items:[]});
        periods.get(period.key).items.push(item);
      }
      displayedGroups = [...periods.values()].sort((a, b) => b.period.key.localeCompare(a.period.key));
      displayedGroups.forEach(group => {group.items = expenseHistoryRows(group.items, group.period);});
    }
    const shown = displayedGroups.map(group => {
      const rows = group.items.slice(0, Math.max(0, remaining)); remaining -= rows.length;
      const totals = expenseTableTotals(group.items);
      return rows.length ? `<tbody class="morning-expense-history-period"><tr class="morning-expense-period-heading">
        <th colspan="5" scope="rowgroup"><h3>דיווח ${esc(group.period.label)} <small>(${group.items.length})</small></h3></th>
        <td data-label="סה״כ כולל מע״מ"><bdi>${esc(expenseMoney(totals.grossCents))}</bdi></td>
        <td data-label="סה״כ מע״מ"><bdi>${esc(expenseMoney(totals.vatCents))}</bdi></td></tr>
        ${rows.map(row => expenseTableRow(row)).join('')}</tbody>` : '';
    }).join('');
    const loaded = groups.reduce((sum, group) => sum + group.items.length, 0), hasMore = visible < loaded || withinRange();
    const complete = scan && scan.next >= scan.pages;
    const button = (command, label) => `<button type="button" class="btn" data-action="morning-expense-command" data-expense-command="${command}">${label}</button>`;
    let navigation = '', empty = '';
    if (!busy) {
      if (searched) {
        if (scan && searchVisible < scan.items.length) navigation = button('history-search-more', 'הצגת תוצאות נוספות');
        else if (scan && !complete) navigation = button('history-search-more', year ? 'המשך חיפוש בטווח שנבחר' : 'המשך חיפוש בכל החשבון');
        if (!message && complete) empty = '<p>לא נמצאו הוצאות התואמות לחיפוש.</p>';
      } else {
        if (message) navigation = button('history-more', 'ניסיון נוסף');
        else if (hasMore) navigation = paused ? button('history-more', 'בדיקת שנה קודמת ללא הוצאות שהוצגו') : '<div data-expense-history-more aria-hidden="true"></div>';
        if (!message) empty = '<p>לא נמצאו הוצאות בתקופות שנבדקו.</p>';
      }
    }
    const option = (value, label, selected) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${esc(label)}</option>`;
    const years = Array.from({length:Math.max(0,Number(todayISO().slice(0,4))-2025)},(_,index) => String(Number(todayISO().slice(0,4))-index));
    const periods = year ? [11,9,7,5,3,1].map(month => expenseBimonth(`${year}-${String(month).padStart(2,'0')}-01`)).filter(period => period.fromDate <= todayISO()) : [];
    return `<section class="morning-expense-history" data-expense-history aria-label="הוצאות לפי תקופות דיווח">
      <div class="morning-expense-history-heading"><h2>הוצאות לפי תקופות דיווח</h2>
      <div class="morning-expense-history-filters" role="group" aria-label="בחירת תקופות להצגת הוצאות">
      <label>שנת דיווח<select data-expense-history-filter="year" data-change="morning-expense-history-filter">${option('','כל השנים · מהחדש לישן',year)}${years.map(value => option(value,value,year)).join('')}</select></label>
      <label>תקופת דיווח דו־חודשית<select data-expense-history-filter="period" data-change="morning-expense-history-filter" ${year ? '' : 'disabled'}>${option('','כל התקופות בשנה',periodKey)}${periods.map(period => option(period.key,period.label,periodKey)).join('')}</select></label></div>
      <button type="button" class="btn" data-action="morning-expense-command" data-expense-command="history-refresh" ${busy ? 'disabled' : ''}>רענון רשימה</button></div>
      <div class="morning-expense-history-search" role="search" aria-label="חיפוש בהוצאות Morning">
      <label>חיפוש הוצאה<input type="search" maxlength="250" value="${esc(query)}" placeholder="ספק, מספר חשבונית, תיאור, סיווג, סכום או תאריך"
        data-input="morning-expense-history-query" data-keydown="morning-expense-history-search-enter"></label>
      <button type="button" class="btn" data-action="morning-expense-command" data-expense-command="history-search">חיפוש</button>
      ${searched ? '<button type="button" class="btn" data-action="morning-expense-command" data-expense-command="history-search-clear">ניקוי חיפוש</button>' : ''}</div>
      <p>בכל תקופה תאריך החשבונית מהחדש לישן · ${searched ? 'הסיכומים כוללים רק את תוצאות החיפוש שנמצאו' : 'הסיכומים כוללים את כל הוצאות התקופה'}</p>
      ${searched ? `<p role="status">חיפוש: ${esc(searched)} · ${scan ? `${scan.items.length} תוצאות · נבדקו ${scan.seen.size} מתוך ${scan.total ?? '…'} הוצאות${complete ? (year ? ' · החיפוש הושלם בטווח שנבחר' : ' · החיפוש הושלם בכל החשבון') : ' · החיפוש עדיין חלקי'}` : 'החיפוש לא הושלם'}</p>` : ''}
      ${shown ? `<table class="morning-expense-table" aria-label="הוצאות Morning לפי תקופות דיווח">${expenseTableHead()}${shown}</table>` : empty}
      <p role="status" aria-live="polite">${esc(busy ? 'טוען הוצאות מ־Morning…' : message)}</p>
      ${navigation}</section>`;
  }
  reset();
  return {markup, more, refresh, reset, bind, chooseFilter, setQuery, search, searchMore, clearSearch};
}
