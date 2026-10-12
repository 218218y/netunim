import {createCalendarOperationFlight} from '../../netunim-orders/site/assets/js/calendar/operation-flight.js';
import {createCalendarBrowserEffects} from '../../netunim-orders/site/assets/js/platform/calendar-browser-effects.js';
const flight=createCalendarOperationFlight({isObsolete:()=>true});
const authority={assertCurrent:()=>{}};
/** @type {boolean|void} */ const completed=await flight.run(authority,async control=>{control.isCurrent();return control.release()});void completed;
// @ts-expect-error A Calendar flight requires a scoped authority, not a guessed owner name.
flight.run('account',async()=>true);
// @ts-expect-error Status text is not an operation completion receipt.
flight.run(authority,async()=> 'synchronized');
const effects=createCalendarBrowserEffects();
/** @type {boolean} */ const online=effects.isOnline();void online;
effects.start({resume:()=>{},offline:()=>{},canPoll:()=>true,interval:60_000});
// @ts-expect-error Runtime intervals are numbers, not formatted strings.
effects.start({resume:()=>{},offline:()=>{},canPoll:()=>true,interval:'60000'});
// @ts-expect-error A recovery deadline is numeric.
effects.reconnect.schedule(()=>{},'15000');
// @ts-expect-error Callers cannot read the private native poll handle.
effects.pollTimer;
