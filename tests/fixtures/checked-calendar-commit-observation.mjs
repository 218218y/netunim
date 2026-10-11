import {createCalendarCommitObserver} from '../../netunim-orders/site/assets/js/calendar/commit-observer.js';
import {createCalendarCommitNotifications} from '../../netunim-orders/site/assets/js/platform/calendar-commit-notifications.js';
const ports={subscribe:()=>()=>{},capture:()=>({owner:'fixture',assertCurrent(){}}),refresh:async()=>true,onError:()=>{}};
const observer=createCalendarCommitObserver(ports);
/** @type {Promise<boolean>} */ const outcome=observer.wake();
// @ts-expect-error no cached boolean authority
createCalendarCommitObserver({...ports,capture:()=>true});
// @ts-expect-error an owner string alone does not fence async publication
createCalendarCommitObserver({...ports,capture:()=>({owner:'fixture'})});
// @ts-expect-error a commit hint does not supply a remote receipt
createCalendarCommitObserver({...ports,refresh:async()=>({revision:1})});
// @ts-expect-error subscriptions must return resource cleanup
createCalendarCommitObserver({...ports,subscribe:()=>{}});
// @ts-expect-error channel implementation must own listener cleanup
createCalendarCommitNotifications({createChannel:()=>({postMessage(){},close(){}})});
// @ts-expect-error notification carries no business document or account data
createCalendarCommitNotifications().notify({owner:'fixture',events:[]});
// @ts-expect-error reading the queue is asynchronous, not a synchronous success
/** @type {boolean} */ const confirmed=outcome;
void confirmed;
