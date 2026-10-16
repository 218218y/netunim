// @ts-check
import {creditResponseProtocol,assertCreditProfileTransactions} from './credit-transaction-evidence.js';
/** @typedef {Readonly<Record<string,unknown>>} CreditIssue */
/** @typedef {Readonly<Record<string,unknown>&{profiles:CreditStatusProfile[],errors?:CreditIssue[],attemptedCount?:number,deferredCount?:number}>} CreditRefreshResult */
/** @typedef {Readonly<Record<string,unknown>&{profileId:string}>} CreditStatusProfile */

/** @param {unknown} value @returns {value is Record<string,unknown>} */
export function creditRefreshRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function invalid() {
  return Object.assign(
    new Error('Bank Bridge החזיר ראיות סנכרון אשראי לא תקינות'),
    {
      code: 'CREDIT_REFRESH_RESULT_INVALID',
      retryable: false
    }
  );
}
/** @param {unknown} value @returns {CreditIssue[]} */
function rows(value) {
  if (!Array.isArray(value) || !Array.from(value).every(creditRefreshRecord))
    throw invalid();
  return value.map(row => Object.freeze(structuredClone(row)));
}

/**
 * Validate the network envelope before counters can skip a provider result or
 * diagnostics can enter Finance. Issuer amounts/months remain with the existing
 * credit model decoder; this envelope is not a financial write receipt.
 * Optional counters remain optional for supported older Bridge responses.
 * @param {unknown} value @returns {CreditRefreshResult}
 */
export function readCreditRefreshResult(value) {
  if (!creditRefreshRecord(value)) throw invalid();
  const protocol=creditResponseProtocol(value.contractVersion);
  const accepted=profiles(value.profiles);
  for(const profile of accepted)assertCreditProfileTransactions(profile,protocol);
  /** @type {Record<string,unknown>&{profiles:CreditStatusProfile[],errors?:CreditIssue[],attemptedCount?:number,deferredCount?:number}} */
  const decoded = { ...value, profiles: accepted };
  for (const field of /** @type {const} */ (['attemptedCount', 'deferredCount'])) {
    const count = value[field];
    if (
      count !== undefined &&
      (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0)
    )
      throw invalid();
    if (count !== undefined) decoded[field] = count;
  }
  if (value.errors !== undefined) decoded.errors = rows(value.errors);
  return Object.freeze(decoded);
}

/** @param {unknown} status @returns {CreditStatusProfile[]} */
export function readCreditStatusProfiles(status) {
  if (!creditRefreshRecord(status)) throw invalid();
  if (status.profiles === undefined) return [];
  return profiles(status.profiles);
}
/** @param {unknown} value @returns {CreditStatusProfile[]} */
function profiles(value) {
  return rows(value).map(profile => {
    if (typeof profile.profileId !== 'string' || !profile.profileId.trim())
      throw invalid();
    return Object.freeze({ ...profile, profileId: profile.profileId });
  });
}

/**
 * A malformed HTTP error keeps its transport failure but gets no diagnostic
 * publication or cooldown authority. Do not keep a subset of invalid evidence.
 * @param {unknown} error @returns {CreditIssue[]}
 */
export function readCreditFailureIssues(error) {
  if (!creditRefreshRecord(error) || error.creditErrors === undefined)
    return [];
  try {
    return rows(error.creditErrors);
  } catch {
    return [];
  }
}
/** @param {CreditIssue[]} issues */
export function creditIssuesDeferred(issues) {
  return (
    issues.length > 0 &&
    issues.every(
      issue => issue.severity === 'deferred' || issue.deferred === true
    )
  );
}
/** @param {unknown} error */
export function creditRefreshScopeChanged(error) {
  return (
    creditRefreshRecord(error) &&
    [
      'FINANCE_OPERATION_SCOPE_CHANGED',
      'CREDIT_CONNECTION_SCOPE_CHANGED',
      'BRIDGE_PAIRING_SCOPE_CHANGED'
    ].includes(String(error.code))
  );
}
