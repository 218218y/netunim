// @ts-check
import { errorFetchStatus, safeSuffix } from './credit-value-codec.mjs';
import { VISA_CAL_PROVIDER_SCHEMA_VERSION } from './credit-adapter-wire.mjs';

/** @typedef {Pick<import('./credit-model-contracts.js').CreditMonthSlice,'month'|'tier'>} MonthPlan */
/** @typedef {Omit<import('./credit-model-contracts.js').CreditMonthSlice,'status'>} Coverage */
/** @param {unknown} error @param {string} key @returns {unknown} */
function field(error,key){return error!==null&&typeof error==='object'&&key in error?/** @type {Record<string,unknown>} */ (error)[key]:undefined}
/** @param {MonthPlan} plan @param {unknown} error @param {string} at @returns {Coverage & {fetchStatus:Exclude<Coverage['fetchStatus'],'success'>,fetchedAt:null}} */
export function monthlyCoverageFailure(plan, error, at) {
  return {
    month: plan.month,
    tier: plan.tier,
    fetchStatus: errorFetchStatus(error),
    fetchedAt: null,
    transactions: [],
    providerSchemaVersion: VISA_CAL_PROVIDER_SCHEMA_VERSION,
    lastErrorCode: String(field(error,'code') || 'CREDIT_PROVIDER_DATA_ERROR'),
    lastErrorAt: at,
  };
}

/** @param {MonthPlan} plan @param {import('./credit-model-contracts.js').CreditScrapeTransaction[]} transactions @param {string} at @param {string} [schemaVersion] @returns {Coverage & {fetchStatus:'success',fetchedAt:string,lastErrorAt:null}} */
export function monthlyCoverageSuccess(
  plan,
  transactions,
  at,
  schemaVersion = VISA_CAL_PROVIDER_SCHEMA_VERSION
) {
  return {
    month: plan.month,
    tier: plan.tier,
    fetchStatus: 'success',
    fetchedAt: at,
    transactions,
    providerSchemaVersion: schemaVersion,
    lastErrorCode: '',
    lastErrorAt: null,
  };
}

/** @param {Pick<import('./credit-model-contracts.js').CreditProfileInput,'profileId'|'provider'|'label'>} profile @param {unknown} error @param {{month?:string,tier?:string,accountNumber?:string,at?:string,component?:string,severity?:string}} [options] */
export function coverageError(
  profile,
  error,
  {
    month = '',
    tier = '',
    accountNumber = '',
    at = new Date().toISOString(),
    component = '',
    severity = '',
  } = {}
) {
  const stage = String(field(error,'stage') || 'Transactions').slice(0, 80),
    resolvedComponent =
      component ||
      (tier === 'core'
        ? 'core_transactions'
        : tier === 'forecast'
          ? 'forecast_transactions'
          : stage === 'Frames'
            ? 'frames'
            : stage === 'Pending'
              ? 'pending'
              : 'profile'),
    resolvedSeverity =
      severity || (resolvedComponent === 'core_transactions' ? 'error' : 'warning');
  return {
    profileId: profile.profileId,
    provider: profile.provider,
    label: profile.label,
    code: String(field(error,'code') || 'CREDIT_PROVIDER_DATA_ERROR'),
    stage,
    httpStatus: Number(field(error,'httpStatus')) || 0,
    message: field(error,'message') || 'קריאת נתוני האשראי נכשלה',
    at,
    originalFailureAt: field(error,'originalFailureAt') || at,
    retryAfterAt: field(error,'retryAfterAt') || null,
    month,
    tier,
    component: resolvedComponent,
    severity: resolvedSeverity,
    accountSuffix: safeSuffix(accountNumber),
  };
}
