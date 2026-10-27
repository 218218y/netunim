import {searchMatch} from '../../core/search.js';
import {expenseBimonth, validReportDate} from '../../core/morning-report-period.js';
import {readExpenseCatalogPage} from './morning-expense-catalog.js';

const literalSearchText = value => String(value ?? '').normalize('NFKC').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').toLocaleLowerCase('he-IL').trim().replace(/\s+/g, ' ');

// Parse explicit dates independently of the browser's locale and Date.parse.
// In this expense UI a short year is in 2000–2099, matching supported invoices.
export function expenseSearchMatcher(query) {
  const dates = [], literalQuery = literalSearchText(query);
  const text = literalQuery.replace(/[\u2010-\u2015\u2212]/g, '-').replace(
    /(?<!\d)(\d{4}\s*[-/.]\s*\d{1,2}\s*[-/.]\s*\d{1,2}|\d{1,2}\s*[-/.]\s*\d{1,2}\s*[-/.]\s*(?:\d{4}|\d{2}))(?!\d)/g,
    value => {
      const parts = value.split(/[-/.]/).map(part => part.trim());
      const [year, month, day] = parts[0].length === 4 ? parts : [parts[2].length === 2 ? '20' + parts[2] : parts[2], parts[1], parts[0]];
      dates.push(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
      return ' ';
    }).trim();
  return row => {
    if (row.status === 100) return false;
    const values = [row.number, row.name, row.description, row.category || row.classification?.title, row.type === 330 ? 'חשבונית זיכוי' : ''];
    const literals = values.map(literalSearchText);
    // Invoice identifiers and descriptions may themselves contain dots or dates.
    // A literal field match remains valid independently of date/amount parsing.
    if (literalQuery && literals.some(value => value.includes(literalQuery))) return true;
    if (dates.some(date => !validReportDate(date) || date !== row.sourceDocumentDate)) return false;
    const amounts = [row.grossCents, row.vatCents].filter(Number.isSafeInteger);
    // Thousands separators do not change an amount. Decimal queries must match
    // cents exactly, rather than treating 11.80 as the digits of 1,180.00.
    let unmatched = false;
    const rest = text.replace(/[-+]?\d+(?:[.,]\d+)*\.\d+(?:[.,]\d+)*/g, value => {
      const cents = /^[-+]?\d+(?:,\d{3})*\.\d{1,2}$/.test(value) ? Math.round(Number(value.replaceAll(',', '')) * 100) : null;
      if (!literals.some(text => text.includes(value)) && !amounts.some(amount => amount === cents || row.type === 330 && -Math.abs(amount) === cents)) unmatched = true;
      return ' ';
    });
    // Unmatched decimal amounts must not fall through to punctuation-insensitive
    // text matching, which would discard the decimal point.
    if (unmatched) return false;
    values.push(...amounts.map(cents => String(cents / 100)));
    return searchMatch(rest.replace(/(\d),(?=\d{3}(?:\D|$))/g, '$1').replace(/₪/g, ''), values);
  };
}

export function newExpenseSearchScan() {return {next:0, pages:1, total:null, items:[], seen:new Set()};}

// The provider has no combined supplier/text/amount/source-date search. Read
// canonical account pages, with an explicit bounded continuation for large accounts.
export async function readExpenseSearch(request, capabilities, query, check, {signal, scan = newExpenseSearchScan()} = {}) {
  const matches = expenseSearchMatcher(query);
  for (let count = 0; count < 4 && scan.next < scan.pages; count++) {
    const value = await readExpenseCatalogPage(request, capabilities, 'expenses', {}, scan.next, check, {signal});
    if (scan.total !== null && scan.total !== value.total || value.items.some(row => scan.seen.has(row.id))) {
      throw new Error('רשימת ההוצאות השתנתה בזמן החיפוש. יש להתחיל את החיפוש מחדש.');
    }
    if (value.pages > 1000) throw new Error('רשימת ההוצאות חורגת ממגבלת הקריאה במסך זה.');
    const found = value.items.filter(matches);
    for (const row of found) {
      try {expenseBimonth(row.reportingDate);} catch {throw new Error('תקופת דיווח חסרה או לא תקינה בתוצאות החיפוש. יש לבדוק ב־Morning.');}
    }
    scan.items.push(...found);
    value.items.forEach(row => scan.seen.add(row.id));
    scan.next++; scan.pages = value.pages; scan.total = value.total;
  }
  return scan;
}
