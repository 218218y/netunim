// @ts-check
import {assertStorageJson} from './storage-json-codec.js';
export { evidenceDate, evidenceTimestamp } from './observation-time.js';

/** @param {unknown} value @returns {value is Record<string,unknown>} */
export function evidenceObject(value){return value!==null&&typeof value==='object'&&!Array.isArray(value)}
/** @param {unknown} value @returns {value is number} */
export function evidenceInteger(value){return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0}
/** @param {unknown} value @returns {value is string} */
export function evidenceText(value){return typeof value==='string'&&value.trim().length>0}
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
