// @ts-check
import {readFinanceLeaseReceipt} from './finance-lease-receipt.js';
/** @typedef {import('./finance-lease-receipt.js').FinanceLeaseName} LeaseName */
/** @typedef {()=>undefined} LeaseGuard */
/** @typedef {{assertCurrent?:LeaseGuard,ttlSeconds?:number}} LeaseOptions */
/** @typedef {{method:'POST',body:string,networkRetry:true,assertRequestScope?:LeaseGuard}} LeaseRequest */
/** @typedef {{ok:boolean,text:()=>Promise<string>}} LeaseResponse */
/** @typedef {(path:string,options:LeaseRequest)=>Promise<LeaseResponse>} LeaseFetch */
/** @param {unknown} value @returns {value is Record<string,unknown>} */
function object(value){return value!==null&&typeof value==='object'&&!Array.isArray(value)}
/** @param {unknown} value */
function errorMessage(value){return object(value)?String(value.message||value.hint||''):''}
/** @param {unknown} value @returns {LeaseName} */
function financeLeaseName(value){const name=String(value||'').trim();if(name!=='bank'&&name!=='credit')throw new Error('סוג נעילת הסינכרון הפיננסי אינו תקין');return name}
/** @param {string} body @returns {unknown} */
function json(body){try{return body?JSON.parse(body):null}catch{return null}}
/** @param {unknown} response @returns {boolean} */
export function readFinanceLeaseRelease(response){
 const value=Array.isArray(response)?response.length===1?response[0]:null:response;
 if(typeof value==='boolean')return value;
 if(object(value)&&typeof value.released==='boolean')return value.released;
 throw Object.assign(new Error('לא התקבל אישור תקין לשחרור נעילת הסינכרון.'),{code:'FINANCE_LEASE_RELEASE_INVALID',kind:'confirmation_unknown',retryable:false});
}
/**
 * Both applications use the same unknown network boundary. Account authority
 * brackets request, body and rejection; no late reply may borrow a new login.
 * A release receipt supplies no document durability or publication evidence.
 * @param {{request:LeaseFetch,ttlSeconds?:number}} ports
 */
export function createFinanceLeaseTransport({request,ttlSeconds:defaultTtl=1200}){
 /** @param {LeaseName} leaseName @param {string} leaseToken @param {LeaseOptions} options @returns {Promise<import('./finance-lease-receipt.js').FinanceLeaseReceipt>} */
 async function claimFinanceSyncLease(leaseName,leaseToken,{ttlSeconds=defaultTtl,assertCurrent}={}){
  assertCurrent?.();
  const name=financeLeaseName(leaseName),token=String(leaseToken||'').trim(),ttl=Math.max(60,Math.min(1800,Math.trunc(Number(ttlSeconds)||defaultTtl)));
  if(!token)throw new Error('מזהה נעילת הסינכרון הפיננסי חסר');
  /** @type {LeaseResponse} */ let r;
  try{r=await request('/rest/v1/rpc/claim_finance_sync_lease',{method:'POST',body:JSON.stringify({p_lease_name:name,p_lease_token:token,p_ttl_seconds:ttl}),networkRetry:true,...(assertCurrent?{assertRequestScope:assertCurrent}:{})})}
  catch(error){assertCurrent?.();if(object(error)&&String(error.code||'').startsWith('SUPABASE_NETWORK_'))throw Object.assign(new Error('לא ניתן לקבל כרגע נעילת סינכרון מהענן. לא נפתחה כניסה לבנק או לחברת האשראי כדי למנוע סינכרון כפול ממחשב אחר.',{cause:error}),{code:'FINANCE_LEASE_CLOUD_UNAVAILABLE'});throw error}
  assertCurrent?.();
  /** @type {string} */ let body;
  try{body=await r.text()}catch(error){assertCurrent?.();throw error}
  assertCurrent?.();const value=json(body);
  if(!r.ok)throw new Error(errorMessage(value)||body||'תפיסת נעילת הסינכרון המשותפת נכשלה');
  return readFinanceLeaseReceipt(value,{leaseName:name,leaseToken:token});
 }
 /** @param {LeaseName} leaseName @param {string} leaseToken @param {Pick<LeaseOptions,'assertCurrent'>} options @returns {Promise<boolean>} */
 async function releaseFinanceSyncLease(leaseName,leaseToken,{assertCurrent}={}){
  assertCurrent?.();const name=financeLeaseName(leaseName),token=String(leaseToken||'').trim();if(!token)return false;
  /** @type {LeaseResponse} */ let r;
  try{r=await request('/rest/v1/rpc/release_finance_sync_lease',{method:'POST',body:JSON.stringify({p_lease_name:name,p_lease_token:token}),networkRetry:true,...(assertCurrent?{assertRequestScope:assertCurrent}:{})})}catch(error){assertCurrent?.();throw error}
  assertCurrent?.();
  /** @type {string} */ let body;
  try{body=await r.text()}catch(error){assertCurrent?.();throw error}
  assertCurrent?.();const value=json(body);
  if(!r.ok)throw new Error(errorMessage(value)||body||'שחרור נעילת הסינכרון המשותפת נכשל');
  return readFinanceLeaseRelease(value);
 }
 return {claimFinanceSyncLease,releaseFinanceSyncLease};
}
