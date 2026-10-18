import {readBankArchiveCommand} from '../../shared/bank-transaction-evidence.js';
import {normalizedCalendarTimestamp, localCalendarDate} from '../../shared/observation-time.js';
/** @type {unknown} */ const raw = {};
const command = readBankArchiveCommand(raw);
/** @type {'business'|'home'} */ const role = command.p_account_role;
/** @type {boolean} */ const complete = command.p_complete;
/** @type {string|null} */ const coverage = command.p_coverage_from;
// @ts-expect-error a captured command is immutable
command.p_complete = true;
// @ts-expect-error captured transaction rows cannot be replaced
command.p_transactions.push({});
// @ts-expect-error exact timestamp normalization can reject input
/** @type {string} */ const timestamp = normalizedCalendarTimestamp(raw);
// @ts-expect-error a calendar date cannot be mistaken for a Date object
/** @type {Date} */ const date = localCalendarDate(raw);
void [role, complete, coverage, timestamp, date];
