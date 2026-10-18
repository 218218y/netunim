// @ts-check
import { readBankMoney as number } from './bank-money-value.js';
import {readBankTransactions} from './bank-transaction-evidence.js';
import { observationTimeMs } from './observation-time.js';

const bankAccountEvidence = Symbol('bank_account_evidence');
/** @typedef {Readonly<Record<string,unknown>&{balance:number,availableBalance:number|null,creditLimit:number|null,creditLimitUsed:number|null,creditLimitUsedPercent:number|null,[bankAccountEvidence]:true}>} BankAccountSnapshot */
/** @typedef {Readonly<{source:Readonly<Record<string,unknown>>,business:BankAccountSnapshot,home:BankAccountSnapshot|null,homeFailure:unknown}>} BankBalanceResult */
/** @typedef {Readonly<{availableBalance:number|null,creditLimit:number|null,creditLimitUsed:number|null,creditLimitUsedPercent:number|null}>} BankSnapshotFinancials */
/** @type {WeakSet<object>} */
const validatedAccounts = new WeakSet();

/** @param {unknown} value @returns {value is Record<string,unknown>} */
function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
/** @param {'business'|'home'} role */
function invalidBalance(role) {
  return Object.assign(
    new Error(
      role === 'home'
        ? 'Bank Bridge לא החזיר יתרה ביתית תקינה'
        : 'Bank Bridge לא החזיר יתרה עסקית תקינה'
    ),
    { code: 'BANK_BALANCE_INVALID', retryable: false }
  );
}
function invalidObservationTime() {
  return Object.assign(new Error('Bank Bridge returned an invalid observation time'), {
    code: 'BANK_OBSERVATION_TIME_INVALID', retryable: false
  });
}
/** @param {unknown} value @param {'business'|'home'} role @returns {BankAccountSnapshot} */
function account(value, role) {
  const balance = record(value) ? number(value.balance) : null;
  if (!record(value) || balance === null) throw invalidBalance(role);
  const coverage=record(value.transactionCoverage)?value.transactionCoverage:null;
  if(coverage?.complete===true&&!Array.isArray(value.transactions)){
    throw Object.assign(new Error('Bank Bridge הצהיר על היסטוריה מלאה ללא רשימת תנועות תקינה'),{
      code:'BANK_TRANSACTIONS_INVALID',retryable:false,
    });
  }
  /** @type {BankAccountSnapshot} */
  const decoded = Object.freeze({
    ...value,
    ...(value.transactions!==undefined||coverage?.complete===true?{transactions:readBankTransactions(value.transactions)}:{}),
    ...(coverage?{transactionCoverage:Object.freeze({...coverage})}:{}),
    balance,
    availableBalance: number(value.availableBalance),
    creditLimit: number(value.creditLimit),
    creditLimitUsed: number(value.creditLimitUsed),
    creditLimitUsedPercent: number(value.creditLimitUsedPercent),
    [bankAccountEvidence]: /** @type {true} */ (true),
  });
  validatedAccounts.add(decoded);
  return decoded;
}

/**
 * Current dual-account and existing flat-result formats share one financial
 * boundary. Validate both accounts before any archive or durable publication.
 * Issuer transactions, account metadata and partial-home failure policy remain
 * with their current owners; this decoder does not grant a cloud ACK.
 * @param {unknown} value @param {number} [now] @returns {BankBalanceResult}
 */
export function readBankBalanceResult(value, now = Date.now()) {
  if (!record(value)) throw invalidBalance('business');
  // Only legacy balance-only reads may use a local display time. Transaction
  // evidence must carry the Bridge observation that produced it.
  const fetchedAt = value.fetchedAt === undefined ? new Date(now).toISOString() : value.fetchedAt;
  const observedAt = observationTimeMs(fetchedAt, now);
  if (observedAt === null)
    throw invalidObservationTime();
  const accounts = record(value.accounts) ? value.accounts : null;
  const business = account(accounts?.business || value, 'business');
  const home = accounts?.home ? account(accounts.home, 'home') : null;
  if (value.fetchedAt === undefined && [business, home].some(snapshot =>
    snapshot && (snapshot.transactions !== undefined || snapshot.transactionCoverage !== undefined)
  )) throw invalidObservationTime();
  const failures = record(value.accountFailures) ? value.accountFailures : null;
  const homeFailure = failures?.home || null;
  // Feed normalization already uses canonical UTC timestamps. Capture the same
  // representation before journaling so later normalization cannot change the
  // committed bankSyncAt or archive readout signature for an equivalent instant.
  return Object.freeze({ source: Object.freeze({ ...value, fetchedAt: new Date(observedAt).toISOString() }), business, home, homeFailure });
}

/** A durable snapshot requires a Bridge clock even for a balance-only result.
 * Historical balance-only readers continue to use readBankBalanceResult.
 * @param {unknown} value @param {number} [now] @returns {BankBalanceResult}
 */
export function readBankSnapshotResult(value, now = Date.now()) {
  if (!record(value) || observationTimeMs(value.fetchedAt, now) === null)
    throw invalidObservationTime();
  return readBankBalanceResult(value, now);
}

/**
 * The actual publication-field consumer retains nullable financial values.
 * Its evidence must be produced by this decoder, not a forged object/copy.
 * @param {BankAccountSnapshot} snapshot @returns {BankSnapshotFinancials}
 */
export function bankSnapshotFinancials(snapshot) {
  if (!record(snapshot) || !validatedAccounts.has(snapshot)) throw invalidBalance('business');
  return Object.freeze({
    availableBalance: snapshot.availableBalance,
    creditLimit: snapshot.creditLimit,
    creditLimitUsed: snapshot.creditLimitUsed,
    creditLimitUsedPercent: snapshot.creditLimitUsedPercent,
  });
}
