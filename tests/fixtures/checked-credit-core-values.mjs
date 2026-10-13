// @ts-check
import {
  creditDebitAmount,
  creditNumber,
  creditTransactionTime,
} from '../../netunim-kupa/bank-bridge/credit-core-values.mjs';
const debit = creditDebitAmount(25),
  number = creditNumber('25'),
  time = creditTransactionTime('12:30');
if (debit !== null) debit.toFixed(2);
if (number !== null) number.toFixed(2);
time.toUpperCase();
/** @type {string} */
// @ts-expect-error invalid provider amounts remain nullable, not string labels
const wrongLabel = debit;
void wrongLabel;
// @ts-expect-error nullable amounts must be checked before arithmetic
debit.toFixed(2);
/** @type {number} */
// @ts-expect-error a time string cannot be used as a debit amount
const wrongAmount = time;
void wrongAmount;
