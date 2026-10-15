import {decodeGoogleEvent,decodeCalendarPage} from '../../netunim-orders/site/assets/js/calendar/payload.js';
import {createCalendarApi} from '../../netunim-orders/site/assets/js/calendar/api.js';
import {projectCalendarPresentation} from '../../netunim-orders/site/assets/js/domains/calendar/presentation.js';
import {createCalendarEditorPayload} from '../../netunim-orders/site/assets/js/domains/calendar/editor-payload.js';
import {applyPending} from '../../netunim-orders/site/assets/js/domains/calendar/read-model.js';
import {calendarRangeFor} from '../../netunim-orders/site/assets/js/calendar/view.js';
/** @type {unknown} */const wire={};
const event=decodeGoogleEvent(wire),calendars=decodeCalendarPage(wire).items;
applyPending({calendars,events:[event]},[]);
const model={range:calendarRangeFor('2026-10-15','month'),mode:'month',events:[event],cacheFetchedAt:null,online:true,connected:true,canCreate:false,now:new Date()};
projectCalendarPresentation(model,{esc:value=>String(value)}).body();
createCalendarEditorPayload({field:()=>({value:'title'})}).readEditorPayload();
const api=createCalendarApi({calendarAuth:{captureOperation:()=>({assertCurrent(){},accessToken:()=> 'token'}),rejectToken(){}}});
void api.fetchEvents(calendars,{timeMin:'a',timeMax:'b'});
// @ts-expect-error unvalidated JSON is never a renderable event
applyPending({events:[wire]},[]);
// @ts-expect-error arbitrary text cannot grant creation authority
projectCalendarPresentation({...model,canCreate:'owner'},{esc:String});
// @ts-expect-error formatting cannot defer into another display
projectCalendarPresentation(model,{esc:async()=>''});
// @ts-expect-error event ids cannot be fabricated from unknown payloads
void api.insertEvent('primary',{id:wire});
// @ts-expect-error field reads must remain synchronous within the mounted command
createCalendarEditorPayload({field:async()=>({value:''})});
// @ts-expect-error presentation has no queue/ACK capability
projectCalendarPresentation(model,{esc:String}).deleteOperation(1);
// @ts-expect-error text flags cannot become provider-locked authority
applyPending({events:[{id:'event',locked:'false'}]},[]);
