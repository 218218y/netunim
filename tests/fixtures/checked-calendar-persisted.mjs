import {decodeCalendarCommand,decodePersistedCalendarOperation,decodePersistedCalendarOperations,decodePersistedCalendarRange} from '../../netunim-orders/site/assets/js/calendar/persisted-records.js';

/** @type {unknown} */ const raw=JSON.parse('{}');
// @ts-expect-error Persisted input grants no operation sequence before decoding.
export const rawSequence=raw.seq;
const operation=decodePersistedCalendarOperation(raw);
/** @type {number} */ export const sequence=operation.seq;
/** @type {'insert'|'patch'|'delete'} */ export const kind=operation.type;
// @ts-expect-error A validated sequence cannot become text.
operation.seq='1';
// @ts-expect-error Retry attempts are numbers, never a coercible persisted value.
operation.attempts='1';
/** @type {import('../../netunim-orders/site/assets/js/calendar/persisted-records.js').PersistedCalendarOperation} */
// @ts-expect-error A decoder is synchronous evidence, not a deferred record.
export const deferred=Promise.resolve(operation);
const cache=decodePersistedCalendarRange(raw);
/** @type {string|undefined} */ export const historicalOwner=cache.owner;
// @ts-expect-error Historical unattributed caches cannot grant a definite app owner.
/** @type {string} */ export const assumedOwner=cache.owner;
// @ts-expect-error Cache calendars have validated text identifiers.
cache.calendars.push({id:7});
export const rows=decodePersistedCalendarOperations(raw);
export const command=decodeCalendarCommand(raw);
// @ts-expect-error Commands have no durable sequence before the IDB transaction.
/** @type {number} */ export const inventedSequence=command.seq;
