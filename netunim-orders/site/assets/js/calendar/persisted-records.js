// @ts-check
import {decodeGoogleCalendar,decodeGoogleEvent} from './payload.js';
import {parseDateKey} from './view.js';

/** @typedef {import('./payload.js').GoogleCalendar} GoogleCalendar */
/** @typedef {import('./payload.js').GoogleEvent & {_calendarId:string,_calendarSummary:string,_calendarColor:string,_calendarAccessRole:string}} PersistedCalendarEvent */
/** @typedef {{type:'insert'|'patch'|'delete',calendarId:string,eventId:string,body?:Record<string,unknown>|null,baseEtag?:string,createdAt?:string,attempts:number,lastError:string,lastAttemptAt?:string}} CalendarCommand */
/** @typedef {CalendarCommand & {seq:number}} PersistedCalendarOperation */
/** @typedef {{attempts?:number,lastAttemptAt?:string,lastError?:string}} CalendarRetryPatch */
/** @typedef {{key:string,owner?:string,accountId:string,rangeStart:string,rangeEnd:string,fetchedAt:string,calendars:GoogleCalendar[],events:PersistedCalendarEvent[]}} PersistedCalendarRange */

export function invalidPersistedCalendarRecord(){
  return Object.assign(new Error('נתוני היומן השמורים אינם תקינים. הפעולות המקומיות נשמרו; יש לבדוק את האחסון לפני סנכרון.'),{code:'calendar_persisted_record_invalid'});
}
/** @param {unknown} value @returns {Record<string,unknown>} */
function record(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw invalidPersistedCalendarRecord();
  return /** @type {Record<string,unknown>} */ (value);
}
/** @param {unknown} value @param {boolean} [empty] @returns {string} */
function text(value,empty=false){
  if(typeof value!=='string'||(!empty&&!value.trim()))throw invalidPersistedCalendarRecord();
  return value;
}
/** @param {unknown} value @param {number} minimum @returns {number} */
function integer(value,minimum){
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<minimum)throw invalidPersistedCalendarRecord();
  return value;
}
/** @param {unknown} value @returns {string} */
function timestamp(value){
  const result=text(value);
  if(!/^\d{4}-\d{2}-\d{2}T/.test(result)||!parseDateKey(result.slice(0,10))||!Number.isFinite(Date.parse(result)))throw invalidPersistedCalendarRecord();
  return result;
}
/** @template T @param {()=>T} read @returns {T} */
function decode(read){
  try{return read()}catch{throw invalidPersistedCalendarRecord()}
}

/** @param {unknown} value @returns {CalendarCommand} */
export function decodeCalendarCommand(value){
  return decode(()=>{
    const data=record(structuredClone(value)),type=data.type,calendarId=text(data.calendarId),eventId=text(data.eventId);
    if(type!=='insert'&&type!=='patch'&&type!=='delete')throw invalidPersistedCalendarRecord();
    /** @type {CalendarCommand} */
    const command={type,calendarId,eventId,attempts:data.attempts===undefined?0:integer(data.attempts,0),lastError:data.lastError===undefined?'':text(data.lastError,true)};
    if(data.createdAt!==undefined)command.createdAt=timestamp(data.createdAt);
    if(data.lastAttemptAt!==undefined)command.lastAttemptAt=timestamp(data.lastAttemptAt);
    if(data.baseEtag!==undefined)command.baseEtag=text(data.baseEtag,true);
    if(type==='delete'){
      if(data.body!==undefined&&data.body!==null)throw invalidPersistedCalendarRecord();
      if(data.body===null)command.body=null;
      return command;
    }
    const body=record(data.body);
    if(body.id!==undefined&&body.id!==eventId)throw invalidPersistedCalendarRecord();
    if(type==='insert'){
      if(body.id!==eventId)throw invalidPersistedCalendarRecord();
      decodeGoogleEvent({...body,status:'confirmed'});
      decodeGoogleEvent(body);
      command.body=body;
    }else{
      // PATCH can omit dates or either boundary. Decode every supplied field
      // without inventing a complete event or changing the outbound payload.
      decodeGoogleEvent({...body,id:eventId,status:'cancelled'});
      if(body.start!==undefined&&body.end!==undefined)decodeGoogleEvent({...body,id:eventId,status:'confirmed'});
      if(body.status!==undefined)text(body.status);
      command.body=body;
    }
    return command;
  });
}

/** @param {unknown} value @returns {PersistedCalendarOperation} */
export function decodePersistedCalendarOperation(value){
  const data=record(value),seq=integer(data.seq,1);
  return {...decodeCalendarCommand(data),seq};
}
/** @param {unknown} value @returns {PersistedCalendarOperation[]} */
export function decodePersistedCalendarOperations(value){
  if(!Array.isArray(value))throw invalidPersistedCalendarRecord();
  const rows=value.map(decodePersistedCalendarOperation),seen=new Set();
  for(const row of rows){if(seen.has(row.seq))throw invalidPersistedCalendarRecord();seen.add(row.seq)}
  return rows.sort((a,b)=>a.seq-b.seq);
}

/** @param {unknown} value @returns {CalendarRetryPatch} */
export function decodeCalendarRetryPatch(value){
  const data=record(value);
  if(Object.keys(data).some(key=>!['attempts','lastAttemptAt','lastError'].includes(key)))throw invalidPersistedCalendarRecord();
  /** @type {CalendarRetryPatch} */ const patch={};
  if(data.attempts!==undefined)patch.attempts=integer(data.attempts,0);
  if(data.lastAttemptAt!==undefined)patch.lastAttemptAt=timestamp(data.lastAttemptAt);
  if(data.lastError!==undefined)patch.lastError=text(data.lastError,true);
  return patch;
}

/** @param {unknown} value @returns {PersistedCalendarRange} */
export function decodePersistedCalendarRange(value){
  return decode(()=>{
    const data=record(structuredClone(value)),key=text(data.key),accountId=text(data.accountId),rangeStart=text(data.rangeStart),rangeEnd=text(data.rangeEnd),fetchedAt=timestamp(data.fetchedAt);
    if(!parseDateKey(rangeStart)||!parseDateKey(rangeEnd)||rangeEnd<=rangeStart||!Array.isArray(data.calendars)||!Array.isArray(data.events))throw invalidPersistedCalendarRecord();
    const calendars=data.calendars.map(decodeGoogleCalendar),byId=new Map(calendars.map(calendar=>[calendar.id,calendar]));
    if(byId.size!==calendars.length)throw invalidPersistedCalendarRecord();
    const seen=new Set();
    const events=data.events.map(value=>{
      const row=record(value),calendarId=text(row._calendarId),calendar=byId.get(calendarId);
      if(!calendar)throw invalidPersistedCalendarRecord();
      for(const field of ['_calendarSummary','_calendarColor','_calendarAccessRole'])if(row[field]!==undefined)text(row[field],true);
      if(row._calendarAccessRole!==undefined&&row._calendarAccessRole!==(calendar.accessRole||''))throw invalidPersistedCalendarRecord();
      const event=decodeGoogleEvent(row),identity=JSON.stringify([calendarId,event.id]);
      if(seen.has(identity))throw invalidPersistedCalendarRecord();seen.add(identity);
      // Calendar-list evidence owns edit permission. Cached annotations cannot
      // elevate it, and transient optimistic flags never enter persisted data.
      return {...event,_calendarId:calendarId,_calendarSummary:calendar.summary||calendar.id,_calendarColor:calendar.backgroundColor||'',_calendarAccessRole:calendar.accessRole||''};
    });
    /** @type {PersistedCalendarRange} */ const snapshot={key,accountId,rangeStart,rangeEnd,fetchedAt,calendars,events};
    // Historical unattributed caches remain readable data, never display grants.
    if(data.owner!==undefined)snapshot.owner=text(data.owner);
    return snapshot;
  });
}
/** @param {unknown} value @returns {PersistedCalendarRange[]} */
export function decodePersistedCalendarRanges(value){
  if(!Array.isArray(value))throw invalidPersistedCalendarRecord();
  return value.map(decodePersistedCalendarRange);
}
/** @param {unknown} value @returns {string} */
export function decodeCalendarAccountMeta(value){
  if(value===undefined||value===null)return '';
  const row=record(value);
  if(row.key!=='accountId')throw invalidPersistedCalendarRecord();
  return text(row.value);
}
