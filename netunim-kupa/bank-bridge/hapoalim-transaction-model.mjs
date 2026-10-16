// @ts-nocheck
import { HAPOALIM_TRANSACTION_LIMIT } from './hapoalim-policy.mjs';
import { compactText } from './hapoalim-detail-values.mjs';
import { normalizedCreditSettlementDetails } from './hapoalim-credit-settlement-model.mjs';
import { hapoalimChequeTransactionKind } from './hapoalim-cheque-model.mjs';
import { isoFromBankDate } from './hapoalim-date-codec.mjs';

export function hapoalimTransactionPageState(data, requestedLimit = HAPOALIM_TRANSACTION_LIMIT) {
  const transactions = Array.isArray(data?.transactions) ? data.transactions : [];
  const reported = Number(data?.numItemsPerPage),
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

export function normalizeHapoalimTransaction(txn) {
  const outbound = Number(txn?.eventActivityTypeCode) === 2;
  const amountNumber = Number(txn?.eventAmount);
  const amount = Number.isFinite(amountNumber)
    ? outbound
      ? -Math.abs(amountNumber)
      : Math.abs(amountNumber)
    : 0;
  const details =
    txn?.beneficiaryDetailsData && typeof txn.beneficiaryDetailsData === 'object'
      ? txn.beneficiaryDetailsData
      : {};
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
  const normalizedExtra =
    txn?.netunimAdditionalDetails && typeof txn.netunimAdditionalDetails === 'object'
      ? txn.netunimAdditionalDetails
      : null;
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
          Number.isFinite(Number(combinedExtra?.checkCount)) && Number(combinedExtra.checkCount) > 0
            ? Math.trunc(Number(combinedExtra.checkCount))
            : null,
        checkItems: Array.isArray(combinedExtra?.checkItems)
          ? combinedExtra.checkItems
              .map((item) => ({
                bankNumber: compactText(item?.bankNumber, 20),
                branchNumber: compactText(item?.branchNumber, 20),
                accountNumber: compactText(item?.accountNumber, 40),
                checkNumber: compactText(item?.checkNumber, 80),
                amount:
                  Number.isFinite(Number(item?.amount)) && Number(item.amount) > 0
                    ? Number(item.amount)
                    : null,
                hasDocumentReference: item?.hasDocumentReference === true,
                imageFrontKey: /^[a-f0-9]{64}$/.test(String(item?.imageFrontKey || ''))
                  ? String(item.imageFrontKey)
                  : '',
                imageBackKey: /^[a-f0-9]{64}$/.test(String(item?.imageBackKey || ''))
                  ? String(item.imageBackKey)
                  : '',
              }))
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
    if (missing.length === 1 && remaining.length === 1) {
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
    date: isoFromBankDate(txn?.eventDate),
    processedDate: isoFromBankDate(txn?.valueDate),
    amount,
    currency: 'ILS',
    description: compactText(txn?.activityDescription, 180) || 'תנועת בנק',
    memo: compactText(memo, 260),
    partyName: compactText(details.partyName, 160),
    partyHeadline: compactText(details.partyHeadline, 160),
    messageHeadline: compactText(details.messageHeadline, 160),
    messageDetail: compactText(details.messageDetail, 220),
    activityTypeCode: Number.isFinite(Number(txn?.eventActivityTypeCode))
      ? Number(txn.eventActivityTypeCode)
      : null,
    status: Number(txn?.serialNumber) === 0 ? 'pending' : 'completed',
    balanceAfter:
      txn?.currentBalance === null ||
      txn?.currentBalance === undefined ||
      txn?.currentBalance === ''
        ? null
        : Number.isFinite(Number(txn.currentBalance))
          ? Number(txn.currentBalance)
          : null,
    bankReference,
    bankSerial,
    cheque,
    checkDetails,
    creditSettlementDetails,
  };
}

export function normalizeRecentTransactions(transactions, limit = HAPOALIM_TRANSACTION_LIMIT) {
  // Preserve every bank row. Hapoalim reference numbers repeat, and even visually identical
  // transactions can be distinct operations. Window fetching is non-overlapping, so silently
  // deduplicating here would risk data loss. Identity/deduplication belongs in the archive merge.
  return (Array.isArray(transactions) ? transactions : [])
    .map(normalizeHapoalimTransaction)
    .filter((x) => x.id || x.date || x.amount)
    .sort((a, b) =>
      String(b.date || b.processedDate || '').localeCompare(String(a.date || a.processedDate || ''))
    )
    .slice(0, Math.max(0, Number(limit) || 0));
}
