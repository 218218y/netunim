// @ts-check
// Standalone so the browser and packaged Bridge execute the same contract.
/** @typedef {'pending'|'completed'} CreditTransactionStatus */
/** @typedef {'reported'|'missing'|'not_billed'} CreditChargeAmountStatus */
/** @typedef {Record<string,unknown> & {status:CreditTransactionStatus,chargeAmountStatus?:CreditChargeAmountStatus,foreignTransaction?:boolean,installments?:{number:number,total:number}|null}} CreditTransactionEvidence */
/** @param {unknown} value @returns {value is Record<string,unknown>} */
function object(value){return value!==null&&typeof value==='object'&&!Array.isArray(value)}
/** @param {unknown} value @returns {value is number|string} */
function money(value){
  return typeof value==='number'&&Number.isFinite(value)||
    typeof value==='string'&&/^-?\d+(?:\.\d+)?$/.test(value)&&Number.isFinite(Number(value));
}
/** @param {unknown} value @returns {value is number} */
function integer(value){return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0}

/** @returns {never} */
function invalid(){throw Object.assign(new Error('Credit transaction evidence is invalid'),{code:'CREDIT_REFRESH_RESULT_INVALID',retryable:false})}
/** Omission is the supported older-response path. A supplied value is evidence,
 * never a request for the persisted-feed normalizer to infer success.
 * @param {unknown} value @param {string[]} allowed */
function optionalEnum(value,allowed){
  if(value!==undefined&&(typeof value!=='string'||!allowed.includes(value)))invalid();
}
/** Merge keys must survive the existing feed normalizer byte-for-byte. Account
 * keys cannot contain the profile/account mapping delimiter; import profile IDs
 * intentionally can. Omitted partial-model fields remain supported.
 * @param {unknown} value @param {boolean} [account]
 * @returns {asserts value is string} */
export function assertCreditIdentity(value,account=false){
  if(typeof value!=='string'||!value||value.length>80||
    value!==value.trim().replace(/\s+/g,' ')||/[\u0000-\u001f\u007f]/.test(value)||
    account&&value.includes(':'))invalid();
}
/** The production handshake requires v2. Older responses can omit the envelope
 * version, but cannot downgrade transaction evidence to persisted-feed rules.
 * @param {unknown} version @returns {2} */
export function creditResponseProtocol(version){
  if(version===undefined||version===2)return 2;
  return invalid();
}
/** Validate every representation before a feed normalizer can deduplicate it.
 * @param {Record<string,unknown>} profile */
export function assertCreditProfileTransactions(profile){
  optionalEnum(profile.provider,['visaCal','max','isracard','amex']);
  optionalEnum(profile.defaultAccount,['עסקי','ביתי']);
  if(profile.profileId!==undefined)assertCreditIdentity(profile.profileId);
  // ownerLabel participates in automatic cross-profile identity reconciliation.
  // Cosmetic labels are intentionally outside this authority contract.
  if(profile.ownerLabel!==undefined&&(typeof profile.ownerLabel!=='string'||
    profile.ownerLabel.length>100||profile.ownerLabel!==profile.ownerLabel.trim().replace(/\s+/g,' ')||
    /[\u0000-\u001f\u007f]/.test(profile.ownerLabel)))invalid();
  if(profile.coreComplete!==undefined&&typeof profile.coreComplete!=='boolean')invalid();
  if(profile.accounts===undefined)return;
  if(!Array.isArray(profile.accounts))return invalid();
  const accounts=new Set();
  for(const account of Array.from(profile.accounts)){
    if(!object(account))return invalid();
    if(account.accountNumber!==undefined){
      assertCreditIdentity(account.accountNumber,true);
      if(accounts.has(account.accountNumber))invalid();
      accounts.add(account.accountNumber);
    }
    optionalEnum(account.pendingStatus,['success','provider_error','schema_error','network_error','missing']);
    optionalEnum(account.frameFetchStatus,['success','unavailable','provider_error','schema_error','network_error']);
    optionalEnum(account.frameStatus,['fresh','stale','missing']);
    amounts(account,['balance','cardFrame','availableCredit']);
    if(account.pendingStatus==='success'&&!Array.isArray(account.pendingTransactions))invalid();
    for(const field of ['txns','pendingTransactions','unassignedTransactions']){
      transactions(account[field]);
    }
    if(account.months===undefined)continue;
    if(!Array.isArray(account.months))return invalid();
    const months=new Set();
    for(const month of Array.from(account.months)){
      if(!object(month))return invalid();
      if(typeof month.month!=='string'||!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month.month)||months.has(month.month))invalid();
      months.add(month.month);
      optionalEnum(month.tier,['core','forecast']);
      optionalEnum(month.fetchStatus,['success','provider_error','schema_error','network_error']);
      optionalEnum(month.status,['fresh','stale','missing']);
      // Both paths authorize replacement in the retained-feed reader. An absent
      // list must never acquire the meaning of an explicitly empty successful list.
      if((month.fetchStatus==='success'||month.fetchStatus===undefined&&month.status==='fresh')&&
        !Array.isArray(month.transactions))invalid();
      transactions(month.transactions);
    }
  }
}
/** @param {unknown} value */
function transactions(value){
  if(value===undefined)return;
  if(!Array.isArray(value))return invalid();
  for(const tx of Array.from(value))assertCreditTransactionEvidence(tx);
}
/** @param {unknown} tx @returns {asserts tx is CreditTransactionEvidence} */
export function assertCreditTransactionEvidence(tx){
  if(!object(tx)||!(tx.status==='pending'||tx.status==='completed'))return invalid();
  amounts(tx,['originalAmount','chargedAmount']);
  if(tx.foreignTransaction!==undefined&&typeof tx.foreignTransaction!=='boolean')invalid();
  optionalEnum(tx.chargeAmountStatus,['reported','missing','not_billed']);
  if(tx.chargeAmountStatus==='reported'&&tx.chargedAmount==null)invalid();
  if(tx.installments!=null){
    const parts=tx.installments;
    if(!object(parts)||!integer(parts.number)||!integer(parts.total)||parts.number===0||parts.number>parts.total)invalid();
  }
}
/** Null/missing issuer amounts convey no evidence. Supplied amounts retain their
 * actual type before legacy normalization, which intentionally accepts old data.
 * @param {Record<string,unknown>} row @param {string[]} fields */
function amounts(row,fields){
  for(const field of fields)if(row[field]!=null&&!money(row[field]))invalid();
}
