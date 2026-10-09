import {createCalendarQueueObservation} from '../../netunim-orders/site/assets/js/calendar/queue-observation.js';
const observation=createCalendarQueueObservation();
const settle=observation.beginWrite(),isCurrent=observation.capture();
/** @type {boolean} */ const current=isCurrent();
/** @type {boolean} */ const drained=observation.isSettled();
settle();
// @ts-expect-error a live receipt cannot be replaced by a cached boolean
/** @type {boolean} */ const cached=observation.capture();
// @ts-expect-error mutation settlement is synchronous and idempotent
/** @type {()=>Promise<boolean>} */ const asynchronous=settle;
// @ts-expect-error pending-write state is a boolean, never a persisted revision
/** @type {number} */ const revision=observation.isSettled();
void current;void drained;void cached;void asynchronous;void revision;
