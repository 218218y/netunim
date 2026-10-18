// @ts-check
import { evidenceDate } from './observation-time.js';
import { readBankMoney } from './bank-money-value.js';
/** @typedef {Readonly<Record<string,unknown>>} BankIdentityRow */
/** @param {BankIdentityRow} row */
function dayOf(row) {
    const day = String(row.date || '').slice(0, 10);
    return evidenceDate(day) ? day : '';
}
/** @param {BankIdentityRow} row */
function archiveIdentity(row) {
    const id = readBankMoney(row.archiveId);
    return id !== null && Number.isSafeInteger(id) && id > 0 ? `archive:${id}` : null;
}
/** Proven source identity within one account, matching the archive's existing
 * day/serial/amount rule. A bank reference or raw id alone is not proof.
 * @param {BankIdentityRow} row @returns {string|null} */
export function bankTransactionSourceIdentity(row) {
    const day = dayOf(row), serial = String(row.bankSerial || ''), amount = readBankMoney(row.amount);
    return day && serial && serial !== '0' && amount !== null ? `serial:${day}:${serial}:${amount}` : null;
}
/** Existing archive write policy, moved without changing persisted keys.
 * Duplicate reference/serial keys remain subject to the server's atomic
 * ambiguity rejection; this function never deduplicates source rows.
 * @param {BankIdentityRow} row @param {Map<string,number>} occurrences */
export function bankTransactionMergeKey(row, occurrences) {
    const day = String(row.date || '').slice(0, 10);
    const processedDay = String(row.processedDate || '').slice(0, 10);
    const serial = String(row.bankSerial || '');
    const reference = String(row.bankReference || '');
    const signature = `${day}|${processedDay}|${row.amount}|${row.description || ''}|${row.memo || ''}|${JSON.stringify(row.checkDetails || null)}`;
    const occurrence = (occurrences.get(signature) || 0) + 1;
    occurrences.set(signature, occurrence);
    let stableKey;
    if (serial && serial !== '0' && day)
        stableKey = `serial:${day}:${serial}:${row.amount}`;
    else if (reference && day)
        stableKey = `ref:${day}:${reference}:${row.amount}:${row.description || ''}:${row.memo || ''}`;
    else
        stableKey = `fallback:${signature}:${occurrence}`;
    return String(row.mergeKey || stableKey);
}
/** Navigation identity has no write or matching authority. Source occurrences
 * use their position; archive-backed navigation retains the archive identity.
 * @param {BankIdentityRow} [row] @param {string} [role] @param {number} [index] */
export function bankTransactionDisplayIdentity(row = {}, role = 'business', index = 0) {
    const side = role === 'home' ? 'home' : 'business';
    const archived = archiveIdentity(row);
    return JSON.stringify([side, archived || bankTransactionSourceIdentity(row) || String(row.id || ''), archived ? null : index]);
}
/** Compatibility matching is restricted to overlaying separate reads. It may
 * never collapse rows within one bank response. Old id/day records can still
 * receive corrections; distinct serials cannot fall back to a shared reference.
 * @param {BankIdentityRow} row */
function historyKeys(row) {
    const archive = archiveIdentity(row), source = bankTransactionSourceIdentity(row);
    const keys = [archive, source].filter(value => value !== null);
    if (!source) {
        const rawReference = !row.mergeKey && row.bankReference;
        keys.push(JSON.stringify([
            'historical', row.mergeKey || row.id || '',
            String(row.bankSerial || ''), dayOf(row), rawReference || !(row.id || row.mergeKey)
                ? [row.bankReference, row.description, row.amount, row.memo, row.processedDate] : null
        ]));
    }
    return keys;
}
/** One-to-one overlay of retained and fresh representations. Multiplicity in
 * each input is preserved, including indistinguishable rows. Distinct archive
 * IDs never match through a weaker alias. Fresh corrections keep their fields.
 * @template {BankIdentityRow} T
 * @param {readonly T[]} previous @param {readonly T[]} current
 * @returns {{row:T,current:boolean}[]} */
export function overlayBankTransactionHistory(previous, current) {
    /** @type {Map<string,{indexes:number[],offset:number}>} */ const buckets = new Map();
    current.forEach((row, index) => {
        for (const key of historyKeys(row)) {
            const bucket = buckets.get(key) || { indexes: [], offset: 0 };
            bucket.indexes.push(index);
            buckets.set(key, bucket);
        }
    });
    const used = new Set();
    const result = previous.map(row => {
        for (const key of historyKeys(row)) {
            const bucket = buckets.get(key);
            if (!bucket)
                continue;
            while (used.has(bucket.indexes[bucket.offset]))
                bucket.offset++;
            let index;
            for (let offset = bucket.offset; offset < bucket.indexes.length; offset++) {
                const candidate = bucket.indexes[offset];
                if (candidate === undefined || used.has(candidate))
                    continue;
                const next = current[candidate];
                if (next && !(archiveIdentity(row) && archiveIdentity(next) && archiveIdentity(row) !== archiveIdentity(next))) {
                    index = candidate;
                    break;
                }
            }
            if (index !== undefined) {
                used.add(index);
                return { row: /** @type {T} */ (current[index]), current: true };
            }
        }
        return { row, current: false };
    });
    current.forEach((row, index) => {
        if (!used.has(index))
            result.push({ row, current: true });
    });
    return result;
}
