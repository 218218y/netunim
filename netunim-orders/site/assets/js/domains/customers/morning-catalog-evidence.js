// @ts-check
/** @typedef {{id:string,number:string|number,type:number,amount:number,date:string,clientName?:string,currency?:string,status?:number,description?:string,allocationNumber?:string|number}} CatalogDocument */
/** @typedef {{items:CatalogDocument[],total:number,pages:number}} CatalogPage */
/** @typedef {{documentId:string,documentNumber:string,documentType:number,verifiedAt:string}} OperationMetadata */
export function invalidMorningCatalog() {
  return Object.assign(
    new Error(
      'Morning החזירה פרטי מסמך שאינם תקינים. הקישור לא אושר; יש לרענן ולנסות שוב.'
    ),
    { code: 'morning_catalog_invalid' }
  );
}
/** @param {unknown} value @returns {Record<string,unknown>} */
function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw invalidMorningCatalog();
  return /** @type {Record<string,unknown>} */ (value);
}
/** @param {unknown} value */
function response(value) {
  const data = object(value);
  if (data.ok === false || data.error !== undefined)
    throw invalidMorningCatalog();
  return data;
}
/** @param {unknown} value @returns {string} */
function id(value) {
  if (typeof value !== 'string' || !value.trim()) throw invalidMorningCatalog();
  return value;
}
/** @param {unknown} value @returns {number} */
function count(value) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw invalidMorningCatalog();
  return value;
}
/** @param {unknown} value @returns {number} */
function type(value) {
  const result = count(value);
  if (!result) throw invalidMorningCatalog();
  return result;
}
/** @param {unknown} value @returns {string|number} */
function label(value) {
  if (
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
    return value;
  throw invalidMorningCatalog();
}
/** @param {unknown} value @param {string} [expectedId] @returns {CatalogDocument} */
function decodeDocument(value, expectedId) {
  const row = object(value),
    documentId = id(row.id);
  if (expectedId !== undefined && documentId !== expectedId)
    throw invalidMorningCatalog();
  const documentType = type(row.type),
    number = label(row.number),
    amount = row.amount,
    date = id(row.date);
  if (
    typeof amount !== 'number' ||
    !Number.isFinite(amount) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date
  )
    throw invalidMorningCatalog();
  /** @type {CatalogDocument} */ const result = {
    id: documentId,
    number,
    type: documentType,
    amount,
    date
  };
  for (const field of /** @type {const} */ ([
    'clientName',
    'currency',
    'description'
  ]))
    if (row[field] !== undefined) {
      if (typeof row[field] !== 'string') throw invalidMorningCatalog();
      result[field] = row[field];
    }
  if (row.status !== undefined) result.status = count(row.status);
  if (row.allocationNumber !== undefined)
    result.allocationNumber = label(row.allocationNumber);
  return result;
}
/** @param {unknown} value @returns {CatalogPage} */
export function decodeMorningCatalogPage(value) {
  const data = response(value);
  if (!Array.isArray(data.items)) throw invalidMorningCatalog();
  return {
    items: data.items.map(value => decodeDocument(value)),
    total: count(data.total),
    pages: count(data.pages)
  };
}
/** @param {unknown} value @param {string} expectedId */
export function decodeMorningCatalogDocument(value, expectedId) {
  return decodeDocument(response(value).document, expectedId);
}
/** @param {unknown} value @param {string} expectedId @returns {OperationMetadata|null} */
export function decodeMorningCatalogMetadata(value, expectedId) {
  const row = response(value).operation;
  if (row === null || row === undefined) return null;
  const operation = object(row);
  if (id(operation.operation_id) !== expectedId) throw invalidMorningCatalog();
  if (typeof operation.state !== 'string') throw invalidMorningCatalog();
  if (operation.state !== 'created') return null;
  const verifiedAt = id(operation.verified_at);
  if (
    !/^\d{4}-\d{2}-\d{2}T/.test(verifiedAt) ||
    !Number.isFinite(Date.parse(verifiedAt))
  )
    throw invalidMorningCatalog();
  return {
    documentId: id(operation.document_id),
    documentNumber:
      operation.document_number === undefined ||
      operation.document_number === null
        ? ''
        : String(label(operation.document_number) || ''),
    documentType:
      operation.document_type === undefined || operation.document_type === null
        ? 0
        : type(operation.document_type),
    verifiedAt
  };
}
/** @param {unknown} value */
export function decodeMorningCatalogLink(value) {
  const data = response(value);
  let url;
  try {
    url = new URL(id(data.url));
  } catch {
    throw invalidMorningCatalog();
  }
  if (url.protocol !== 'https:' || url.username || url.password)
    throw invalidMorningCatalog();
  return url.href;
}
