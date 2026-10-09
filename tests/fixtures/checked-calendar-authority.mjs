import {createCalendarAuth} from '../../netunim-orders/site/assets/js/calendar/auth.js';
const calendarSession={accessToken:'',tokenExpiresAt:0,connected:false,accountVerified:false,accountId:'',expectedAccountId:''};
/** @param {string} path @param {{assertRequestScope:()=>void}} options */
async function supaFetch(path,options){options.assertRequestScope();return new Response(path)}
const ports={calendarSession,supaFetch,accountScope:()=>({owner:'A',epoch:1})},auth=createCalendarAuth(ports);
auth.captureOperation().assertCurrent();
/** @type {string} */ const token=auth.captureOperation().accessToken();
// @ts-expect-error an authenticated account scope is a required trust boundary
createCalendarAuth({calendarSession,supaFetch});
// @ts-expect-error a login epoch is numeric evidence
createCalendarAuth({...ports,accountScope:()=>({owner:'A',epoch:'1'})});
// @ts-expect-error a boolean cannot stand in for current authority
createCalendarAuth({...ports,accountScope:()=>true});
// @ts-expect-error account observation must be synchronous before request dispatch
createCalendarAuth({...ports,accountScope:async()=>({owner:'A',epoch:1})});
// @ts-expect-error persisted/provider account IDs cannot be confused with a number
createCalendarAuth({...ports,calendarSession:{...calendarSession,accountId:1}});
// @ts-expect-error token rejection must identify the exact sent credential
auth.rejectToken(1);
// @ts-expect-error a live operation cannot be mistaken for a cached boolean
/** @type {boolean} */ const invalid=auth.captureOperation();
void token;void invalid;
