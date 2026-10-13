// @ts-nocheck
import { errorFetchStatus, safeSuffix } from './credit-value-codec.mjs';
import { VISA_CAL_PROVIDER_SCHEMA_VERSION } from './credit-adapter-wire.mjs';

export function monthlyCoverageFailure(plan, error, at) {
  return {
    month: plan.month,
    tier: plan.tier,
    fetchStatus: errorFetchStatus(error),
    fetchedAt: null,
    transactions: [],
    providerSchemaVersion: VISA_CAL_PROVIDER_SCHEMA_VERSION,
    lastErrorCode: String(error?.code || 'CREDIT_PROVIDER_DATA_ERROR'),
    lastErrorAt: at,
  };
}

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
  const stage = String(error?.stage || 'Transactions').slice(0, 80),
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
    code: String(error?.code || 'CREDIT_PROVIDER_DATA_ERROR'),
    stage,
    httpStatus: Number(error?.httpStatus) || 0,
    message: error?.message || 'קריאת נתוני האשראי נכשלה',
    at,
    originalFailureAt: error?.originalFailureAt || at,
    retryAfterAt: error?.retryAfterAt || null,
    month,
    tier,
    component: resolvedComponent,
    severity: resolvedSeverity,
    accountSuffix: safeSuffix(accountNumber),
  };
}
