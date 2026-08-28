import assert from 'node:assert/strict';
import {createCalendarApi} from '../netunim-orders/site/assets/js/calendar/api.js';

const calls=[];
const responses=new Map();
function jsonResponse(payload,status=200){return {ok:status>=200&&status<300,status,async text(){return payload==null?'':JSON.stringify(payload)}}}
globalThis.fetch=async(url,options={})=>{
  const parsed=new URL(url);
  calls.push({url:parsed,options});
  const key=parsed.pathname+parsed.search;
  const response=responses.get(key);
  if(!response)throw new Error('Unexpected request: '+key);
  return response;
};
const auth={accessToken(){return 'token'},clearToken(){}};
const api=createCalendarApi({calendarAuth:auth});

responses.set('/calendar/v3/users/me/calendarList?maxResults=250&showHidden=true',jsonResponse({items:[
  {id:'primary',summary:'ראשי',primary:true,accessRole:'owner'},
  {id:'hidden-reader',summary:'מוסתר',hidden:true,accessRole:'reader'},
  {id:'busy-only',summary:'זמינות בלבד',accessRole:'freeBusyReader'},
  {id:'deleted',summary:'נמחק',accessRole:'reader',deleted:true},
]}));
const calendars=await api.listCalendars();
assert.deepEqual(calendars.map(item=>item.id),['primary','hidden-reader','busy-only']);
assert.equal(calls[0].url.searchParams.get('showHidden'),'true');

const range={timeMin:'2026-08-01T00:00:00.000Z',timeMax:'2026-09-01T00:00:00.000Z'};
for(const id of ['primary','hidden-reader']){
  const query=new URLSearchParams({singleEvents:'true',showDeleted:'false',timeMin:range.timeMin,timeMax:range.timeMax,maxResults:'2500',orderBy:'startTime'}).toString();
  responses.set(`/calendar/v3/calendars/${encodeURIComponent(id)}/events?${query}`,jsonResponse({items:[{id:`event-${id}`,summary:id,start:{date:'2026-08-20'},end:{date:'2026-08-21'}}]}));
}
const events=await api.fetchEvents(calendars,range);
assert.deepEqual(events.map(item=>item.id),['event-primary','event-hidden-reader']);
assert.ok(events.every(item=>item._calendarId!=='busy-only'));
assert.ok(!calls.some(call=>call.url.pathname.includes('/busy-only/events')));

console.log('CALENDAR API TESTS PASSED');
