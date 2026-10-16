// @ts-check
import {assertStorageJson} from './storage-json-codec.js';

/** @param {unknown} value @returns {value is Record<string,unknown>} */
export function evidenceObject(value){return value!==null&&typeof value==='object'&&!Array.isArray(value)}
/** @param {unknown} value @returns {value is number} */
export function evidenceInteger(value){return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0}
/** @param {unknown} value @returns {value is string} */
export function evidenceText(value){return typeof value==='string'&&value.trim().length>0}
/** @param {unknown} value @returns {value is string} */
export function evidenceDate(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const date=new Date(value+'T00:00:00Z');
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}
/** @param {unknown} value @returns {value is string} */
export function evidenceTimestamp(value){
  return typeof value==='string'&&
    /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)&&
    evidenceDate(value.slice(0,10))&&Number.isFinite(Date.parse(value));
}
/** PostgreSQL numeric can be a JSON number or a decimal string; coercible blanks/booleans cannot be money.
 * @param {unknown} value @returns {value is number|string} */
export function evidenceMoney(value){
  return typeof value==='number'&&Number.isFinite(value)||
    typeof value==='string'&&/^-?\d+(?:\.\d+)?$/.test(value)&&Number.isFinite(Number(value));
}
/** @param {unknown} response @param {()=>Error} invalid @returns {Record<string,unknown>[]} */
export function evidenceRows(response,invalid){
  try{assertStorageJson(response)}catch{throw invalid()}
  if(!Array.isArray(response)||!response.every(evidenceObject))throw invalid();
  return response;
}
