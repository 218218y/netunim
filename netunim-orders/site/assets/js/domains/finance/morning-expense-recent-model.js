// Only the ten display rows are retained. Provider payloads, URLs and source
// documents never belong to this local snapshot.
export function recentExpenseRows(items) {
  const rows = items.filter(row => row.status !== 100);
  if (rows.some(row => typeof row.createdAt !== 'string' || !row.createdAt || !Number.isFinite(Date.parse(row.createdAt)))) {
    throw new Error('חסר זמן יצירה בחלק מההוצאות; לא ניתן לקבוע בוודאות את סדר הקליטה.');
  }
  return rows.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id)).slice(0, 10);
}
function displayRows(items) {
  if (!Array.isArray(items) || items.length > 20 || items.some(row => !row || row.kind !== 'expense' || typeof row.id !== 'string' || !row.id || row.id.length > 80 || ![10,20,30,40,100].includes(row.status))) throw Error('invalid_expense_recent_snapshot');
  const text = (value, max = 250) => typeof value === 'string' ? value.slice(0,max) : '';
  return recentExpenseRows(items).map(row => ({id:row.id,kind:'expense',status:row.status,type:Number.isSafeInteger(row.type) ? row.type : null,
    createdAt:row.createdAt,sourceDocumentDate:text(row.sourceDocumentDate,10),reportingDate:text(row.reportingDate,10),
    number:text(row.number,60),name:text(row.name,180),description:text(row.description),category:text(row.category || row.classification?.title),
    grossCents:Number.isSafeInteger(row.grossCents) ? row.grossCents : null,vatCents:Number.isSafeInteger(row.vatCents) ? row.vatCents : null}));
}
const mergeRows = (before, after) => displayRows([...new Map([...before,...after].map(row => [row.id,row])).values()]);
export function expenseRecentSnapshot(value) {
  if (value == null) return null;
  if (value.version !== 1 || !['site','account'].includes(value.mode) || !Number.isFinite(value.readAt) || !Number.isFinite(value.scanStartedAt) ||
      !Array.isArray(value.items) || value.items.length > 10 || !Array.isArray(value.updates) || value.updates.length > 10 ||
      value.updates.some(update => !Number.isFinite(update.at))) throw Error('invalid_expense_recent_snapshot');
  return {version:1,mode:value.mode,readAt:value.readAt,scanStartedAt:value.scanStartedAt,items:displayRows(value.items),
    updates:value.updates.map(update => ({at:update.at,item:displayRows([update.item])[0]})).filter(update => update.item)};
}
export function updateExpenseRecentSnapshot(prior, change) {
  const before = expenseRecentSnapshot(prior) || {version:1,mode:'site',readAt:0,scanStartedAt:0,items:[],updates:[]};
  if (!['full','site','record'].includes(change.kind) || !Number.isFinite(change.at)) throw Error('invalid_expense_recent_change');
  let items = displayRows(change.items), updates = before.updates;
  if (change.kind === 'full') {
    if (!Number.isFinite(change.startedAt)) throw Error('invalid_expense_recent_change');
    if (before.mode === 'account' && before.scanStartedAt > change.startedAt) return before;
    // Keep site intakes committed by another tab after this scan started. A full
    // refresh otherwise replaces the snapshot, including removals and edits.
    items = mergeRows(items,updates.filter(update => update.at >= change.startedAt).map(update => update.item));
  } else {
    items = change.kind === 'record' ? mergeRows(before.items,items) : mergeRows(items,before.items);
    if (change.kind === 'record') updates = [...updates.filter(update => !change.items.some(row => row.id === update.item.id)),
      ...displayRows(change.items).map(item => ({item,at:change.at}))];
  }
  const ids = new Set(items.map(row => row.id));
  return {version:1,mode:change.kind === 'full' ? 'account' : before.mode,
    readAt:change.kind === 'full' || !before.readAt ? change.at : before.readAt,
    scanStartedAt:change.kind === 'full' ? change.startedAt : before.scanStartedAt,
    items,updates:updates.filter(update => ids.has(update.item.id)).slice(-10)};
}
