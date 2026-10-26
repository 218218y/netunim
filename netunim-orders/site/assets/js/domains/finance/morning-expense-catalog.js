// A bounded catalog is explicitly sourced from existing expenses, never a fabricated classification list.
export async function readExpenseCatalog(request, assertCurrent, today, {signal} = {}) {
  const capabilities = await request('capabilities', {}, assertCurrent, {signal});
  if (capabilities.version !== 1 || !['production', 'sandbox'].includes(capabilities.environment)) throw new Error('תשובת סביבת ההוצאות אינה תקינה.');
  async function all(action, filter = {}) {
    let total = null, pages = 1;
    const items = [], ids = new Set();
    for (let page = 0; page < pages; page++) {
      const result = await request(action, {...filter, page}, assertCurrent, {signal}); assertCurrent();
      if (result.version !== 1 || result.environment !== capabilities.environment || result.page !== page || result.pageSize !== 50 ||
          !Number.isSafeInteger(result.total) || result.total < 0 || !Number.isSafeInteger(result.pages) || result.pages < 0 || result.pages > 20 ||
          result.pages !== Math.ceil(result.total / 50) && !(result.total === 0 && result.pages === 1) || !Array.isArray(result.items) ||
          result.items.length !== Math.max(0, Math.min(50, result.total - page * 50)) || total !== null && total !== result.total) throw new Error('רשימת Morning חלקית או השתנתה. יש לרענן.');
      total = result.total; pages = result.pages;
      for (const item of result.items) {
        if (typeof item?.id !== 'string' || ids.has(item.id)) throw new Error('רשימת Morning כוללת רשומה לא תקינה או כפולה.');
        ids.add(item.id); items.push(item);
      }
    }
    return items;
  }
  const suppliers = await all('suppliers');
  const fromDate = String(Number(today.slice(0, 4)) - 2) + '-01-01', toDate = today.slice(0, 7) + '-01';
  const expenses = await all('expenses', {fromDate, toDate});
  if (suppliers.some(item => item.active !== true || typeof item.name !== 'string') || expenses.some(item => item.kind !== 'expense')) throw new Error('נתוני הקטלוג אינם תקינים.');
  const categories = new Map();
  for (const item of expenses.filter(row => row.status !== 100).sort((a, b) => String(b.sourceDocumentDate).localeCompare(String(a.sourceDocumentDate)))) {
    if (item.classification?.id && item.classification.title && !categories.has(item.classification.id)) categories.set(item.classification.id, {sourceExpenseId:item.id, ...item.classification});
  }
  return {capabilities, suppliers, expenses, classifications:[...categories.values()], fromDate, toDate};
}
