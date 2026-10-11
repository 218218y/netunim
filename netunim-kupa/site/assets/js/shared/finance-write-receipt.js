// @ts-check
import {readDocumentWriteAck} from './document-write-ack.js';
import {assertStorageJson} from './storage-json-codec.js';

/** @typedef {import('./storage-json.js').StorageJsonObject} JsonDocument */
/** @typedef {Readonly<{revision: number, state: JsonDocument, [key: string]: unknown}>} FinanceWriteReceipt */
/** @param {unknown} value @returns {value is Record<string, unknown>} */
function object(value){return value!==null&&typeof value==='object'&&!Array.isArray(value)}
/** @param {unknown} value @returns {JsonDocument} */
function document(value){
  const json=assertStorageJson(value);
  if(json===null||typeof json!=='object'||Array.isArray(json))throw new Error('document_write_ack_state_invalid');
  return structuredClone(json);
}

/**
 * Finance writes and Orders' manual Kupa settings use the existing document
 * revision/replay policy. This receipt does not grant a Main journal ACK or
 * prove display freshness. Invalid HTTP-success evidence is an unknown server
 * outcome, never permission to retry a provider scan or invent a revision.
 * @param {unknown} response
 * @param {{baseRevision: number, sentState: JsonDocument}} options
 * @returns {FinanceWriteReceipt}
 */
export function readFinanceWriteReceipt(response,{baseRevision,sentState}){
  try{
    const row=Array.isArray(response)?(response.length===1?response[0]:null):response;
    if(!Number.isSafeInteger(baseRevision)||baseRevision<0||!object(row)||!Object.hasOwn(row,'revision')||
      !(typeof row.revision==='number'||typeof row.revision==='string'&&/^\d+$/.test(row.revision))||
      row.operation_revision!==undefined&&row.operation_revision!==null&&
        !(typeof row.operation_revision==='number'||typeof row.operation_revision==='string'&&/^\d+$/.test(row.operation_revision))||
      row.operation_replayed!==undefined&&row.operation_replayed!==null&&typeof row.operation_replayed!=='boolean'){
      throw new Error('finance_write_receipt_metadata_invalid');
    }
    const receipt=readDocumentWriteAck(row,{baseRevision,sentState:document(sentState),prepareState:document});
    return Object.freeze({...row,revision:receipt.revision,state:receipt.state});
  }catch(cause){
    throw Object.assign(new Error('לא התקבל אישור תקין לשמירה בענן. ייתכן שהשרת שמר את הנתונים. יש לרענן מהענן לפני שמירה נוספת.',{cause}),{
      code:'FINANCE_WRITE_RECEIPT_INVALID',kind:'confirmation_unknown',retryable:false,
    });
  }
}
