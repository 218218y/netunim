import {createCalendarStorage} from '../../netunim-orders/site/assets/js/calendar/storage.js';
import {calendarRequestResult,runCalendarTransaction} from '../../netunim-orders/site/assets/js/calendar/transaction.js';

/** @type {IDBDatabase} */ const db=/** @type {IDBDatabase} */ ({});
/** @type {IDBRequest} */ const request=/** @type {IDBRequest} */ ({});
const storage=createCalendarStorage();
/** @type {unknown} */ const raw=JSON.parse('{}');
/** @type {Promise<number>} */ export const submitted=storage.addOperation(raw);
// @ts-expect-error An accepted command is not a committed sequence until awaited.
/** @type {number} */ export const earlySequence=submitted;
// @ts-expect-error Text sequences cannot authorize updating or deleting pending work.
storage.deleteOperation('7');
storage.listOperations().then(rows=>{
  const first=rows[0];if(!first)return;
  /** @type {number} */ const seq=first.seq;
  return storage.updateOperation(seq,{attempts:first.attempts+1});
});
storage.readDisplaySnapshot('A','2026-10-01','2026-11-01').then(display=>{
  if(!display)return;
  /** @type {string|undefined} */ const historicalOwner=display.snapshot.owner;
  return historicalOwner;
});
calendarRequestResult(request).then(value=>{
  // @ts-expect-error Native IDB bytes remain unknown until the decoder runs.
  return value.seq;
});
/** @type {Promise<unknown>} */ export const committedRead=runCalendarTransaction(db,'queue','readonly',()=>calendarRequestResult(request));
// @ts-expect-error Native transaction completion cannot manufacture boolean authority from unknown bytes.
/** @type {Promise<boolean>} */ export const unvalidated=committedRead;
// @ts-expect-error Only native IDB transaction modes are accepted.
runCalendarTransaction(db,'queue','committed',()=>true);
