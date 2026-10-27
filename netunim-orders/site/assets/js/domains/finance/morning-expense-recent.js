import {esc} from '../../core/values.js';
import {expenseTableHead, expenseTableRow} from './morning-expense-table.js';

// Only canonical expense IDs persist. Invoice details are read again from Morning.
export function createExpenseRecent({read, capture, run, ids, remember}) {
  let rows = [], message = '', revision = 0, loading = false;
  const host = () => document.querySelector('[data-expense-recent]');
  function render() {const target = host(); if (target) target.outerHTML = markup();}
  function reset() {revision++; rows = []; message = ''; loading = false;}
  function record(result) {
    const row = result?.item;
    if (!result?.verified || row?.kind !== 'expense' || row.id !== result.expenseId || row.status === 100) return false;
    const previous = ids();
    const order = previous.includes(row.id) ? previous : [row.id, ...previous].slice(0, 10);
    remember(order);
    const found = new Map([...rows, row].map(item => [item.id, item]));
    rows = order.map(id => found.get(id)).filter(Boolean); message = ''; render(); return true;
  }
  function load() {
    const saved = [...ids()], epoch = revision;
    if (!saved.length) return false;
    loading = true; render();
    return run(async () => {
      const found = []; let failed = false;
      try {
        const check = capture();
        for (const id of saved) {
          try {
            const row = await read(id, check); check(); if (epoch !== revision) return false;
            if (row.kind === 'expense' && row.status !== 100) found.push(row);
          } catch {check(); if (epoch !== revision) return false; failed = true;}
        }
        const byId = new Map([...found, ...rows].map(row => [row.id, row]));
        rows = ids().map(id => byId.get(id)).filter(Boolean);
        message = failed ? 'לא ניתן לרענן כעת חלק מהקליטות האחרונות מול Morning.' : '';
      } catch {if (epoch !== revision) return false; message = 'לא ניתן לרענן כעת את הקליטות האחרונות.';}
      loading = false; render(); return true;
    });
  }
  function markup() {
    const content = rows.length ? `<table class="morning-expense-table morning-expense-table-compact" aria-label="קליטות אחרונות שהושלמו">
      ${expenseTableHead()}<tbody>${rows.map(row => expenseTableRow(row, 'recent')).join('')}</tbody></table>` :
      `<p role="status">${loading ? 'טוען קליטות אחרונות מ־Morning…' : 'קליטות שיושלמו ויאומתו יופיעו כאן, כדי שיהיה קל לראות מה כבר הוקלד.'}</p>`;
    return `<section class="morning-expense-recent" data-expense-recent aria-label="קליטות אחרונות שהושלמו">
      <h2>10 הקליטות האחרונות שהושלמו</h2><p>לפי סדר הקליטה במסך זה, גם מתקופות דיווח שונות</p>
      ${content}${message ? `<p role="status">${esc(message)}</p>` : ''}</section>`;
  }
  return {markup, record, load, reset};
}
