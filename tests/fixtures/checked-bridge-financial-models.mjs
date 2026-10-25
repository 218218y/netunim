import {normalizeCreditScrapeTransaction,normalizeCreditMonthSlice,normalizeCreditScrapeAccount} from '../../netunim-kupa/bank-bridge/credit-transaction-model.mjs';
import {normalizeCreditProfileInput} from '../../netunim-kupa/bank-bridge/credit-profile-model.mjs';
import {normalizeChequeItemObject,chequeItemKey} from '../../netunim-kupa/bank-bridge/hapoalim-cheque-model.mjs';
import {hapoalimCreditSettlementProvider,normalizeHapoalimCreditPermissionDetails} from '../../netunim-kupa/bank-bridge/hapoalim-credit-settlement-model.mjs';
/** @type {unknown} */ const wire={};
const row=normalizeCreditScrapeTransaction(wire);
/** @type {'pending'|'completed'} */ const status=row.status;
/** @type {number|null} */ const amount=row.chargedAmount;
if(row.chargedAmount!==null){/** @type {number} */ const known=row.chargedAmount;void known}
// @ts-expect-error Missing issuer money is not a definite zero or known amount.
/** @type {number} */ const invented=row.chargedAmount;
// @ts-expect-error Pending/completed cannot become arbitrary success strings.
/** @type {'saved'} */ const invalidStatus=row.status;
// @ts-expect-error Date metadata has not acquired validation merely by copying it.
/** @type {string} */ const unvalidated=row.date;
// @ts-expect-error A normalized transaction cannot replace its numeric amount with text.
row.chargedAmount='12';
// @ts-expect-error A textual installment count cannot replace the normalized count.
if(row.installments)row.installments.total='3';
const month=normalizeCreditMonthSlice({month:'2026-10',fetchStatus:'success',transactions:[]});
/** @type {'fresh'|'missing'} */ const coverage=month.status;
const account=normalizeCreditScrapeAccount({accountNumber:'123',balance:null},'max');
/** @type {number|null} */ const available=account.availableCredit;
const profile=normalizeCreditProfileInput({provider:'max',username:'user',password:'password'});
/** @type {'visaCal'|'max'|'isracard'|'amex'} */ const provider=profile.provider;
// @ts-expect-error Routing identities remain textual.
/** @type {number} */ const accountId=account.accountNumber;
const cheque=normalizeChequeItemObject(wire);
if(cheque){
  /** @type {number} */ const chequeAmount=cheque.amount;
  chequeItemKey(cheque);
  // @ts-expect-error An incomplete identity record cannot be hashed as a cheque.
  chequeItemKey({amount:12});
  void chequeAmount;
}
const settlement=hapoalimCreditSettlementProvider({});
/** @type {''|'visaCal'|'max'|'isracard'|'amex'} */ const issuer=settlement;
const details=normalizeHapoalimCreditPermissionDetails(wire);
// @ts-expect-error A provider suffix list cannot become a numeric sequence.
/** @type {number[]} */ const wrongSuffixes=details.cardLast4s;
void [status,amount,invented,invalidStatus,unvalidated,coverage,available,provider,accountId,issuer,wrongSuffixes];
