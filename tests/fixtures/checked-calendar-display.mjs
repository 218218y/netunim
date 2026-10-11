import {authorizeCalendarDisplay} from '../../netunim-orders/site/assets/js/calendar/display-access.js';
import {createCalendarDisplayLifetime} from '../../netunim-orders/site/assets/js/calendar/display-lifetime.js';
authorizeCalendarDisplay({},[],null,'app-owner');
// @ts-expect-error an application owner is an identity string, not a revision
authorizeCalendarDisplay({},[],null,1);
const ports={captureOperation:()=>({owner:'app-owner',assertCurrent(){}}),subscribeAccountScope:()=>()=>{},onInvalidate:()=>undefined};
const display=createCalendarDisplayLifetime(ports);
/** @type {string} */ const owner=display.capture().owner;void owner;
/** @type {AbortSignal} */ const signal=display.capture().signal;void signal;
// @ts-expect-error subscriptions must return explicit synchronous cleanup
createCalendarDisplayLifetime({...ports,subscribeAccountScope:async()=>()=>{}});
// @ts-expect-error authorization cannot omit the captured owner
createCalendarDisplayLifetime({...ports,captureOperation:()=>({assertCurrent(){}})});
// @ts-expect-error private display clearing must finish synchronously
createCalendarDisplayLifetime({...ports,onInvalidate:async()=>{}});
