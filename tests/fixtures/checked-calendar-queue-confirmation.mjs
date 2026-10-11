import {confirmCalendarPendingSnapshot} from '../../netunim-orders/site/assets/js/calendar/queue-confirmation.js';
/** @type {IDBDatabase} */ const db=/** @type {IDBDatabase} */ ({ });
const observation={capture:()=>()=>true,isSettled:()=>true};
/** @type {Promise<boolean>} */ const confirmed=confirmCalendarPendingSnapshot(db,observation,receipt=>receipt.isCurrent()&&receipt.operations.length===0);
// @ts-expect-error a publication callback must be synchronous
confirmCalendarPendingSnapshot(db,observation,async()=>true);
// @ts-expect-error a cached boolean is not a live observation
confirmCalendarPendingSnapshot(db,{capture:()=>true,isSettled:()=>true},()=>true);
// @ts-expect-error raw queued JSON needs business validation before field access
confirmCalendarPendingSnapshot(db,observation,receipt=>receipt.operations[0].eventId==='unsafe');
// @ts-expect-error a promise of confirmation is not itself evidence of sync
/** @type {boolean} */ const success=confirmed;
void confirmed;void success;
