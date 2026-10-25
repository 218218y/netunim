import {creditTransactionAmountData,creditBillingModelData,creditAccountUpcomingChargeData,creditCyclesThroughHorizonData} from '../../shared/credit-billing-cycles.js';
import {normalizeCreditCardAccountTransitions,creditCardAccountForDateData} from '../../shared/credit-card-account.js';

const amount=creditTransactionAmountData({status:'pending',originalAmount:-12,originalCurrency:'ILS'});
/** @type {number} */ const value=amount.amount;
if(amount.included){/** @type {number} */ const reported=amount.rawAmount;void reported}
else {
  /** @type {0} */ const excluded=amount.amount;
  /** @type {'foreign_only'|'unknown'} */ const reason=amount.source;
  void [excluded,reason];
}
if(amount.source==='unknown'){/** @type {null} */ const missing=amount.rawAmount;void missing}
if(amount.source==='original_ils_estimate'){
  /** @type {true} */ const estimated=amount.estimated;
  /** @type {'ILS'} */ const currency=amount.currency;
  void [estimated,currency];
}
// @ts-expect-error An unknown amount cannot grant a numeric issuer amount.
/** @type {number} */ const invented=creditTransactionAmountData({}).rawAmount;
// @ts-expect-error Financial totals cannot become strings.
/** @type {string} */ const textual=amount.amount;
/** @type {unknown} */ const wire={};
// @ts-expect-error Raw JSON is not a retained, validated application state.
creditBillingModelData(wire);
const model=creditBillingModelData({credits:[]},{asOf:'2026-10-25'});
for(const cycle of model.cycles){
  /** @type {'incomplete'|'estimated'|'finalized'} */ const status=cycle.status;
  /** @type {number} */ const total=cycle.total;
  void [status,total];
}
const horizon=creditCyclesThroughHorizonData({},'all','2026-10-25');
/** @type {number} */ const horizonTotal=horizon.total;
// @ts-expect-error A horizon total is not proof that a cloud write completed.
/** @type {boolean} */ const ack=horizon.total;
const upcoming=creditAccountUpcomingChargeData({},'visaCal');
if(upcoming?.source==='transactions'){
  /** @type {boolean} */ const complete=upcoming.complete;void complete;
}
// @ts-expect-error An issuer-balance fallback does not carry transaction coverage proof.
if(upcoming?.source==='issuer_balance')upcoming.complete;
const transitions=normalizeCreditCardAccountTransitions(wire);
/** @type {'ביתי'|'עסקי'} */ const role=creditCardAccountForDateData({accountTransitions:transitions});
// @ts-expect-error Historical account roles cannot become numeric IDs.
/** @type {number} */ const numericRole=role;
void [value,invented,textual,horizonTotal,ack,numericRole];
