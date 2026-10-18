// @ts-check
import { HAPOALIM_TRANSACTION_LIMIT } from './hapoalim-policy.mjs';
import { compactText } from './hapoalim-detail-values.mjs';
import { normalizedCreditSettlementDetails } from './hapoalim-credit-settlement-model.mjs';
import { hapoalimChequeTransactionKind } from './hapoalim-cheque-model.mjs';
import { isoFromBankDate } from './hapoalim-date-codec.mjs';
import { readBankMoney } from './bank-money-value.mjs';

/** @param {unknown} value @returns {value is Record<string,unknown>} */
function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function invalidSource() {
  return Object.assign(new Error('Invalid bank transaction source evidence'), {
    code: 'BANK_TRANSACTIONS_INVALID', retryable: false,
  });
}

/** @param {unknown} data @param {number} [requestedLimit] */
export function hapoalimTransactionPageState(data, requestedLimit = HAPOALIM_TRANSACTION_LIMIT) {
  const page = record(data) ? data : {};
  if (!Array.isArray(page.transactions)) throw invalidSource();
  const transactions = page.transactions;
  const reported = Number(page.numItemsPerPage),
    requested = Number(requestedLimit);
  const reportedPageSize = Number.isFinite(reported) && reported > 0 ? Math.trunc(reported) : null;
  const effectivePageSize =
    reportedPageSize || (Number.isFinite(requested) && requested > 0 ? Math.trunc(requested) : 0);
  return {
    transactions,
    reportedPageSize,
    effectivePageSize,
    isFull: effectivePageSize > 0 && transactions.length >= effectivePageSize,
  };
}

/** @param {unknown} value */
export function normalizeHapoalimTransaction(value) {
  const txn = record(value) ? value : {};
  const direction = readBankMoney(txn.eventActivityTypeCode);
  const serial = readBankMoney(txn.serialNumber);
  const outbound = direction === 2;
  const amountNumber = readBankMoney(txn?.eventAmount);
  const date = isoFromBankDate(txn?.eventDate),
    processedDate = isoFromBankDate(txn?.valueDate);
  // Reject the source batch before it can acquire complete-coverage authority.
  // The account reader owns the partial-balance warning and diagnostics.
  if (amountNumber === null || !date || (txn?.valueDate != null && !processedDate) ||
      (direction !== 1 && direction !== 2) || serial === null || !Number.isSafeInteger(serial) || serial < 0)
    throw invalidSource();
  const amount = amountNumber === 0 ? 0 : outbound ? -Math.abs(amountNumber) : Math.abs(amountNumber);
  const details = record(txn.beneficiaryDetailsData) ? txn.beneficiaryDetailsData : {};
  const memo = [
    details.partyHeadline,
    details.partyName,
    details.messageHeadline,
    details.messageDetail,
  ]
    .map((x) => compactText(x, 120))
    .filter(Boolean)
    .join(' · ');
  const bankReference = compactText(txn?.referenceNumber, 100),
    bankSerial = compactText(txn?.serialNumber, 100);
  const creditSettlementDetails = normalizedCreditSettlementDetails(txn, bankReference);
  const identifier =
    bankReference ||
    bankSerial ||
    compactText(`${txn?.eventDate || ''}-${txn?.eventAmount || ''}`, 100);
  const chequeKind = hapoalimChequeTransactionKind(txn),
    cheque = chequeKind === 'deposit';
  const normalizedExtra = record(txn.netunimAdditionalDetails) ? txn.netunimAdditionalDetails : null;
  // For returned-cheque rows, the expanded Hapoalim `details` response is the
  // authoritative cheque identity source. The top-level contra* fields describe the
  // transaction counterparty and are not guaranteed to be the cheque's printed account.
  // v47 synthesized a second row from contra* and caused exactly that corruption.
  const combinedExtra = normalizedExtra;
  const checkDetails = chequeKind
    ? {
        kind: chequeKind,
        checkNumbers: Array.isArray(combinedExtra?.checkNumbers)
          ? combinedExtra.checkNumbers
              .map((x) => compactText(x, 80))
              .filter((x) => x && x !== '0')
              .slice(0, 50)
          : [],
        checkCount:
          Number.isFinite(Number(combinedExtra?.checkCount)) && Number(combinedExtra?.checkCount) > 0
            ? Math.trunc(Number(combinedExtra?.checkCount))
            : null,
        checkItems: Array.isArray(combinedExtra?.checkItems)
          ? combinedExtra.checkItems
              .map((item) => {
                const amount = readBankMoney(item?.amount);
                return {
                  bankNumber: compactText(item?.bankNumber, 20),
                  branchNumber: compactText(item?.branchNumber, 20),
                  accountNumber: compactText(item?.accountNumber, 40),
                  checkNumber: compactText(item?.checkNumber, 80),
                  amount: amount !== null && amount > 0 ? amount : null,
                  hasDocumentReference: item?.hasDocumentReference === true,
                  imageFrontKey: /^[a-f0-9]{64}$/.test(String(item?.imageFrontKey || ''))
                    ? String(item.imageFrontKey)
                    : '',
                  imageBackKey: /^[a-f0-9]{64}$/.test(String(item?.imageBackKey || ''))
                    ? String(item.imageBackKey)
                    : '',
                };
              })
              .filter(
                (item) =>
                  item.amount &&
                  (item.checkNumber || (item.bankNumber && item.branchNumber && item.accountNumber))
              )
              .slice(0, 50)
          : [],
        hasDocumentReference: combinedExtra?.hasDocumentReference === true,
        warning: compactText(txn?.netunimAdditionalDetailsWarning, 220),
      }
    : null;
  if (checkDetails) {
    // Cheque identifiers come only from cheque-detail fields supplied by the bank.
    // Transaction/deposit references remain separate metadata and are never promoted
    // to cheque numbers, even when they happen to be equal for a particular row.
    const used = new Set(checkDetails.checkItems.map((item) => item.checkNumber).filter(Boolean));
    const remaining = checkDetails.checkNumbers.filter((number) => !used.has(number));
    const missing = checkDetails.checkItems.filter((item) => !item.checkNumber);
    // A single unmatched bank-supplied cheque number has only one possible row.
    if (missing.length === 1 && remaining.length === 1 && missing[0] && remaining[0]) {
      missing[0].checkNumber = remaining[0];
      used.add(remaining[0]);
    }
    for (const item of checkDetails.checkItems) {
      if (item.checkNumber && !checkDetails.checkNumbers.includes(item.checkNumber))
        checkDetails.checkNumbers.push(item.checkNumber);
    }
  }
  return {
    id: identifier,
    date,
    processedDate,
    amount,
    currency: 'ILS',
    description: compactText(txn?.activityDescription, 180) || 'תנועת בנק',
    memo: compactText(memo, 260),
    partyName: compactText(details.partyName, 160),
    partyHeadline: compactText(details.partyHeadline, 160),
    messageHeadline: compactText(details.messageHeadline, 160),
    messageDetail: compactText(details.messageDetail, 220),
    activityTypeCode: direction,
    status: serial === 0 ? 'pending' : 'completed',
    balanceAfter: readBankMoney(txn?.currentBalance),
    bankReference,
    bankSerial,
    cheque,
    checkDetails,
    creditSettlementDetails,
  };
}

/** @param {unknown} transactions @param {number} [limit] */
export function normalizeRecentTransactions(transactions, limit = HAPOALIM_TRANSACTION_LIMIT) {
  // Preserve every bank row. Hapoalim reference numbers repeat, and even visually identical
  // transactions can be distinct operations. Window fetching is non-overlapping, so silently
  // deduplicating here would risk data loss. Identity/deduplication belongs in the archive merge.
  if (!Array.isArray(transactions)) throw invalidSource();
  return Array.from(transactions, normalizeHapoalimTransaction)
    .sort((a, b) =>
      String(b.date || b.processedDate || '').localeCompare(String(a.date || a.processedDate || ''))
    )
    .slice(0, Math.max(0, Number(limit) || 0));
}
