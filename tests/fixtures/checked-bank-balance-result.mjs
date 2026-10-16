import { readBankBalanceResult, bankSnapshotFinancials } from '../../shared/bank-balance-result.js';
import {readBankMoney} from '../../shared/bank-money-value.js';
import {createBridgePairingScope} from '../../shared/bridge-pairing-scope.js';
import {readBankTransaction,readBankTransactions} from '../../shared/bank-transaction-evidence.js';
const transaction=readBankTransaction(null);
/** @type {'pending'|'completed'} */ const transactionStatus=transaction.status;
// @ts-expect-error decoded transaction status is immutable authority
transaction.status='pending';
// @ts-expect-error unknown statuses cannot be widened to completed
/** @type {'pending'|'completed'} */ const badStatus='garbage';
// @ts-expect-error validated transaction arrays are immutable
readBankTransactions(null).push(transaction);
void [transactionStatus,badStatus];
/** @type {number|null} */ const money=readBankMoney(null);
/** @type {()=>undefined} */ const guard=createBridgePairingScope({readToken:()=> 'opaque-device'}).capture();
void money;void guard;
// @ts-expect-error local pairing identity is opaque text, not cloud account data
createBridgePairingScope({readToken:()=>({owner:'account'})});
// @ts-expect-error nullable bank values cannot grant guaranteed finite money
/** @type {number} */ const guaranteed=readBankMoney(null);
void guaranteed;
const result = readBankBalanceResult({ balance: '0', availableBalance: null });
/** @type {number} */ const balance = result.business.balance;
/** @type {number|null} */ const available = bankSnapshotFinancials(
  result.business
).availableBalance;
void balance;
void available;
// @ts-expect-error consumers cannot overwrite frozen numeric evidence with display text
result.business.balance = 'saved';
// @ts-expect-error raw finite numbers cannot forge validated account evidence
bankSnapshotFinancials({
  balance: 0,
  availableBalance: null,
  creditLimit: null,
  creditLimitUsed: null,
  creditLimitUsedPercent: null,
});
// @ts-expect-error unknown availability is not guaranteed to be a number
/** @type {number} */ const known = bankSnapshotFinancials(result.business).availableBalance;
void known;
