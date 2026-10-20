import {REPORT_METHODS, REPORT_TYPES} from './morning-report-model.js';
export {parseReportAmount as parseMorningFilterAmount} from './morning-report-reconciliation.js';

const KIND_LABELS = {document:'מסמכי הכנסה ותקבולים', expense:'הוצאות'};
const SORT_FIELDS = new Set(['date', 'amount', 'name', 'number', 'type']);
const collator = new Intl.Collator('he', {numeric:true, sensitivity:'base'});
const normalize = value => String(value ?? '').normalize('NFKC').replace(/[\u0591-\u05BD\u05BF-\u05C7]/g, '').replace(/[׳’]/g, "'").replace(/[״“”]/g, '"').toLocaleLowerCase('he');
const absent = value => value === undefined || value === null || value === '';
function invalidFilter() {
  const error = new Error('יש לבחור מסננים וטווח סכומים תקינים');
  error.code = 'invalid_report_filter';
  return error;
}
export function morningRecordCategoryValue(row) {
  if (row.kind !== 'expense') return '';
  return row.categoryKey ? `id:${row.categoryKey}` : row.category ? `title:${row.category}` : 'none:';
}
export function morningRecordFilterOptions(records = []) {
  const kinds = new Set(), types = new Map(), methods = new Set(), categories = new Map();
  for (const row of records) {
    if (Object.hasOwn(KIND_LABELS, row.kind)) kinds.add(row.kind);
    if (Number.isSafeInteger(row.type)) types.set(row.type, REPORT_TYPES[row.type] || `סוג מסמך ${row.type}`);
    for (const method of Object.keys(row.methods || {})) if (Object.hasOwn(REPORT_METHODS, method)) methods.add(method);
    if (row.kind === 'expense') categories.set(morningRecordCategoryValue(row), row.category || 'ללא סיווג');
  }
  return {
    kinds:[...kinds].map(value => ({value, label:KIND_LABELS[value]})),
    types:[...types].sort(([a], [b]) => a - b).map(([value, label]) => ({value:String(value), label})),
    methods:Object.entries(REPORT_METHODS).filter(([value]) => methods.has(value)).map(([value, label]) => ({value, label})),
    categories:[...categories].sort(([, a], [, b]) => collator.compare(a, b)).map(([value, label]) => ({value, label})),
  };
}
export function filterMorningRecords(records = [], filters = {}, sort = {}) {
  const {kind = '', method = '', category = '', minCents = null, maxCents = null} = filters;
  const type = absent(filters.type) ? null : /^\d+$/.test(String(filters.type)) ? Number(filters.type) : NaN;
  const field = sort.field || 'date', direction = sort.direction || 'asc';
  if (!Array.isArray(records) || kind && !Object.hasOwn(KIND_LABELS, kind) || method && !Object.hasOwn(REPORT_METHODS, method) ||
      !absent(type) && !Number.isSafeInteger(type) || !absent(minCents) && !Number.isSafeInteger(minCents) ||
      !absent(maxCents) && !Number.isSafeInteger(maxCents) || !absent(minCents) && !absent(maxCents) && minCents > maxCents ||
      !SORT_FIELDS.has(field) || !['asc', 'desc'].includes(direction)) throw invalidFilter();
  const terms = normalize(filters.search).trim().split(/\s+/).filter(Boolean), amountFilter = !absent(minCents) || !absent(maxCents);
  const filtered = records.map((row, index) => ({row, index})).filter(({row}) => {
    if (kind && row.kind !== kind || type !== null && row.type !== type || method && !Object.hasOwn(row.methods || {}, method) ||
        category && morningRecordCategoryValue(row) !== category) return false;
    if (amountFilter && (!Number.isSafeInteger(row.grossCents) || !absent(minCents) && row.grossCents < minCents || !absent(maxCents) && row.grossCents > maxCents)) return false;
    if (!terms.length) return true;
    const searchable = normalize([row.name, row.number, row.description].join(' '));
    return terms.every(term => searchable.includes(term));
  });
  const value = row => field === 'amount' ? Number.isSafeInteger(row.grossCents) ? row.grossCents : null : field === 'type' ? row.type : row[field];
  filtered.sort((a, b) => {
    const left = value(a.row), right = value(b.row);
    const missingLeft = absent(left), missingRight = absent(right);
    // Missing amounts remain last in either direction, never masquerading as 0.
    if (missingLeft !== missingRight) return missingLeft ? 1 : -1;
    const comparison = field === 'amount' || field === 'type' ? left === right ? 0 : left < right ? -1 : 1 : collator.compare(String(left ?? ''), String(right ?? ''));
    return comparison * (direction === 'desc' ? -1 : 1) || a.index - b.index;
  });
  return filtered.map(({row}) => row);
}
