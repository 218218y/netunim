import { creditBillingISODate } from './credit-billing-cycles.js';
import { bankTransactionCoverage } from './bank-archive-policy.js';
import { overlayBankTransactionHistory } from './bank-transaction-identity.js';
import { readBankMoney } from './bank-money-value.js';
/** @typedef {import('./bank-recurring-contracts.js').RecurringCalculation} RecurringCalculation */
// Explicit obligations requested for this installation. The user confirmed that
// each bank label identifies exactly one obligation in its account. Amounts are
// deliberately absent: only a posted bank debit may seed an estimate.
/** @type {readonly import('./bank-recurring-contracts.js').RecurringRule[]} */
export const BANK_RECURRING_DEBITS = Object.freeze([
    {
        id: 'home-hapoalim-mortgage', account: 'ביתי', name: 'משכנתא פועלים', bankLabels: ['פועלים-משכנתא'], startMonth: '2026-09', day: 15
    },
    {
        id: 'home-mercantile-mortgage', account: 'ביתי', name: 'משכנתא מרכנתיל', bankLabels: ['בנק מרכנתיל די'], startMonth: '2026-09', day: 15
    },
    { id: 'business-pension', account: 'עסקי', name: 'פנסיה', bankLabels: ['מגדל חברה לביט'], startMonth: '2026-09', day: 15 },
]);
/** @type {readonly import('./bank-recurring-contracts.js').RecurringRule[]} */
export const BANK_RECURRING_CREDITS = Object.freeze([
    {
        id: 'home-child-allowance', account: 'ביתי', name: 'קצבת ילדים', bankLabels: ['קצבת ילדים'], startMonth: '2026-09', day: 20, direction: 1, moveSaturday: false
    },
]);
const iso = creditBillingISODate;
/** @type {RecurringCalculation['role']} */
const role = value => value === 'ביתי' || value === 'home' ? 'ביתי' : 'עסקי';
/** @type {RecurringCalculation['cents']} */
const cents = value => Math.round(Number(value) * 100);
/** @type {RecurringCalculation['text']} */
const text = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '').replace(/[־–—-]/g, ' ').replace(/\s+/g, ' ').trim();
/** @type {RecurringCalculation['dayOf']} */
const dayOf = row => iso(row?.date) || iso(row?.processedDate);
/** @type {RecurringCalculation['matches']} */
const matches = (row, rule) => rule.bankLabels.some(label => text(row?.description) === text(label));
/** @type {RecurringCalculation['posted']} */
const posted = (row, asOf, direction = -1) =>
    readBankMoney(row?.amount) !== null && cents(row.amount) * direction > 0 &&
    (!row.currency || row.currency === 'ILS') && (!row.status || row.status === 'completed') &&
    row.presenceState !== 'missing' && !!dayOf(row) && dayOf(row) <= asOf &&
    (!iso(row.processedDate) || iso(row.processedDate) <= asOf);
/** @type {RecurringCalculation['nextMonth']} */
function nextMonth(key){
    const year=Number(key.slice(0,4)),month=Number(key.slice(5,7));
    return month===12?`${year+1}-01`:`${year}-${String(month+1).padStart(2,'0')}`;
}
/** @type {RecurringCalculation['months']} */
function months(from, to) {
    const result = [];
    for (let key = from; key && key <= to;) {
        result.push(key);
        key = nextMonth(key);
    }
    return result;
}
/** @type {RecurringCalculation['dueDate']} */
function dueDate(month, day, moveSaturday = true) {
    const date = new Date(`${month}-${String(day).padStart(2, '0')}T00:00:00Z`);
    if (moveSaturday && date.getUTCDay() === 6)
        date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
}
/** @type {RecurringCalculation['combinedRows']} */
function combinedRows(feed) {
    return overlayBankTransactionHistory(Array.isArray(feed?.recurringDebitHistory) ? feed.recurringDebitHistory : [], Array.isArray(feed?.transactions) ? feed.transactions : []).map(entry => entry.row);
}
// Persist just the recognized source rows alongside the same account snapshot.
// Fresh rows (including missing/pending corrections) replace older evidence.
// Absence invalidates a retained row only inside a complete bank coverage window.
/** @type {RecurringCalculation['bankRecurringDebitHistoryData']} */
export function bankRecurringDebitHistoryData(previousFeed, nextFeed, account, coverage = {}) {
    const { complete, from, to } = bankTransactionCoverage({ transactionCoverage: coverage });
    const rules = [...BANK_RECURRING_DEBITS, ...BANK_RECURRING_CREDITS].filter(rule => rule.account === role(account));
    const sameAccount = !!nextFeed?.accountNumber && nextFeed.accountNumber === previousFeed?.accountNumber;
    const previous = sameAccount ? combinedRows(previousFeed) : [], current = combinedRows(nextFeed);
    return overlayBankTransactionHistory(previous, current)
        .filter(({ row }) => rules.some(rule => matches(row, rule)))
        .map(({ row, current }) => !current && complete && from && to && dayOf(row) >= from && dayOf(row) <= to
        ? { ...row, presenceState: 'missing' } : row)
        .sort((a, b) => dayOf(a).localeCompare(dayOf(b)));
}
/** @type {RecurringCalculation['bankRecurringExpensesData']} */
export function bankRecurringExpensesData(kupa, account, reference, horizon) {
    return bankRecurringMovementsData(kupa, account, reference, horizon, BANK_RECURRING_DEBITS);
}
/** @type {RecurringCalculation['bankRecurringIncomeData']} */
export function bankRecurringIncomeData(kupa, account, reference, horizon) {
    return bankRecurringMovementsData(kupa, account, reference, horizon, BANK_RECURRING_CREDITS);
}
/** @type {RecurringCalculation['bankRecurringMovementsData']} */
function bankRecurringMovementsData(kupa, account, reference, horizon, rules) {
    const accountRole = role(account), bank = kupa?.bank || {}, feed = accountRole === 'ביתי' ? bank.homeFeed : bank.source === 'manual' ? null : bank.feed;
    const synced = iso(feed?.syncedAt), asOf = synced && synced < reference ? synced : reference;
    /** @type {import('./bank-recurring-contracts.js').RecurringMovement[]} */ const rows = [];
    /** @type {import('./bank-recurring-contracts.js').RecurringObligation[]} */ const obligations = [];
    /** @type {import('./bank-recurring-contracts.js').RecurringWarning[]} */ const warnings = [];
    for (const rule of rules.filter(item => item.account === accountRole)) {
        const direction = rule.direction || -1, lastField = direction === 1 ? 'lastCredit' : 'lastDebit';
        const matching = combinedRows(feed).filter(row => matches(row, rule));
        /** @type {Map<string,import('./bank-recurring-contracts.js').BankRow[]>} */ const byMonth = new Map();
        for (const row of matching.filter(row => synced && posted(row, asOf, direction))) {
            const month = dayOf(row).slice(0, 7);
            const group=byMonth.get(month)||[];
            group.push(row);byMonth.set(month,group);
        }
        const knownMonths = [...byMonth.keys()].sort();
        /** @type {import('./bank-recurring-contracts.js').RecurringObligation} */ const obligation = {
            id: rule.id, name: rule.name, account: accountRole, status: 'no_bank_source', [lastField]: null, nextDueDate: '', nextAmount: null
        };
        /** @type {import('./bank-recurring-contracts.js').BankRow|null} */ let latest = null;
        for (const month of knownMonths.filter(month => month < rule.startMonth)) {
            const group=byMonth.get(month);
            if (group?.length === 1) latest=group[0]||null;
        }
        const firstMonth = latest ? rule.startMonth : knownMonths.find(month => month >= rule.startMonth);
        if (!firstMonth) {
            // Recognition is dormant in accounts with no such bank source.
            // Once recognized, missing source data is an explicit incomplete forecast.
            if (matching.length)
                warnings.push({ ruleId: rule.id, name: rule.name, kind: 'no_bank_source' });
            obligations.push(obligation);
            continue;
        }
        const horizonMonth=horizon.slice(0,7),asOfMonth=asOf.slice(0,7),lastMonth=horizonMonth>asOfMonth?horizonMonth:asOfMonth;
        for (const month of months(firstMonth, lastMonth)) {
            const candidates = byMonth.get(month) || [], due = dueDate(month, rule.day, rule.moveSaturday);
            if (candidates.length === 1) {
                latest = candidates[0]||null;
                continue;
            }
            if (candidates.length > 1)
                warnings.push({ ruleId: rule.id, name: rule.name, kind: 'ambiguous', dueDate: due });
            // Several actual credits already affect the bank balance. Never add an
            // extra expected receipt or choose one of their amounts as the next seed.
            if (direction === 1 && candidates.length > 1)
                continue;
            if (!latest)
                continue;
            if (due <= horizon)
                rows.push({
                    id: `bank-recurring:${rule.id}:${month}`,
                    ruleId: rule.id,
                    account: accountRole,
                    name: rule.name,
                    description: rule.name,
                    type: direction === 1 ? 'זיכוי בנק משוער' : 'חיוב בנק משוער',
                    recurring: true,
                    active: true,
                    dueDate: due,
                    amount: direction * cents(latest.amount) / 100,
                    source: 'bank_recurring',
                    amountEstimated: true,
                    bankSettlementState: due < reference ? 'awaiting' : 'estimated',
                    sourceTransactionId: latest.id || '',
                    sourceDate: dayOf(latest),
                    sourceDescription: latest.description
                });
        }
        if (latest) {
            const source = { date: dayOf(latest), amount: direction * cents(latest.amount) / 100, transactionId: latest.id || '' };
            obligation[lastField] = source;
            const outstanding = rows.find(row => row.ruleId === rule.id);
            obligation.nextDueDate = outstanding?.dueDate || dueDate(nextMonth(dayOf(latest).slice(0,7)), rule.day, rule.moveSaturday);
            obligation.nextAmount = outstanding?.amount ?? source.amount;
            obligation.status = outstanding?.bankSettlementState === 'awaiting' ? 'awaiting' : 'estimated';
        }
        obligations.push(obligation);
    }
    return { rows, obligations, warnings, incomplete: warnings.length > 0 };
}
