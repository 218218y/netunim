import {readExpenseCatalogPage, expenseSupplierCategory, readExpenseSupplierCategory} from './morning-expense-catalog.js';

// Resolve source suggestions before the intake mutates its current draft. The
// caller's check fences account, environment, file, edit and financial ownership.
export async function readExpenseProposal(item, {request, capabilities, canonicalItem, expenses, local, check}) {
  let supplier = null;
  const taxId = item.supplier?.taxId;
  if (/^\d{9}$/.test(taxId || '')) {
    const found = await readExpenseCatalogPage(request, capabilities, 'suppliers', {taxId}, 0, check);
    const exact = found.items.filter(row => row.taxId === taxId && row.active);
    if (exact.length === 1 && found.total === 1) {
      const canonical = await canonicalItem('get_supplier', exact[0].id, check);
      if (canonical.active && canonical.taxId === taxId && (!item.supplier.id || canonical.id === item.supplier.id)) supplier = canonical;
    }
  }
  let category = null, categoryRows = [], categoryUnavailable = false;
  if (supplier && local) {
    category = expenseSupplierCategory(expenses, supplier);
    if (!category) {
      try {
        const history = await readExpenseSupplierCategory(request, capabilities, supplier, check);
        category = history.category; categoryRows = history.rows;
      } catch {check(); categoryUnavailable = true;}
    }
  }
  check();
  return {supplier, category, categoryRows, categoryUnavailable};
}

export function expenseProposalFields(item, classifications) {
  const money = value => Number.isSafeInteger(value) && value >= 0 ? (value / 100).toFixed(2) : '';
  return {number:item.number, documentType:item.documentType || '', date:item.date?.slice(0, 10) || '',
    net:money(item.netCents), vat:money(item.vatCents), gross:money(item.grossCents), description:item.description || '', allocationNumber:item.allocationNumber || '',
    classificationExpenseId:classifications.find(row => row.id === item.classification?.id)?.sourceExpenseId || ''};
}
