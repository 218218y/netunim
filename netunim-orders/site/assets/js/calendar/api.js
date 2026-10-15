// @ts-check
import {
  calendarErrorMessage,
  decodeCalendarPage,
  decodeEventPage,
  decodeEventReply,
  invalidCalendarPayload
} from './payload.js';
/** @typedef {import('./payload.js').GoogleCalendar} GoogleCalendar */
/** @typedef {import('./payload.js').GoogleEvent} GoogleEvent */
/** @typedef {{assertCurrent?:()=>void}} RequestOptions */
/** @typedef {{assertCurrent:()=>void,accessToken:()=>string}} RequestScope */
/** @typedef {{timeMin:string,timeMax:string}} EventRange */
const API_ROOT = 'https://www.googleapis.com/calendar/v3';

/** @param {{calendarAuth:{captureOperation:()=>RequestScope,rejectToken:(token:string)=>unknown}}} ports */
export function createCalendarApi({ calendarAuth }) {
  if (
    typeof calendarAuth?.captureOperation !== 'function' ||
    typeof calendarAuth?.rejectToken !== 'function'
  )
    throw new TypeError('calendar_api_authority_required');
  /** @param {string} message @param {number} [status] @param {unknown} [payload] */
  function apiError(message, status = 0, payload = null) {
    return Object.assign(new Error(message || 'Google Calendar החזיר שגיאה'), {
      status: Number(status || 0),
      payload
    });
  }
  /** @param {RequestOptions} [options] */
  function context({ assertCurrent = () => {} } = {}) {
    assertCurrent();
    const operation = calendarAuth.captureOperation();
    return {
      assertCurrent: () => {
        assertCurrent();
        operation.assertCurrent();
      },
      accessToken: operation.accessToken
    };
  }
  /** @param {RequestScope} scope @param {string} path @param {RequestInit} [opt] @returns {Promise<unknown>} */
  async function calendarFetch(scope, path, opt = {}) {
    scope.assertCurrent();
    const token = scope.accessToken();
    let response;
    try {
      response = await fetch(API_ROOT + path, {
        ...opt,
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
          ...(opt.headers || {})
        }
      });
    } catch (error) {
      scope.assertCurrent();
      throw apiError(
        error instanceof Error ? error.message : 'אין חיבור ל-Google Calendar',
        0
      );
    }
    scope.assertCurrent();
    const text = await response.text();
    scope.assertCurrent();
    /** @type {unknown} */ let payload = null;
    let invalidJson = false;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      invalidJson = true;
    }
    if (response.status === 401) calendarAuth.rejectToken(token);
    if (!response.ok)
      throw apiError(
        calendarErrorMessage(payload) ||
          `Google Calendar: HTTP ${response.status}`,
        response.status,
        payload
      );
    if (opt.method === 'DELETE' && text.trim()) throw invalidCalendarPayload();
    if (invalidJson) throw invalidCalendarPayload();
    return payload;
  }
  /** @param {Record<string,string|number|boolean|string[]|null|undefined>} [query] */
  function params(query = {}) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value == null || value === '') continue;
      if (Array.isArray(value))
        value.forEach(item => search.append(key, String(item)));
      else search.set(key, String(value));
    }
    const text = search.toString();
    return text ? '?' + text : '';
  }
  /** @param {Set<string>} seen @param {string} token */
  function nextPage(seen, token) {
    if (token && seen.has(token)) throw invalidCalendarPayload();
    seen.add(token);
    return token;
  }
  /** @param {RequestOptions} [options] */
  async function listCalendars(options) {
    const scope = context(options),
      seen = new Set();
    /** @type {GoogleCalendar[]} */ const items = [];
    let pageToken = '';
    do {
      const data = decodeCalendarPage(
        await calendarFetch(
          scope,
          '/users/me/calendarList' +
            params({ maxResults: 250, showHidden: true, pageToken })
        )
      );
      items.push(...data.items);
      pageToken = nextPage(seen, data.nextPageToken);
    } while (pageToken);
    scope.assertCurrent();
    return items.filter(calendar => !calendar?.deleted);
  }
  /** @param {RequestScope} scope @param {string} calendarId @param {EventRange} range */
  async function listEvents(scope, calendarId, { timeMin, timeMax }) {
    /** @type {GoogleEvent[]} */ const items = [];
    const seen = new Set();
    let pageToken = '';
    do {
      const data = decodeEventPage(
        await calendarFetch(
          scope,
          `/calendars/${encodeURIComponent(calendarId)}/events` +
            params({
              singleEvents: true,
              showDeleted: false,
              timeMin,
              timeMax,
              maxResults: 2500,
              orderBy: 'startTime',
              pageToken
            })
        )
      );
      items.push(...data.items);
      pageToken = nextPage(seen, data.nextPageToken);
    } while (pageToken);
    scope.assertCurrent();
    return items;
  }
  /** @param {string} calendarId @param {EventRange} range @param {RequestOptions} [options] */
  async function listCalendarEvents(calendarId, range, options) {
    return listEvents(context(options), calendarId, range);
  }
  /** @param {GoogleCalendar} calendar */
  function canReadEventDetails(calendar) {
    return ['reader', 'writerWithoutPrivateAccess', 'writer', 'owner'].includes(
      String(calendar?.accessRole || '')
    );
  }
  /** @param {GoogleCalendar[]} calendars @param {EventRange} range @param {RequestOptions} [options] */
  async function fetchEvents(calendars, range, options) {
    const scope = context(options),
      readable = (Array.isArray(calendars) ? calendars : []).filter(
        canReadEventDetails
      ),
      workerCount = Math.min(4, readable.length);
    /** @type {GoogleEvent[][]} */ const groups = new Array(readable.length);
    let cursor = 0,
      failed = false;
    async function worker() {
      while (!failed && cursor < readable.length) {
        scope.assertCurrent();
        const index = cursor++,
          calendar = readable[index];
        if (!calendar) continue;
        let events;
        try {
          events = await listEvents(scope, calendar.id, range);
        } catch (error) {
          failed = true;
          throw error;
        }
        groups[index] = events.map(event => ({
          ...event,
          _calendarId: calendar.id,
          _calendarSummary: calendar.summary || calendar.id,
          _calendarColor: calendar.backgroundColor || '',
          _calendarAccessRole: calendar.accessRole || ''
        }));
      }
    }
    // Join already accepted sibling reads even when one response is invalid.
    // The enclosing runtime's drain must cover the entire accepted fetch.
    const results = await Promise.allSettled(
      Array.from({ length: workerCount }, () => worker())
    );
    scope.assertCurrent();
    const rejected = results.find(result => result.status === 'rejected');
    if (rejected?.status === 'rejected') throw rejected.reason;
    return groups.flat();
  }
  /** @param {string} calendarId @param {string} eventId @param {RequestOptions} [options] */
  async function getEvent(calendarId, eventId, options) {
    return decodeEventReply(
      await calendarFetch(
        context(options),
        `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`
      ),
      eventId
    );
  }
  /** @param {string} calendarId @param {Record<string,unknown> & {id:string}} event @param {RequestOptions} [options] */
  async function insertEvent(calendarId, event, options) {
    return decodeEventReply(
      await calendarFetch(
        context(options),
        `/calendars/${encodeURIComponent(calendarId)}/events` +
          params({ sendUpdates: 'none' }),
        { method: 'POST', body: JSON.stringify(event) }
      ),
      event.id
    );
  }
  /** @param {string} calendarId @param {string} eventId @param {Record<string,unknown>} patch @param {RequestOptions} [options] */
  async function patchEvent(calendarId, eventId, patch, options) {
    return decodeEventReply(
      await calendarFetch(
        context(options),
        `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}` +
          params({ sendUpdates: 'none' }),
        { method: 'PATCH', body: JSON.stringify(patch) }
      ),
      eventId
    );
  }
  /** @param {string} calendarId @param {string} eventId @param {RequestOptions} [options] */
  async function deleteEvent(calendarId, eventId, options) {
    const reply = await calendarFetch(
      context(options),
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}` +
        params({ sendUpdates: 'none' }),
      { method: 'DELETE' }
    );
    if (reply !== null) throw invalidCalendarPayload();
    return null;
  }
  return {
    listCalendars,
    listCalendarEvents,
    fetchEvents,
    getEvent,
    insertEvent,
    patchEvent,
    deleteEvent
  };
}
