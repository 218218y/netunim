// @ts-check
import { normalizedCalendarTimestamp as cleanIso } from './observation-time.js';
import { readBankMoney } from './bank-money-value.js';
import { evidenceDate } from './observation-time.js';
export const BANK_FEED_VERSION = 5;
// Retained public transport/page budget; historical reads never truncate data.
export const BANK_FEED_TRANSACTION_LIMIT = 20000;
/** @param {unknown} value @returns {value is Record<string,unknown>} */
function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
/** @param {unknown} value @param {number} [max] */
function cleanText(value, max = 260) { return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max); }
/** @param {unknown} value */
function normalizeCreditSettlementDetails(value) {
    if (!record(value))
        return null;
    const provider = typeof value.provider === 'string' && ['visaCal', 'max', 'isracard', 'amex'].includes(value.provider) ? value.provider : '';
    if (!provider)
        return null;
    const cardLast4s = [
        ...new Set((Array.isArray(value.cardLast4s) ? value.cardLast4s : []).map(x => String(x || '').replace(/\D/g, '')).filter(x => /^\d{4}$/.test(x)))
    ].slice(0, 20);
    return {
        provider, providerLabel: cleanText(value.providerLabel, 40), issuerReference: cleanText(value.issuerReference, 100), permissionReference: cleanText(value.permissionReference, 100),
        bankActivityTypeCode: value.bankActivityTypeCode === null || value.bankActivityTypeCode === undefined || value.bankActivityTypeCode === '' ? null : (Number.isFinite(Number(value.bankActivityTypeCode)) ? Number(value.bankActivityTypeCode) : null),
        bankTextCode: value.bankTextCode === null || value.bankTextCode === undefined || value.bankTextCode === '' ? null : (Number.isFinite(Number(value.bankTextCode)) ? Number(value.bankTextCode) : null),
        cardLast4s, cardIdentitySource: cardLast4s.length && value.cardIdentitySource === 'bank_detail_explicit' ? 'bank_detail_explicit' : '', detailFetched: value.detailFetched === true, warning: cleanText(value.warning, 220),
    };
}
/** @param {unknown} value @param {string} [fallbackKind] */
function normalizeCheckDetails(value, fallbackKind = '') {
    if (!record(value))
        return null;
    const kind = typeof value.kind === 'string' && ['deposit', 'returned', 'returned_credit'].includes(value.kind) ? value.kind : (fallbackKind === 'deposit' ? 'deposit' : '');
    const numbers = [...new Set((Array.isArray(value.checkNumbers) ? value.checkNumbers : []).map(x => cleanText(x, 80)).filter(x => x && x !== '0'))].slice(0, 50);
    const count = value.checkCount === null || value.checkCount === undefined || value.checkCount === '' ? null : (Number.isFinite(Number(value.checkCount)) && Number(value.checkCount) > 0 ? Math.trunc(Number(value.checkCount)) : null);
    const items = (Array.isArray(value.checkItems) ? value.checkItems : []).map(item => {
      const amount = readBankMoney(item?.amount);
      return {
        bankNumber: cleanText(item?.bankNumber, 20),
        branchNumber: cleanText(item?.branchNumber, 20),
        accountNumber: cleanText(item?.accountNumber, 40),
        checkNumber: cleanText(item?.checkNumber, 80),
        amount: amount !== null && amount > 0 ? amount : null,
        hasDocumentReference: item?.hasDocumentReference === true,
        imageFrontKey: /^[a-f0-9]{64}$/.test(String(item?.imageFrontKey || '')) ? String(item.imageFrontKey) : '',
        imageBackKey: /^[a-f0-9]{64}$/.test(String(item?.imageBackKey || '')) ? String(item.imageBackKey) : '',
      };
    }).filter(item => item.amount && (item.checkNumber || (item.bankNumber && item.branchNumber && item.accountNumber))).slice(0, 50);
    for (const item of items) {
        if (item.checkNumber && !numbers.includes(item.checkNumber))
            numbers.push(item.checkNumber);
    }
    const warning = cleanText(value.warning, 220), checkCount = count || items.length || null, hasDocumentReference = value.hasDocumentReference === true;
    if (!kind && !numbers.length && !checkCount && !items.length && !hasDocumentReference && !warning)
        return null;
    return { kind, checkNumbers: numbers, checkCount, checkItems: items, hasDocumentReference, warning };
}
/** Historical compatibility reader. Live authority belongs to readBankTransaction.
 * @param {unknown} value */
export function normalizeBankFeedTransaction(value) {
    const row = record(value) ? value : {};
    const archiveId = readBankMoney(row.archiveId);
    return {
        id: cleanText(row.id, 100),
        mergeKey: typeof row.mergeKey === 'string' ? row.mergeKey : '',
        date: cleanIso(row.date),
        processedDate: cleanIso(row.processedDate),
        amount: readBankMoney(row.amount),
        currency: cleanText(row.currency || 'ILS', 8) || 'ILS',
        description: cleanText(row.description, 180) || 'תנועת בנק',
        memo: cleanText(row.memo, 260),
        partyName: cleanText(row.partyName, 160), partyHeadline: cleanText(row.partyHeadline, 160), messageHeadline: cleanText(row.messageHeadline, 160), messageDetail: cleanText(row.messageDetail, 220),
        activityTypeCode: row.activityTypeCode === null || row.activityTypeCode === undefined || row.activityTypeCode === '' ? null : (Number.isFinite(Number(row.activityTypeCode)) ? Number(row.activityTypeCode) : null),
        status: row.status === 'pending' ? 'pending' : 'completed',
        balanceAfter: readBankMoney(row.balanceAfter),
        bankReference: cleanText(row.bankReference, 100),
        bankSerial: cleanText(row.bankSerial, 100),
        cheque: !!row.cheque,
        checkDetails: normalizeCheckDetails(row.checkDetails, row.cheque ? 'deposit' : ''),
        creditSettlementDetails: normalizeCreditSettlementDetails(row.creditSettlementDetails),
        archiveId: archiveId !== null && Number.isSafeInteger(archiveId) && archiveId > 0 ? archiveId : null,
        presenceState: typeof row.presenceState === 'string' && ['unknown', 'present', 'missing'].includes(row.presenceState) ? row.presenceState : 'unknown',
        firstSeenAt: cleanIso(row.firstSeenAt),
        lastSeenAt: cleanIso(row.lastSeenAt),
        missingSince: cleanIso(row.missingSince),
        missingAcknowledgedAt: cleanIso(row.missingAcknowledgedAt),
        alertAcknowledgements: row.alertAcknowledgements && typeof row.alertAcknowledgements === 'object' && !Array.isArray(row.alertAcknowledgements) ? Object.fromEntries(Object.entries(row.alertAcknowledgements).map(([key, value]) => [cleanText(key, 80), cleanIso(value)]).filter(([key, value]) => key && value)) : {},
    };
}
/** @param {unknown} value */
function cleanCoverageDate(value) { return evidenceDate(value) ? value : ''; }
/** @param {unknown} value
 * @param {(value:unknown)=>ReturnType<typeof normalizeBankFeedTransaction>} normalizeTransaction */
function normalizeDirectSnapshot(value, normalizeTransaction) {
    if (!record(value) || !Array.isArray(value.transactions))
        return null;
    const snapshotAt = cleanIso(value.snapshotAt), coverageFrom = cleanCoverageDate(value.coverageFrom), coverageTo = cleanCoverageDate(value.coverageTo);
    if (!snapshotAt || !coverageFrom || !coverageTo || coverageFrom > coverageTo)
        return null;
    const transactions = [];
    for (const raw of Array.isArray(value.transactions) ? value.transactions : []) {
        transactions.push(normalizeTransaction(raw));
    }
    transactions.sort((a, b) => String(b.date || b.processedDate || '').localeCompare(String(a.date || a.processedDate || '')));
    const transactionCount = value.transactionCount === undefined ? transactions.length : readBankMoney(value.transactionCount);
    if (transactionCount !== transactions.length)
        return null;
    return { snapshotAt, coverageFrom, coverageTo, transactionCount, transactions };
}
/** @param {unknown} feed
 * @param {(value:unknown)=>ReturnType<typeof normalizeBankFeedTransaction>} [normalizeTransaction] */
export function normalizeBankFeed(feed, normalizeTransaction = normalizeBankFeedTransaction) {
    if (!record(feed))
        return null;
    const syncedAt = cleanIso(feed.syncedAt || feed.fetchedAt);
    const balance = readBankMoney(feed.balance);
    if (!syncedAt || balance === null)
        return null;
    const transactions = [];
    for (const raw of Array.isArray(feed.transactions) ? feed.transactions : []) {
        transactions.push(normalizeTransaction(raw));
    }
    transactions.sort((a, b) => String(b.date || b.processedDate || '').localeCompare(String(a.date || a.processedDate || '')));
    return {
        version: BANK_FEED_VERSION,
        provider: 'hapoalim',
        accountNumber: cleanText(feed.accountNumber, 64),
        balance,
        availableBalance: readBankMoney(feed.availableBalance),
        creditLimit: readBankMoney(feed.creditLimit),
        creditLimitUsed: readBankMoney(feed.creditLimitUsed),
        creditLimitUsedPercent: readBankMoney(feed.creditLimitUsedPercent),
        syncedAt,
        transactions,
        recurringDebitHistory: (Array.isArray(feed.recurringDebitHistory) ? feed.recurringDebitHistory : []).map(normalizeTransaction),
        transactionWarning: cleanText(feed.transactionWarning, 320),
        directSnapshot: normalizeDirectSnapshot(feed.directSnapshot, normalizeTransaction),
    };
}
