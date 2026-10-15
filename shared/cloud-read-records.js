// @ts-check
import {assertStorageJson} from './storage-json-codec.js';

/** @typedef {import('./storage-json.js').StorageJson} Json */
/** @typedef {import('./storage-json.js').StorageJsonObject} JsonObject */
/** @typedef {JsonObject & {document_name:string,revision:number,updated_at:string}} CloudMeta */
/** @typedef {CloudMeta & {state:JsonObject}} CloudDocument */
/** @typedef {JsonObject & {id:number,revision:number,saved_at:string}} BackupMeta */
/** @typedef {BackupMeta & {state:JsonObject}} BackupPoint */

function invalid(){return Object.assign(new Error('cloud_read_evidence_invalid'),{code:'CLOUD_READ_EVIDENCE_INVALID',retryable:false})}
/** @param {Json|undefined} value @returns {value is JsonObject} */
function object(value){return value!==null&&typeof value==='object'&&!Array.isArray(value)}
/** @param {Json|undefined} value @returns {value is number} */
function positiveInteger(value){return typeof value==='number'&&Number.isSafeInteger(value)&&value>0}
/** @param {Json|undefined} value @returns {value is string} */
function timestamp(value){
  if(typeof value!=='string')return false;
  const match=/^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  if(!match||!Number.isFinite(Date.parse(value)))return false;
  const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]),date=new Date(0);
  date.setUTCFullYear(year,month-1,day);
  return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day;
}
/** @param {unknown} response @returns {Json[]} */
function rows(response){
  const json=assertStorageJson(response);
  if(!Array.isArray(json))throw invalid();
  return json;
}
/** @param {unknown} response @returns {Json|null} */
function single(response){
  const values=rows(response);
  if(values.length>1||values.length===1&&values[0]===null)throw invalid();
  return values[0]??null;
}
/** @param {Json} value @param {string} documentName @returns {value is CloudMeta} */
function metadata(value,documentName){
  return object(value)&&value.document_name===documentName&&positiveInteger(value.revision)&&timestamp(value.updated_at);
}

// SQL REST reads return an array, including [] for a missing document. A broken
// response is never absence, a numeric string revision or a selected first row.
/** @param {unknown} response @param {string} documentName @returns {CloudMeta|null} */
export function readCloudMetaRows(response,documentName){
  const value=single(response);
  if(value===null)return null;
  if(!metadata(value,documentName))throw invalid();
  return structuredClone(value);
}
/** @param {unknown} response @param {string} documentName @returns {CloudDocument|null} */
export function readCloudDocumentRows(response,documentName){
  const value=readCloudMetaRows(response,documentName);
  if(value===null)return null;
  const state=value.state;
  if(!object(state))throw invalid();
  return {...value,state};
}

// Optional historical sections remain absent/null. Current sections cannot be
// arrays or coercible financial/snapshot authority. Provider-specific rows keep
// their existing decoders; this boundary never normalizes malformed evidence.
/** @param {unknown} response @param {string} documentName @returns {CloudDocument|null} */
export function readFinanceDocumentRows(response,documentName){
  const value=readCloudDocumentRows(response,documentName);
  if(value===null)return null;
  for(const field of ['bank','creditSync']){
    const section=value.state[field];
    if(section!=null&&!object(section))throw invalid();
  }
  const bank=value.state.bank;
  if(object(bank)){
    if(bank.currentBalance!=null&&(typeof bank.currentBalance!=='number'||!Number.isFinite(bank.currentBalance)))throw invalid();
    if(bank.snapshotSeq!=null&&(typeof bank.snapshotSeq!=='number'||!Number.isSafeInteger(bank.snapshotSeq)||bank.snapshotSeq<0))throw invalid();
    if(bank.snapshotToken!=null&&(typeof bank.snapshotToken!=='string'||!bank.snapshotToken.trim()))throw invalid();
    for(const field of ['adjustments','feed','homeFeed']){
      const data=bank[field];
      if(data!=null&&(field==='adjustments'?!Array.isArray(data):!object(data)))throw invalid();
    }
  }
  const credit=value.state.creditSync;
  if(object(credit)&&credit.profiles!=null&&(!Array.isArray(credit.profiles)||credit.profiles.some(profile=>!object(profile))))throw invalid();
  return value;
}

/** @param {Json} value @returns {value is BackupMeta} */
function backup(value){return object(value)&&positiveInteger(value.id)&&positiveInteger(value.revision)&&timestamp(value.saved_at)}
/** @param {unknown} response @returns {BackupMeta[]} */
export function readCloudBackupRows(response){
  const result=[],ids=new Set();
  for(const value of rows(response)){
    if(!backup(value)||ids.has(value.id))throw invalid();
    ids.add(value.id);result.push(structuredClone(value));
  }
  return result;
}
/** @param {unknown} response @param {number|null} [expectedId] @param {string|null} [notAfter] @returns {BackupPoint|null} */
export function readCloudBackupPointRows(response,expectedId=null,notAfter=null){
  const values=readCloudBackupRows(response);
  if(values.length>1)throw invalid();
  const value=values[0];
  if(!value)return null;
  if(expectedId!==null&&value.id!==expectedId)throw invalid();
  if(notAfter!==null&&(!timestamp(notAfter)||Date.parse(value.saved_at)>Date.parse(notAfter)))throw invalid();
  const state=value.state;
  if(!object(state))throw invalid();
  return {...value,state};
}
