// @ts-check
import { readBankMoney as number } from './bank-money-value.js';
import {readBankTransactions} from './bank-transaction-evidence.js';

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
 * @param {unknown} value @returns {BankBalanceResult}
 */
export function readBankBalanceResult(value) {
  if (!record(value)) throw invalidBalance('business');
  const accounts = record(value.accounts) ? value.accounts : null;
  const business = account(accounts?.business || value, 'business');
  const home = accounts?.home ? account(accounts.home, 'home') : null;
  const failures = record(value.accountFailures) ? value.accountFailures : null;
  const homeFailure = failures?.home || null;
  return Object.freeze({ source: Object.freeze({ ...value }), business, home, homeFailure });
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
