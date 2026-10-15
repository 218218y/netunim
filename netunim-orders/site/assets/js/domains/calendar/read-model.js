// @ts-check
import { addDaysKey, localDateKey, parseDateKey } from '../../calendar/view.js';
/** @typedef {import('../../calendar/payload.js').GoogleCalendar} GoogleCalendar */
/** @typedef {import('../../calendar/payload.js').GoogleEvent & {_calendarId?:string,_calendarSummary?:string,_calendarColor?:string,_calendarAccessRole?:string,_pending?:boolean,_pendingDelete?:boolean,_pendingSeq?:number|undefined}} CalendarEvent */
/** @typedef {{calendarId:string,eventId:string,type:string,body?:Partial<CalendarEvent>|null,seq?:number}} PendingOperation */
const DEFAULT_EVENT_COLOR = '#8f6d55';
/** @param {number} value */
function pad(value) {
  return String(value).padStart(2, '0');
}
/** @param {string|undefined} calendarId @param {string|undefined} eventId */
export function eventKey(calendarId, eventId) {
  return `${encodeURIComponent(String(calendarId || ''))}::${encodeURIComponent(String(eventId || ''))}`;
}

/** @param {string|undefined} value */
export function safeColor(value) {
  const color = String(value || '');
  return /^#[0-9a-f]{6}$/i.test(color) ? color : DEFAULT_EVENT_COLOR;
}

/** @param {CalendarEvent|null|undefined} event */
export function eventDateKey(event) {
  if (event?.start?.date) return String(event.start.date);
  const date = new Date(event?.start?.dateTime || '');
  return Number.isNaN(date.getTime()) ? '' : localDateKey(date);
}

/** @param {CalendarEvent} event @param {string} dayKey */
export function eventOccursOnDay(event, dayKey) {
  const dayStart = /** @type {Date} */ (parseDateKey(dayKey)),
    dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  if (event?.start?.date) {
    const start = /** @type {Date} */ (parseDateKey(event.start.date)),
      exclusiveEnd = /** @type {Date} */ (
        parseDateKey(event?.end?.date || addDaysKey(event.start.date, 1))
      );
    return start < dayEnd && exclusiveEnd > dayStart;
  }
  const start = new Date(event?.start?.dateTime || ''),
    end = new Date(event?.end?.dateTime || event?.start?.dateTime || '');
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()))
    return false;
  return start < dayEnd && end > dayStart;
}

/** @param {CalendarEvent} event @param {string} [dayKey] */
export function eventTimeLabel(event, dayKey = '') {
  if (event?.start?.date) return '';
  const date = new Date(event?.start?.dateTime || '');
  if (Number.isNaN(date.getTime())) return '';
  if (dayKey && eventDateKey(event) !== dayKey) return '↳';
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** @param {CalendarEvent} event */
export function eventSortValue(event) {
  return `${event?.start?.date ? '0' : '1'}|${event?.start?.date || event?.start?.dateTime || ''}|${event?.summary || ''}`;
}

/** @param {{accessRole?:string|undefined}|null|undefined} calendar */
export function writableCalendar(calendar) {
  return ['owner', 'writer', 'writerWithoutPrivateAccess'].includes(
    String(calendar?.accessRole || '')
  );
}

/** @param {CalendarEvent|null|undefined} event */
export function editableEvent(event) {
  const role = String(event?._calendarAccessRole || '');
  return (
    !!event &&
    writableCalendar({ accessRole: role }) &&
    !(
      role === 'writerWithoutPrivateAccess' && event.visibility === 'private'
    ) &&
    !event.locked &&
    (event.eventType == null || event.eventType === 'default') &&
    !(Array.isArray(event.attendees) && event.attendees.length) &&
    event.status !== 'cancelled' &&
    !event._pendingDelete
  );
}

/** @param {CalendarEvent|null|undefined} event */
export function eventReadOnlyReason(event) {
  if (event?.eventType === 'birthday')
    return 'אירוע יום הולדת מוצג מקריאה ישירה מ-Google ואינו נערך במסך הזה.';
  if (Array.isArray(event?.attendees) && event.attendees.length)
    return 'לאירוע יש מוזמנים. כדי לא לשנות התראות או הזמנות בלי כוונה, עריכה שלו נשארת ב-Google Calendar.';
  if (event?.locked) return 'Google סימן את האירוע כנעול לעריכה.';
  if (
    event?._calendarAccessRole === 'writerWithoutPrivateAccess' &&
    event?.visibility === 'private'
  )
    return 'זהו אירוע פרטי ביומן שבו Google אינה מעניקה הרשאה לעריכת אירועים פרטיים.';
  if (!writableCalendar({ accessRole: event?._calendarAccessRole }))
    return 'ליומן הזה יש הרשאת קריאה בלבד.';
  if (event?.eventType && event.eventType !== 'default')
    return 'סוג האירוע הזה מנוהל על-ידי Google ומוצג כאן לקריאה בלבד.';
  return 'האירוע מוצג לקריאה בלבד.';
}

/** @param {CalendarEvent} event @param {GoogleCalendar|undefined} calendar */
export function decorateEvent(event, calendar) {
  return {
    ...event,
    _calendarId: event._calendarId || calendar?.id || '',
    _calendarSummary:
      event._calendarSummary || calendar?.summary || calendar?.id || '',
    _calendarColor: event._calendarColor || calendar?.backgroundColor || '',
    _calendarAccessRole: event._calendarAccessRole || calendar?.accessRole || ''
  };
}

/** @param {{calendars?:GoogleCalendar[],events?:CalendarEvent[]}|null|undefined} snapshot @param {PendingOperation[]|null|undefined} pending @param {GoogleCalendar[]} [fallbackCalendars] @returns {CalendarEvent[]} */
export function applyPending(snapshot, pending, fallbackCalendars = []) {
  const calendars = snapshot?.calendars || fallbackCalendars,
    calendarMap = new Map(
      /** @type {[string|undefined,GoogleCalendar][]} */ (
        calendars.map(calendar => [calendar.id, calendar])
      )
    ),
    events = new Map();
  for (const source of snapshot?.events || []) {
    const event = decorateEvent(source, calendarMap.get(source._calendarId));
    events.set(eventKey(event._calendarId, event.id), event);
  }
  for (const operation of pending || []) {
    const key = eventKey(operation.calendarId, operation.eventId),
      calendar = calendarMap.get(operation.calendarId) || {
        id: operation.calendarId,
        summary: operation.calendarId,
        accessRole: 'writer'
      };
    if (operation.type === 'insert') {
      events.set(
        key,
        decorateEvent(
          {
            ...operation.body,
            id: operation.eventId,
            _pending: true,
            _pendingSeq: operation.seq
          },
          calendar
        )
      );
      continue;
    }
    if (operation.type === 'patch') {
      const prior =
        events.get(key) ||
        decorateEvent(
          {
            id: operation.eventId,
            summary: 'שינוי ממתין',
            start: operation.body?.start,
            end: operation.body?.end
          },
          calendar
        );
      events.set(key, {
        ...prior,
        ...operation.body,
        _pending: true,
        _pendingSeq: operation.seq
      });
      continue;
    }
    if (operation.type === 'delete') {
      const prior = events.get(key);
      if (prior)
        events.set(key, {
          ...prior,
          _pending: true,
          _pendingDelete: true,
          _pendingSeq: operation.seq
        });
    }
  }
  return [...events.values()].sort((a, b) =>
    eventSortValue(a).localeCompare(eventSortValue(b), 'en')
  );
}
