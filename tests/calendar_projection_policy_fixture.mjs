import {readFileSync} from 'node:fs';
import {declaration} from './bank_policy_ast_fixture.mjs';
export const baseline=JSON.parse(readFileSync(new URL('./fixtures/calendar-projection-policy.json',import.meta.url),'utf8'));
function clean(value){
 if(Array.isArray(value))return value.map(clean);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!['start','end','loc','raw'].includes(key)).map(([key,item])=>[key,clean(item)]));
 return value;
}
// Only adapt projection names and the explicit fallback-calendar argument.
// Branches, pending attribution, markup, dates and edit permissions stay exact.
export function semanticPolicy(source,name){
 let value=source;
 for(const [from,to]of [
  ['function applyPending(snapshot, pending, fallbackCalendars = [])','function applyPending(snapshot,pending)'],
  ['function applyPending(snapshot,pending,fallbackCalendars=[])','function applyPending(snapshot,pending)'],
  ['fallbackCalendars','calendarUi.calendars||[]'],['model.range','calendarRange()'],['model.mode','currentViewMode()'],
  ['model.events','(calendarUi.displayEvents||[])'],['model.cacheFetchedAt','calendarUi.cacheFetchedAt'],['model.online','effects.isOnline()'],
  ['model.connected','connection.hasUsableToken()'],['model.canCreate','primaryWritableCalendar()'],['model.now','new Date()'],
 ])value=value.replaceAll(from,to);
 return clean(declaration(value,name));
}
