import {bankRecurringExpensesData,bankRecurringIncomeData,bankRecurringDebitHistoryData} from '../../shared/bank-recurring-debits.js';
const result=bankRecurringExpensesData({bank:{feed:{syncedAt:'2026-10-25',transactions:[]}}},'business','2026-10-25','2026-12-31');
/** @type {boolean} */ const incomplete=result.incomplete;
const income=bankRecurringIncomeData(null,'home','2026-10-25','2026-12-31');
const history=bankRecurringDebitHistoryData(null,{transactions:[{amount:null}]},'home');
for(const row of result.rows){
  /** @type {number} */ const amount=row.amount;
  /** @type {true} */ const estimated=row.amountEstimated;
  // @ts-expect-error A forecast cannot certify a finalized bank movement.
  /** @type {false} */ const final=row.amountEstimated;
  // @ts-expect-error An unvalidated source identity cannot become a local ID.
  /** @type {string} */ const sourceId=row.sourceTransactionId;
  void [amount,estimated,final,sourceId];
}
for(const obligation of result.obligations){
  /** @type {number|null} */ const next=obligation.nextAmount;
  // @ts-expect-error Missing source money must remain distinguishable from zero.
  /** @type {number} */ const known=obligation.nextAmount;
  void [next,known];
}
// @ts-expect-error A horizon is an ISO day, not an amount.
bankRecurringIncomeData({},'home','2026-10-25',1);
void [incomplete,income,history];
