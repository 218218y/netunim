import {searchMatch} from '../../core/search.js';

// Catalog pages are deliberately bounded suggestions, never a complete directory.
export async function readExpenseCatalogPage(request, capabilities, action, filter, page, assertCurrent, {signal} = {}) {
  const result = await request(action, {...filter, page, expectedEnvironment:capabilities.environment}, assertCurrent, {signal}); assertCurrent();
  if (result.version !== 1 || result.environment !== capabilities.environment || result.page !== page || result.pageSize !== 50 ||
      !Number.isSafeInteger(result.total) || result.total < 0 || !Number.isSafeInteger(result.pages) || result.pages < 0 ||
      result.pages !== Math.ceil(result.total / 50) && !(result.total === 0 && result.pages === 1) || !Array.isArray(result.items) ||
      result.items.length !== Math.max(0, Math.min(50, result.total - page * 50))) throw new Error('עמוד Morning חלקי או לא תקין. יש לרענן.');
  const ids = new Set();
  for (const item of result.items) {
    if (typeof item?.id !== 'string' || ids.has(item.id) || action === 'suppliers' && (item.active !== true || typeof item.name !== 'string') ||
        action === 'expenses' && item.kind !== 'expense') throw new Error('נתוני הקטלוג אינם תקינים.');
    ids.add(item.id);
  }
  return result;
}
export function expenseCatalogClassifications(expenses) {
  const categories = new Map();
  for (const item of expenses.filter(row => row.status !== 100).sort((a, b) => String(b.sourceDocumentDate).localeCompare(String(a.sourceDocumentDate)))) {
    if (item.classification?.id && item.classification.title && !categories.has(item.classification.id)) categories.set(item.classification.id, {sourceExpenseId:item.id, ...item.classification});
  }
  return [...categories.values()];
}
export function expenseSupplierEligibility(supplier, profiles = [], allowP = false) {
  const profile = profiles.find(row => row.id === supplier?.id || row.taxId && row.taxId === supplier?.taxId);
  if (profile) {
    const eligible = allowP && supplier.active && profile.id === supplier.id && profile.taxId === supplier.taxId && ['IL', 'PS'].includes(supplier.country);
    return {eligible, p:true, reason:eligible ? 'ספק P · מע״מ מוצע 16%' : 'ספק P · קליטה ב־Morning'};
  }
  if (!supplier?.active) return {eligible:false, reason:'ספק לא פעיל'};
  if (supplier.country !== 'IL') return {eligible:false, reason:'מדינת הספק אינה ישראל'};
  if (!/^\d{9}$/.test(supplier.taxId)) return {eligible:false, reason:'נדרש מספר עוסק בן 9 ספרות'};
  return {eligible:true, reason:''};
}
// Morning's name filter does not provide our punctuation-insensitive matching.
// Keep canonical pages in this account's catalog, and scan at most four new pages
// per search. Subsequent searches reuse them; "more" resumes the directory scan.
export async function searchExpenseSuppliers(request, catalog, query, more, assertCurrent, {signal} = {}) {
  const term = query.trim(), tax = /^\d{9}$/.test(term);
  const directory = catalog.supplierDirectory ||= {items:new Map(catalog.supplierPage.items.map(row => [row.id, row])),
    seen:new Set(catalog.supplierPage.items.map(row => row.id)), nextPage:1, pages:catalog.supplierPage.pages, total:catalog.supplierPage.total};
  const matches = () => [...directory.items.values()].filter(row => searchMatch(term, [row.name, row.taxId]));
  if (!more) {
    const result = await readExpenseCatalogPage(request, catalog.capabilities, 'suppliers', tax ? {taxId:term} : {name:term}, 0, assertCurrent, {signal});
    for (const row of result.items) directory.items.set(row.id, row);
  }
  if (!tax && (more || !matches().length)) {
    for (let count = 0; count < 4 && directory.nextPage < directory.pages; count++) {
      const result = await readExpenseCatalogPage(request, catalog.capabilities, 'suppliers', {}, directory.nextPage, assertCurrent, {signal});
      if (result.total !== directory.total || result.items.some(row => directory.seen.has(row.id))) {
        throw new Error('רשימת הספקים השתנתה. יש לרענן את ההצעות.');
      }
      for (const row of result.items) {directory.items.set(row.id, row); directory.seen.add(row.id);}
      directory.nextPage++;
      if (!more && matches().length) break;
    }
  }
  return {items:matches(), hasMore:!tax && directory.nextPage < directory.pages};
}
export async function readExpenseCatalog(request, assertCurrent, today, options = {}) {
  const capabilities = await request('capabilities', {}, assertCurrent, options); assertCurrent();
  if (capabilities.version !== 1 || !['production', 'sandbox'].includes(capabilities.environment)) throw new Error('תשובת סביבת ההוצאות אינה תקינה.');
  const fromDate = String(Number(today.slice(0, 4)) - 2) + '-01-01', toDate = today.slice(0, 7) + '-01';
  const suppliers = await readExpenseCatalogPage(request, capabilities, 'suppliers', {}, 0, assertCurrent, options);
  const expenses = await readExpenseCatalogPage(request, capabilities, 'expenses', {fromDate, toDate}, 0, assertCurrent, options);
  return {capabilities, suppliers:suppliers.items, expenses:expenses.items, classifications:expenseCatalogClassifications(expenses.items),
    supplierPage:suppliers, expensePage:expenses, fromDate, toDate};
}
