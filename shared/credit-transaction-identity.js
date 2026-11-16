// @ts-check
/** @typedef {Record<string,unknown> & {installments?:{number?:unknown,total?:unknown}|null}} Transaction */
/** @param {unknown} v */
const value=v=>v??null;
/** @param {Transaction} tx */
const id=tx=>String(tx.id||tx.identifier||'');
/** @param {Transaction} tx */
const purchase=tx=>String(tx.transactionDate||tx.date||'');
/** @param {Transaction} tx */
const merchant=tx=>String(tx.description||'');
/** @param {Transaction} tx */
const parts=tx=>JSON.stringify([tx.installments?.number??null,tx.installments?.total??null]);

/** A provider ID identifies a source, not a unique monetary occurrence.
 * Exact repeated observations with an ID may be pagination mirrors at the feed
 * boundary. Anonymous observations retain their multiplicity. @param {Transaction} tx */
export function creditObservationKey(tx){
  return JSON.stringify([id(tx),value(tx.type),value(tx.status),value(tx.date),value(tx.processedDate),
    value(tx.transactionDate),value(tx.transactionTime),value(tx.originalAmount),value(tx.originalCurrency),
    value(tx.chargedAmount),value(tx.chargedCurrency),value(tx.chargeAmountStatus),value(tx.foreignTransaction),
    merchant(tx),value(tx.memo),tx.installments?.number??null,tx.installments?.total??null]);
}
/** Purchase evidence, scoped by the caller to one profile/account. Billing date
 * is deliberately absent: it is the destination being reconciled.
 * @param {Transaction} old @param {Transaction} next */
export function sameCreditSource(old,next){
  return id(old)===id(next)&&!!old.date&&old.date===next.date&&purchase(old)===purchase(next)&&
    merchant(old)===merchant(next)&&
    (old.transactionTime||'')===(next.transactionTime||'')&&
    old.originalAmount!=null&&!!old.originalCurrency&&old.originalAmount===next.originalAmount&&
    old.originalCurrency===next.originalCurrency&&parts(old)===parts(next)&&
    (old.chargedAmount==null||old.chargedAmount===next.chargedAmount&&old.chargedCurrency===next.chargedCurrency);
}
/** ID-less date/merchant/amount equality alone is ambiguous. Only an explicit
 * purchase minute can authorize an automatic anonymous transfer.
 * @param {Transaction} tx */
export function preciseCreditSource(tx){return !!id(tx)||!!merchant(tx)&&merchant(tx)!=='עסקת אשראי'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(tx.transactionTime||''))}
/** @param {Transaction} old @param {Transaction} next */
export function creditSourceTransfer(old,next){
  return (old.status||'completed')===(next.status||'completed')&&(old.type||'normal')===(next.type||'normal')&&
    (old.foreignTransaction===true)===(next.foreignTransaction===true)&&
    (old.chargeAmountStatus!=='not_billed'||next.chargeAmountStatus==='not_billed')&&
    (old.chargeAmountStatus!=='missing'||next.chargedAmount==null||next.chargeAmountStatus==='reported')&&
    sameCreditSource(old,next)&&preciseCreditSource(old);
}
/** This detects suspicion, not authority to delete either source.
 * @param {Transaction} source @param {Transaction} assigned */
export function creditPlacementOverlap(source,assigned){return sameCreditSource(source,assigned)||sameCreditSource(assigned,source)}
/** Only unknown -> reported enrichment, never a change to known money. Require
 * a stable source ID and unique matching on both sides at the merge owner.
 * @param {Transaction} old @param {Transaction} next */
export function creditAmountEnrichment(old,next){
  return !!id(old)&&old.status==='completed'&&next.status==='completed'&&old.chargedAmount==null&&
    old.chargeAmountStatus==='missing'&&next.chargeAmountStatus==='reported'&&
    typeof next.chargedAmount==='number'&&Number.isFinite(next.chargedAmount)&&
    old.processedDate===next.processedDate&&old.type===next.type&&
    old.foreignTransaction===next.foreignTransaction&&sameCreditSource(old,next);
}
/** Pending/final correlation requires purchase evidence in addition to an ID.
 * Anonymous correlation requires the precise minute. Consume occurrences once.
 * @param {Transaction} tx */
export function creditPendingSourceKey(tx){
  if(!purchase(tx)||tx.originalAmount==null||!tx.originalCurrency||!merchant(tx)||!preciseCreditSource(tx))return '';
  return JSON.stringify([id(tx),purchase(tx),tx.transactionTime||'',merchant(tx),tx.originalAmount,tx.originalCurrency,parts(tx)]);
}
