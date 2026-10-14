// @ts-check
import {decodeMorningOperationStatus,decodeMorningReservation,decodeMorningCreatedDocument,decodeMorningAbandonment,decodeMorningOperationFailure} from './morning-operation-evidence.js';
/** @typedef {import('../../core/morning-operation-scope.js').MorningAssertion} MorningAssertion */
/** @typedef {Record<string,unknown> & {operation_id:string,document:Record<string,unknown> & {type:number,amount:number}}} IssuePayload */
/** @typedef {{
 * status:(operationId:string,reconcile:boolean,assertCurrent:MorningAssertion)=>Promise<import('./morning-operation-evidence.js').OperationStatus>,
 * reserve:(payload:IssuePayload,assertCurrent:MorningAssertion)=>Promise<import('./morning-operation-evidence.js').Reservation>,
 * create:(payload:IssuePayload,assertCurrent:MorningAssertion)=>Promise<import('./morning-operation-evidence.js').CreatedDocument>,
 * abandonReservation:(operationId:string,assertCurrent:MorningAssertion)=>Promise<import('./morning-operation-evidence.js').Abandonment>
 * }} MorningOperationCommands */

/** The operation capability has no arbitrary action or PDF/search API. External
 * JSON stays unknown until the corresponding evidence decoder succeeds.
 * @param {{request:{json:(action:string,payload:Record<string,unknown>,assertCurrent:MorningAssertion)=>Promise<unknown>}}} ports
 * @returns {MorningOperationCommands}
 */
export function createMorningOperationCommands({request}){
  if(typeof request?.json!=='function')throw new TypeError('morning_operation_request_required');
  /** @param {string} action @param {Record<string,unknown>} payload @param {MorningAssertion} assertCurrent */
  async function read(action,payload,assertCurrent){
    assertCurrent();
    try{const value=await request.json(action,payload,assertCurrent);assertCurrent();return value}
    catch(error){assertCurrent();throw decodeMorningOperationFailure(error)}
  }
  /** @param {IssuePayload} payload @param {MorningAssertion} assertCurrent */
  async function reserve(payload,assertCurrent){const id=payload.operation_id;return decodeMorningReservation(await read('reserve',payload,assertCurrent),id)}
  /** @param {IssuePayload} payload @param {MorningAssertion} assertCurrent */
  async function create(payload,assertCurrent){
    const expected={operation_id:payload.operation_id,document:{type:payload.document.type,amount:payload.document.amount}};
    return decodeMorningCreatedDocument(await read('create',payload,assertCurrent),expected);
  }
  return {
    status:async(operationId,reconcile,assertCurrent)=>decodeMorningOperationStatus(await read('status',{operation_id:operationId,reconcile},assertCurrent),operationId),
    reserve,create,
    abandonReservation:async(operationId,assertCurrent)=>decodeMorningAbandonment(await read('abandon_reservation',{operation_id:operationId},assertCurrent),operationId),
  };
}
