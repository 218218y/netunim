import {monthlyCoverageFailure,monthlyCoverageSuccess,coverageError} from '../../netunim-kupa/bank-bridge/credit-coverage.mjs';
import {buildCreditMonthPlan} from '../../netunim-kupa/bank-bridge/credit-month-plan.mjs';
const failed=monthlyCoverageFailure({month:'2026-12',tier:'core'},new Error('network'),'2026-10-25T00:00:00Z');
// @ts-expect-error failed fetch cannot certify successful coverage
/** @type {'success'} */ const success=failed.fetchStatus;
// @ts-expect-error failed coverage cannot supply a fetch timestamp
/** @type {string} */ const fetched=failed.fetchedAt;
const saved=monthlyCoverageSuccess({month:'2026-12',tier:'forecast'},[],'2026-10-25T00:00:00Z');
/** @type {'success'} */ const status=saved.fetchStatus;
// @ts-expect-error unsupported tier is not monthly coverage
monthlyCoverageSuccess({month:'2026-12',tier:'saved'},[],'now');
// @ts-expect-error diagnostics cannot invent a provider identity
coverageError({profileId:'P',label:'test',provider:'other'},new Error());
// @ts-expect-error a transaction status cannot be a UI confirmation
monthlyCoverageSuccess({month:'2026-12',tier:'core'},[{id:'T',status:'saved'}],'now');
// @ts-expect-error horizon cannot be supplied as a formatted string
buildCreditMonthPlan({futureMonths:'12'});
void [success,fetched,status];
