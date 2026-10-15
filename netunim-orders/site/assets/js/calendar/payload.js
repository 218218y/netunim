// @ts-check
// Only decoded provider fields can become display, permission or ACK evidence.
// Other Google fields are retained as unknown; application-owned '_' fields are
// never accepted from the wire.
/** @typedef {{date?:string,dateTime?:string,timeZone?:string}} EventBoundary */
/** @typedef {Record<string,unknown> & {id:string,summary?:string,backgroundColor?:string,accessRole?:string,primary?:boolean,hidden?:boolean,deleted?:boolean}} GoogleCalendar */
/** @typedef {Record<string,unknown> & {id:string,summary?:string,description?:string,location?:string,etag?:string,status?:string,eventType?:string,visibility?:string,locked?:boolean,attendees?:Record<string,unknown>[],start?:EventBoundary|undefined,end?:EventBoundary|undefined}} GoogleEvent */

export function invalidCalendarPayload() {
  return Object.assign(
    new Error(
      'Google Calendar החזיר מידע לא תקין. השינויים המקומיים נשמרו; יש לרענן ולנסות שוב.'
    ),
    { code: 'calendar_invalid_payload', status: 0 }
  );
}
/** @param {unknown} value @returns {Record<string,unknown>} */
function record(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw invalidCalendarPayload();
  return /** @type {Record<string,unknown>} */ (value);
}
/** @param {Record<string,unknown>} value @param {string[]} fields @param {'string'|'boolean'} type */
function fields(value, fields, type) {
  for (const field of fields)
    if (value[field] !== undefined && typeof value[field] !== type)
      throw invalidCalendarPayload();
}
/** @param {Record<string,unknown>} value */
function providerFields(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !key.startsWith('_'))
  );
}
/** @param {unknown} value @returns {string} */
function identifier(value) {
  if (typeof value !== 'string' || !value.trim())
    throw invalidCalendarPayload();
  return value;
}
/** @param {string} value */
function validDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(value + 'T00:00:00Z');
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}
/** @param {unknown} value @returns {EventBoundary} */
function boundary(value) {
  const data = record(value);
  fields(data, ['date', 'dateTime', 'timeZone'], 'string');
  if ((data.date !== undefined) === (data.dateTime !== undefined))
    throw invalidCalendarPayload();
  if (typeof data.date === 'string') {
    if (!validDate(data.date)) throw invalidCalendarPayload();
    return { date: data.date };
  }
  const time = identifier(data.dateTime),
    match =
      /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?$/i.exec(
        time
      );
  if (
    !match ||
    !validDate(match[1] || '') ||
    Number(match[2]) > 23 ||
    Number(match[3]) > 59 ||
    Number(match[4]) > 59 ||
    !Number.isFinite(Date.parse(time))
  )
    throw invalidCalendarPayload();
  if (!match[5] && !data.timeZone) throw invalidCalendarPayload();
  if (data.timeZone !== undefined) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: String(data.timeZone) });
    } catch {
      throw invalidCalendarPayload();
    }
    return { dateTime: time, timeZone: String(data.timeZone) };
  }
  return { dateTime: time };
}
/** @param {unknown} value @returns {GoogleCalendar} */
export function decodeGoogleCalendar(value) {
  const data = record(value),
    id = identifier(data.id);
  if (data.error !== undefined) throw invalidCalendarPayload();
  fields(data, ['summary', 'backgroundColor', 'accessRole'], 'string');
  fields(data, ['primary', 'hidden', 'deleted'], 'boolean');
  if (!data.deleted) identifier(data.accessRole);
  return /** @type {GoogleCalendar} */ ({ ...providerFields(data), id });
}
/** @param {unknown} value @returns {GoogleEvent} */
export function decodeGoogleEvent(value) {
  const data = record(value),
    id = identifier(data.id);
  if (data.error !== undefined) throw invalidCalendarPayload();
  fields(
    data,
    [
      'summary',
      'description',
      'location',
      'etag',
      'status',
      'eventType',
      'visibility'
    ],
    'string'
  );
  fields(data, ['locked', 'attendeesOmitted', 'endTimeUnspecified'], 'boolean');
  /** @type {GoogleEvent} */ const event = { ...providerFields(data), id };
  if (data.attendees !== undefined) {
    if (!Array.isArray(data.attendees)) throw invalidCalendarPayload();
    event.attendees = data.attendees.map(record);
  }
  if (data.start !== undefined) event.start = boundary(data.start);
  if (data.end !== undefined) event.end = boundary(data.end);
  // Google GET can return an id-only cancelled tombstone. Active events cannot
  // turn missing/invalid boundaries into an empty or successfully ACKed event.
  if (data.status !== 'cancelled') {
    if (!event.start || !event.end || !!event.start.date !== !!event.end.date)
      throw invalidCalendarPayload();
    const start = event.start.date || event.start.dateTime || '',
      end = event.end.date || event.end.dateTime || '';
    // Keep zero-duration provider events readable. Editor validation continues
    // to require positive duration for commands created in this application.
    // Floating boundaries may use different explicit IANA zones. Native Date
    // parses floating text in the browser zone, so only compare real instants
    // when both boundaries contain an offset.
    const hasOffsets =
      /(?:Z|[+-]\d{2}:\d{2})$/i.test(start) &&
      /(?:Z|[+-]\d{2}:\d{2})$/i.test(end);
    if (
      event.start.date
        ? end < start
        : hasOffsets && Date.parse(end) < Date.parse(start)
    )
      throw invalidCalendarPayload();
  }
  return event;
}
/** @template T @param {unknown} value @param {(value:unknown)=>T} decode @returns {{items:T[],nextPageToken:string}} */
function page(value, decode) {
  const data = record(value);
  if (data.error !== undefined) throw invalidCalendarPayload();
  if (data.items !== undefined && !Array.isArray(data.items))
    throw invalidCalendarPayload();
  if (
    data.nextPageToken !== undefined &&
    typeof data.nextPageToken !== 'string'
  )
    throw invalidCalendarPayload();
  return {
    items: (Array.isArray(data.items) ? data.items : []).map(decode),
    nextPageToken:
      typeof data.nextPageToken === 'string' ? data.nextPageToken : ''
  };
}
/** @param {unknown} value */
export function decodeCalendarPage(value) {
  return page(value, decodeGoogleCalendar);
}
/** @param {unknown} value */
export function decodeEventPage(value) {
  return page(value, decodeGoogleEvent);
}
/** @param {unknown} value @param {string} expectedId */
export function decodeEventReply(value, expectedId) {
  const event = decodeGoogleEvent(value);
  if (event.id !== expectedId) throw invalidCalendarPayload();
  return event;
}
/** @param {unknown} value @returns {string} */
export function calendarErrorMessage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const data = record(value),
    error = data.error;
  if (
    error &&
    typeof error === 'object' &&
    !Array.isArray(error) &&
    typeof record(error).message === 'string'
  )
    return String(record(error).message);
  return typeof data.message === 'string' ? data.message : '';
}
