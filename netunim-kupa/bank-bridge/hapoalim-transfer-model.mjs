// @ts-check
import { normalizeBankSenderAccount } from './bank-sender-account.mjs';
import { readBankMoney } from './bank-money-value.mjs';
import { isoFromBankDate } from './hapoalim-date-codec.mjs';
import { HAPOALIM_BASE_URL } from './hapoalim-wire.mjs';

const EXTERNAL_TRANSFER_LINK_CODE = 16;

/** @param {Record<string,unknown>} transaction */
export function hapoalimIncomingTransfer(transaction) {
  return Number(transaction.eventActivityTypeCode) === 1
    && (readBankMoney(transaction.eventAmount) ?? 0) > 0
    && (readBankMoney(transaction.serialNumber) ?? 0) > 0;
}

/** @param {Record<string,unknown>} transaction */
export function hapoalimSenderAccount(transaction) {
  if (Number(transaction.internalLinkCode) === EXTERNAL_TRANSFER_LINK_CODE)
    return normalizeBankSenderAccount(transaction.netunimSenderAccount);
  if (Number(transaction.displayCreditAccountDetails) !== 1) return null;
  return normalizeBankSenderAccount({
    // The bank's transaction view displays its internal code 912 as 12.
    bankNumber: Number(transaction.contraBankNumber) === 912 ? '12' : transaction.contraBankNumber,
    branchNumber: transaction.contraBranchNumber,
    accountNumber: transaction.contraAccountNumber,
  });
}

/** @param {Record<string,unknown>} transaction */
export function hapoalimTransferorRequest(transaction) {
  if (Number(transaction.internalLinkCode) !== EXTERNAL_TRANSFER_LINK_CODE || !hapoalimIncomingTransfer(transaction))
    return null;
  const eventReferenceNumber = readBankMoney(transaction.eventId);
  const amount = readBankMoney(transaction.eventAmount);
  if (eventReferenceNumber === null || !Number.isSafeInteger(eventReferenceNumber) || eventReferenceNumber <= 0 ||
      !isoFromBankDate(transaction.eventDate)) return null;
  const startDate = String(transaction.eventDate).replaceAll('-', '');
  return {
    url: `${HAPOALIM_BASE_URL}/bnhp-api/current-account-channels/transactions-exp/v1/transactions/details`,
    method: 'POST',
    headers: {'Content-Type': 'application/json;charset=UTF-8', 'X-API-Version': '2', pageUuid: '/current-account/transactions'},
    body: JSON.stringify({amount, startDate, eventReferenceNumber}),
  };
}

/** @param {unknown} response */
export function normalizeHapoalimTransferorDetails(response) {
  const payload = /** @type {{data?: {transferSenderDetails?:unknown}}|null} */ (response);
  const senders = payload?.data?.transferSenderDetails;
  if (!Array.isArray(senders) || senders.length !== 1) return null;
  const sender = senders[0];
  return normalizeBankSenderAccount({
    bankNumber: sender?.sourceBankNumber,
    branchNumber: sender?.sourceBranchNumber,
    accountNumber: sender?.sourceAccountNumber,
  });
}
