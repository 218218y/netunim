import {esc} from '../../core/values.js';
import {validReportDate} from '../../core/morning-report-period.js';

const currency = new Intl.NumberFormat('he-IL', {style:'currency', currency:'ILS'});
export const expenseMoney = cents => Number.isSafeInteger(cents) ? currency.format(cents / 100) : '—';
// Match the existing Morning report policy: credit invoices reduce expenses.
const signed = (row, cents) => Number.isSafeInteger(cents) ? row.type === 330 ? -Math.abs(cents) : cents : null;
export function expenseTableTotals(items) {
  return Object.fromEntries(['grossCents', 'vatCents'].map(key => {
    let sum = 0;
    for (const row of items) {
      const value = signed(row, row[key]);
      if (value === null || !Number.isSafeInteger(sum + value)) return [key, null];
      sum += value;
    }
    return [key, sum];
  }));
}
export function expenseTableHead() {
  return `<thead><tr><th scope="col">מספר</th><th scope="col">תאריך המסמך</th><th scope="col">שם הספק</th>
    <th scope="col">תיאור</th><th scope="col">סוג ההוצאה</th><th scope="col">סכום כולל מע״מ</th><th scope="col">מע״מ</th></tr></thead>`;
}
export function expenseTableRow(row, kind = 'history') {
  const date = validReportDate(row.sourceDocumentDate) ? row.sourceDocumentDate.split('-').reverse().join('/') : '—';
  return `<tr data-expense-${kind}-id="${esc(row.id)}">
    <td data-label="מספר"><bdi>${esc(row.number || '—')}</bdi>${row.type === 330 ? '<small>חשבונית זיכוי</small>' : ''}</td>
    <td data-label="תאריך המסמך"><time datetime="${esc(row.sourceDocumentDate)}">${esc(date)}</time></td>
    <td data-label="שם הספק">${esc(row.name || '—')}</td>
    <td data-label="תיאור" class="morning-expense-description"><span title="${esc(row.description || '')}">${esc(row.description || '(ללא תיאור)')}</span></td>
    <td data-label="סוג ההוצאה">${esc(row.category || row.classification?.title || '—')}</td>
    <td data-label="סכום כולל מע״מ" class="morning-expense-gross${row.type === 330 ? ' credit' : ''}"><bdi>${esc(expenseMoney(signed(row, row.grossCents)))}</bdi></td>
    <td data-label="מע״מ"><bdi>${esc(expenseMoney(signed(row, row.vatCents)))}</bdi></td></tr>`;
}
