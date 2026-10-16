// @ts-check
import {readDocumentWriteResponseRow} from '../shared/document-write-ack.js';

/** @typedef {import('../shared/storage-json.js').StorageJsonObject} JsonObject */
/** @typedef {import('../shared/storage-records.js').StorageDeleteIntents} DeleteIntents */
/** @typedef {{ok:boolean,status?:number,headers?:{get:(name:string)=>string|null},text:()=>Promise<string>}} RpcResponse */
/**
 * @typedef {{
 *   documentName:()=>string,
 *   request:(path:string,options:{method:'POST',networkRetry:true,dataPriority:'high',body:string})=>Promise<RpcResponse>,
 *   validate:(state:JsonObject,context:string)=>JsonObject,
 *   beginMeasure:(name:string)=>()=>undefined
 * }} MainDocumentWritePorts
 */

// Owns the Kupa Main wire request only. Retry/rebase, decoding authoritative
// ACK evidence and journal publication remain with their existing sync owners.
/** @param {MainDocumentWritePorts} ports */
export function createMainDocumentWrite({ documentName, request, validate, beginMeasure }) {
  /** @param {JsonObject} snapshot @param {number} expectedRevision @param {string} operationId @param {DeleteIntents} [deleteIntents] @param {JsonObject} [audit] @returns {Promise<{r:RpcResponse,j:unknown,body:string,row:unknown}>} */
  async function rpcSaveCloudV2(snapshot, expectedRevision, operationId, deleteIntents = {}, audit = {}) {
    const ackDone = beginMeasure('kupa:cloud-ack');
    validate(snapshot, 'Kupa V2 cloud state');
    const expected = Number(expectedRevision || 0),
      op = String(operationId || '').trim();
    if (!Number.isSafeInteger(expected) || expected < 0) throw new Error('kupa_v2_revision_invalid');
    if (!op) throw new Error('kupa_v2_operation_id_missing');
    const rpc =
      audit?.mutationType === 'bulk-delete'
        ? 'bulk_delete_save_kupa_document_v6'
        : 'save_kupa_document_v6';
    const r = await request('/rest/v1/rpc/' + rpc, {
      method: 'POST',
      networkRetry: true,
      dataPriority: 'high',
      body: JSON.stringify({
        p_document_name: documentName(),
        p_expected_revision: expected,
        p_state: snapshot,
        p_operation_id: op,
        p_delete_intents: deleteIntents,
        p_audit: audit,
      }),
    });
    const body = await r.text();
    /** @type {unknown} */ let j;
    try {
      j = body ? JSON.parse(body) : null
    } catch {
      j = null
    }
    if (r.ok) ackDone();
    return { r, j, body, row: r.ok ? readDocumentWriteResponseRow(j) : Array.isArray(j) ? j[0] : j };
  }

  return { rpcSaveCloudV2 };
}
