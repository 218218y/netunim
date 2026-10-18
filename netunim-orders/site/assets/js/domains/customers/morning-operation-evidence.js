// @ts-check
import {evidenceTimestamp} from '../../shared/response-evidence.js';
/** @typedef {'reserved'|'pending'|'created_unverified'|'needs_reconciliation'|'created'|'failed'} OperationState */
/** @typedef {{operation_id:string,state:OperationState,document_type?:number,amount?:number,document_id?:string,document_number?:string|number,verified_at?:string,allocation_number?:string|number}} LedgerOperation */
/** @typedef {{pending?:boolean,operationId?:string,documentId?:string,documentNumber?:string|number,documentType?:number,documentAmount?:number,transactionId?:number,linkId?:number,verifiedAt?:string,handledAt?:string}} BankLink */
/** @typedef {{ok:true,operation:LedgerOperation|null,configured?:boolean,available?:boolean,unresolved?:boolean,retryable_reserved?:boolean,environment?:string,checks_registration_pending?:boolean,bank_link_pending?:boolean,bank_link?:BankLink|null}} OperationStatus */
/** @typedef {{ok:true,reserved:boolean,operation:{operation_id:string,state:OperationState}}} Reservation */
/** @typedef {{id:string,type:number,amount:number,number?:string|number,allocationNumber?:string|number}} OfficialDocument */
/** @typedef {{ok:true,verified:true,document:OfficialDocument,local_link_pending?:boolean,checks_registration_pending?:boolean,bank_link_pending?:boolean,bank_link?:BankLink|null}} CreatedDocument */
/** @typedef {{ok:true,abandoned:boolean,operation:LedgerOperation|null}} Abandonment */
/** @typedef {{operation_id?:string,prevent_retry?:boolean,uncertain?:boolean,document?:{id:string,number?:string|number,allocationNumber?:string|number}}} FailureDetails */

function invalid(){return Object.assign(new Error('תשובת Morning אינה תואמת לפעולה המבוקשת. נקודת ההתאוששות נשמרת עד לאימות תקין.'),{code:'morning_operation_response_invalid'})}
/** @param {unknown} value @returns {Record<string,unknown>} */
function record(value){if(value===null||typeof value!=='object'||Array.isArray(value))throw invalid();return /** @type {Record<string,unknown>} */ (value)}
/** @param {unknown} value */
function identity(value){if(typeof value!=='string'||!value.trim()||value!==value.trim()||value.length>160)throw invalid();return value}
/** @param {unknown} value */
function flag(value){if(typeof value!=='boolean')throw invalid();return value}
/** @param {unknown} value @returns {OperationState} */
function state(value){switch(value){case 'reserved':case 'pending':case 'created_unverified':case 'needs_reconciliation':case 'created':case 'failed':return value;default:throw invalid()}}
/** SQL numeric columns may arrive as decimal text. Booleans, nulls, display
 * formatting and sub-cent values never become financial authority.
 * @param {unknown} value
 */
function amount(value){
  if(typeof value!=='number'&&(typeof value!=='string'||!/^\d+(?:\.\d+)?$/.test(value)))throw invalid();
  const result=Number(value),cents=result*100;
  if(!Number.isFinite(result)||result<=0||!Number.isSafeInteger(Math.round(cents))||Math.abs(cents-Math.round(cents))>0.000001)throw invalid();
  return result;
}
/** @param {unknown} value */
function documentType(value){if(value!==305&&value!==320&&value!==400)throw invalid();return value}
/** @param {unknown} value */
function date(value){if(!evidenceTimestamp(value)||value.length>80)throw invalid();return value}
/** @param {unknown} value */
function numberLabel(value){if(typeof value==='string'&&value.length<=160)return value;if(typeof value==='number'&&Number.isSafeInteger(value))return value;throw invalid()}
/** @param {unknown} value */
function positiveId(value){if(typeof value!=='number'||!Number.isSafeInteger(value)||value<=0)throw invalid();return value}
/** @param {unknown} value */
function success(value){const row=record(value);if(row.ok!==true)throw invalid();return row}
/** @param {unknown} value @param {string} expectedId @returns {BankLink|null} */
function bankLink(value,expectedId){
  if(value===null)return null;const row=record(value);
  /** @type {BankLink} */ const result={};
  if(row.pending!==undefined)result.pending=flag(row.pending);
  if(row.operationId!==undefined){result.operationId=identity(row.operationId);if(result.operationId!==expectedId)throw invalid()}
  if(row.documentId!==undefined)result.documentId=identity(row.documentId);
  if(row.documentNumber!==undefined&&row.documentNumber!==null)result.documentNumber=numberLabel(row.documentNumber);
  if(row.documentType!==undefined)result.documentType=documentType(row.documentType);
  if(row.documentAmount!==undefined)result.documentAmount=amount(row.documentAmount);
  if(row.transactionId!==undefined&&row.transactionId!==null)result.transactionId=positiveId(row.transactionId);
  if(row.linkId!==undefined&&row.linkId!==null)result.linkId=positiveId(row.linkId);
  if(row.verifiedAt!==undefined&&row.verifiedAt!==null)result.verifiedAt=date(row.verifiedAt);
  if(row.handledAt!==undefined&&row.handledAt!==null)result.handledAt=date(row.handledAt);
  return result;
}
/** @param {BankLink|null|undefined} link @param {{id?:string|undefined,type?:number|undefined,amount?:number|undefined}} document @param {boolean|undefined} pending */
function linkedDocument(link,document,pending){
  if(!link)return;
  if(link.pending===true&&pending!==true)throw invalid();
  if(link.pending!==undefined&&pending!==undefined&&link.pending!==pending)throw invalid();
  if(link.documentId!==undefined&&document.id!==undefined&&link.documentId!==document.id)throw invalid();
  if(link.documentType!==undefined&&document.type!==undefined&&link.documentType!==document.type)throw invalid();
  if(link.documentAmount!==undefined&&document.amount!==undefined&&Math.round(link.documentAmount*100)!==Math.round(document.amount*100))throw invalid();
}
/** A ledger row must belong to the exact request before any terminal cleanup.
 * Historical textual document identities remain readable.
 * @param {unknown} value @param {string} expectedId @returns {LedgerOperation|null}
 */
function operation(value,expectedId){
  if(value===null||value===undefined)return null;const row=record(value),operationId=identity(row.operation_id);
  if(!expectedId||operationId!==expectedId)throw invalid();
  /** @type {LedgerOperation} */ const result={operation_id:operationId,state:state(row.state)};
  if(row.document_type!==undefined&&row.document_type!==null)result.document_type=documentType(row.document_type);
  if(row.amount!==undefined&&row.amount!==null)result.amount=amount(row.amount);
  if(row.document_id!==undefined&&row.document_id!==null)result.document_id=identity(row.document_id);
  if(row.document_number!==undefined&&row.document_number!==null)result.document_number=numberLabel(row.document_number);
  if(row.verified_at!==undefined&&row.verified_at!==null)result.verified_at=date(row.verified_at);
  if(row.allocation_number!==undefined&&row.allocation_number!==null)result.allocation_number=numberLabel(row.allocation_number);
  if(result.state==='created'&&(!result.document_id||!result.verified_at||result.document_type===undefined||result.amount===undefined))throw invalid();
  return result;
}
/** @param {unknown} value @param {string} expectedId @returns {OperationStatus} */
export function decodeMorningOperationStatus(value,expectedId){
  const row=success(value);
  /** @type {OperationStatus} */ const result={ok:true,operation:operation(row.operation,expectedId)};
  for(const name of /** @type {const} */ (['configured','available','unresolved','retryable_reserved','checks_registration_pending','bank_link_pending']))if(row[name]!==undefined)result[name]=flag(row[name]);
  if(row.environment!==undefined){if(typeof row.environment!=='string'||row.environment.length>40||(result.configured!==false&&!['production','sandbox'].includes(row.environment)))throw invalid();result.environment=row.environment}
  if(row.bank_link!==undefined)result.bank_link=bankLink(row.bank_link,expectedId);
  const ledger=result.operation;
  linkedDocument(result.bank_link,{id:ledger?.document_id,type:ledger?.document_type,amount:ledger?.amount},result.bank_link_pending);
  if(result.retryable_reserved===true&&ledger?.state!=='reserved')throw invalid();
  return result;
}
/** Reservation replies intentionally contain only identity and state.
 * @param {unknown} value @param {string} expectedId @returns {Reservation}
 */
export function decodeMorningReservation(value,expectedId){
  const row=success(value),ledger=record(row.operation),operationId=identity(ledger.operation_id);
  if(operationId!==expectedId)throw invalid();
  return {ok:true,reserved:flag(row.reserved),operation:{operation_id:operationId,state:state(ledger.state)}};
}
/** @param {unknown} value @param {{operation_id:string,document:{type:number,amount:number}}} payload @returns {CreatedDocument} */
export function decodeMorningCreatedDocument(value,payload){
  const row=success(value),doc=record(row.document);if(row.verified!==true)throw invalid();
  /** @type {OfficialDocument} */ const document={id:identity(doc.id),type:documentType(doc.type),amount:amount(doc.amount)};
  if(document.type!==payload.document.type||Math.round(document.amount*100)!==Math.round(payload.document.amount*100))throw invalid();
  if(doc.number!==undefined&&doc.number!==null)document.number=numberLabel(doc.number);
  if(doc.allocationNumber!==undefined&&doc.allocationNumber!==null)document.allocationNumber=numberLabel(doc.allocationNumber);
  /** @type {CreatedDocument} */ const result={ok:true,verified:true,document};
  for(const name of /** @type {const} */ (['local_link_pending','checks_registration_pending','bank_link_pending']))if(row[name]!==undefined)result[name]=flag(row[name]);
  if(row.bank_link!==undefined)result.bank_link=bankLink(row.bank_link,payload.operation_id);
  linkedDocument(result.bank_link,document,result.bank_link_pending);
  return result;
}
/** @param {unknown} value @param {string} expectedId @returns {Abandonment} */
export function decodeMorningAbandonment(value,expectedId){
  const row=success(value),abandoned=flag(row.abandoned),ledger=operation(row.operation,expectedId);
  if(abandoned&&ledger?.state!=='failed')throw invalid();
  return {ok:true,abandoned,operation:ledger};
}
/** Error details can change retry/recovery policy too. A malformed rejection
 * loses that authority, including its supposedly safely retryable HTTP status.
 * A valid deduplication error may intentionally identify an earlier operation.
 * @param {unknown} value @returns {Error & {code:string,status?:number,details?:FailureDetails}}
 */
export function decodeMorningOperationFailure(value){
  const source=record(value),error=value instanceof Error?value:new Error('שירות Morning אינו זמין');
  /** @type {Error & {code:string,status?:number,details?:FailureDetails}} */
  const result=Object.assign(new Error(error.message),{code:typeof source.code==='string'?source.code:'morning_backend_unreachable'});
  if(source.status!==undefined){if(typeof source.status!=='number'||!Number.isInteger(source.status)||source.status<400||source.status>599)throw invalid();result.status=source.status}
  if(source.details!==undefined){
    const row=record(source.details);
    /** @type {FailureDetails} */ const details={};
    if(row.operation_id!==undefined){const id=identity(row.operation_id);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))throw invalid();details.operation_id=id}
    for(const name of /** @type {const} */ (['prevent_retry','uncertain']))if(row[name]!==undefined)details[name]=flag(row[name]);
    if(row.document!==undefined){const doc=record(row.document);details.document={id:identity(doc.id)};if(doc.number!==undefined&&doc.number!==null)details.document.number=numberLabel(doc.number);if(doc.allocationNumber!==undefined&&doc.allocationNumber!==null)details.document.allocationNumber=numberLabel(doc.allocationNumber)}
    result.details=details;
  }else if(result.status!==undefined)throw invalid();
  return result;
}
