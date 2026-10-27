import {expenseReportingDefault} from '../../core/morning-report-period.js';

const uuid = value => typeof value === 'string' && /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value);
const empty = () => ({version:1, favorites:[], classifications:[]});
function clean(raw) {
  if (raw?.version !== 1 || !Array.isArray(raw.favorites) || !Array.isArray(raw.classifications)) return empty();
  const favorites = [...new Set(raw.favorites.filter(uuid))].slice(0, 8);
  const seen = new Set(), classifications = [];
  for (const row of raw.classifications) {
    if (!uuid(row?.supplierId) || !uuid(row?.expenseId) || seen.has(row.supplierId)) continue;
    seen.add(row.supplierId); classifications.push({supplierId:row.supplierId, expenseId:row.expenseId});
    if (classifications.length === 32) break;
  }
  return {version:1, favorites, classifications};
}
const key = (owner, environment) => {
  if (!uuid(owner) || !['production', 'sandbox'].includes(environment)) throw new Error('invalid_expense_preference_scope');
  return `morningExpensePreferences:${environment}:${owner}`;
};
export function readExpensePreferences(storage, owner, environment) {
  try {
    const value = storage.getItem(key(owner, environment));
    if (!value || value.length > 12000) return empty();
    return clean(JSON.parse(value));
  } catch { return empty(); }
}
export function writeExpensePreferences(storage, owner, environment, value) {
  try { storage.setItem(key(owner, environment), JSON.stringify(clean(value))); return true; }
  catch { return false; }
}
// Own this preference separately so an unrelated favorites/classification save
// from another open tab cannot overwrite the last manual reporting choice.
export function readExpenseReportingPeriod(storage, owner, environment, today) {
  try {
    const value = storage.getItem(key(owner, environment) + ':reportingPeriod');
    if (!value || value.length > 100) return '';
    const raw = JSON.parse(value);
    return raw?.version === 1 && typeof raw.period === 'string' && expenseReportingDefault(raw.period, today) === raw.period ? raw.period : '';
  } catch {return '';}
}
export function writeExpenseReportingPeriod(storage, owner, environment, period, today) {
  try {
    if (typeof period !== 'string' || expenseReportingDefault(period, today) !== period) return false;
    storage.setItem(key(owner, environment) + ':reportingPeriod', JSON.stringify({version:1, period}));
    return true;
  } catch {return false;}
}
