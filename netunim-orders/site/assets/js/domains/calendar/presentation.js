// @ts-check
import { addDaysKey, localDateKey, parseDateKey } from '../../calendar/view.js';
import {
  eventKey,
  safeColor,
  eventTimeLabel,
  editableEvent,
  eventOccursOnDay
} from './read-model.js';
/** @typedef {import('./read-model.js').CalendarEvent} CalendarEvent */
/** @typedef {ReturnType<typeof import('../../calendar/view.js').calendarRangeFor>} CalendarRange */
/** @typedef {Readonly<{range:CalendarRange,mode:string,events:readonly CalendarEvent[],cacheFetchedAt:string|null,online:boolean,connected:boolean,canCreate:boolean,now:Date}>} PresentationModel */
const HEBREW_WEEKDAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'שבת'];
const monthFormatter = new Intl.DateTimeFormat('he-IL', {
  month: 'long',
  year: 'numeric'
});
const shortDateTimeFormatter = new Intl.DateTimeFormat('he-IL', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
});
const longDateFormatter = new Intl.DateTimeFormat('he-IL', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric'
});
const shortPeriodFormatter = new Intl.DateTimeFormat('he-IL', {
  day: 'numeric',
  month: 'long'
});
const fullPeriodFormatter = new Intl.DateTimeFormat('he-IL', {
  day: 'numeric',
  month: 'long',
  year: 'numeric'
});
/** A readonly board/toolbar projection. It cannot read DOM, queue or credentials.
 * @param {PresentationModel} model @param {{esc:(value:unknown)=>string}} format
 * @returns {{body:()=>string,toolbar:()=>string}}
 */
export function projectCalendarPresentation(model, { esc }) {
  /** @param {CalendarRange} range */
  function periodTitle(range) {
    if (range.mode === 'month') return monthFormatter.format(range.month);
    if (range.mode === 'day')
      return longDateFormatter.format(
        /** @type {Date} */ (parseDateKey(range.focusDate))
      );
    const last = /** @type {Date} */ (
      parseDateKey(addDaysKey(range.endKey, -1))
    );
    return `${shortPeriodFormatter.format(range.gridStart)} – ${fullPeriodFormatter.format(last)}`;
  }

  function viewModeMarkup() {
    const mode = model.mode;
    return `<div class="calendar-view-modes" role="group" aria-label="תצוגת יומן"><button class="btn small calendar-view-mode${mode === 'month' ? ' active' : ''}" data-action="calendar-set-view" data-click-arg0="month" aria-pressed="${mode === 'month'}">חודש</button><button class="btn small calendar-view-mode${mode === 'week' ? ' active' : ''}" data-action="calendar-set-view" data-click-arg0="week" aria-pressed="${mode === 'week'}">שבוע</button><button class="btn small calendar-view-mode${mode === 'day' ? ' active' : ''}" data-action="calendar-set-view" data-click-arg0="day" aria-pressed="${mode === 'day'}">יום</button></div>`;
  }

  function toolbarMarkup() {
    const range = model.range;
    return `<section class="calendar-toolbar"><div class="calendar-nav-actions"><button class="btn small" data-action="calendar-prev-period" aria-label="התקופה הקודמת">‹</button><button class="btn small" data-action="calendar-today">היום</button><button class="btn small" data-action="calendar-next-period" aria-label="התקופה הבאה">›</button></div>${viewModeMarkup()}<div class="calendar-title-block"><h1>יומן</h1><div class="calendar-period-title">${esc(periodTitle(range))}</div></div><div class="calendar-toolbar-spacer"></div><div id="calendarStatus" class="calendar-status offline">טוען…</div><button class="btn small" data-action="calendar-refresh">רענן</button><button id="calendarAuthButton" class="btn small" data-action="calendar-auth">${model.connected ? 'נתק Google' : 'התחבר ל-Google'}</button><button id="calendarNewButton" class="btn primary" data-action="calendar-new-event" ${model.canCreate ? '' : 'disabled'}>+ תור חדש</button></section>`;
  }

  /** @param {CalendarEvent} event @param {string} [dayKey] */
  function eventMarkup(event, dayKey = '') {
    const key = eventKey(event._calendarId, event.id),
      pending = event._pending ? ' pending' : '',
      deleting = event._pendingDelete ? ' deleting' : '',
      readonly = editableEvent(event) ? '' : ' readonly',
      color = safeColor(event._calendarColor),
      time = eventTimeLabel(event, dayKey),
      summary = event.summary || '(ללא כותרת)',
      title = event._pendingDelete ? `${summary} — ממתין למחיקה` : summary;
    return `<button class="calendar-event${pending}${deleting}${readonly}" style="--event-color:${esc(color)}" data-action="calendar-open-event" data-click-arg0="${esc(key)}" title="${esc(title)}"><span class="calendar-event-dot"></span>${time ? `<span class="calendar-event-time">${esc(time)}</span>` : ''}<span class="calendar-event-title">${esc(summary)}</span>${event._pending ? `<span class="calendar-event-pending" aria-label="${event._pendingDelete ? 'ממתין למחיקה' : 'ממתין לסנכרון'}">${event._pendingDelete ? '×' : '●'}</span>` : ''}</button>`;
  }

  /** @param {string} dayKey */
  function eventsForDay(dayKey) {
    return model.events.filter(event => eventOccursOnDay(event, dayKey));
  }

  /** @param {Date} date @param {CalendarRange} range @param {{maxEvents?:number,showWeekday?:boolean}} [options] */
  function dayMarkup(date, range, { maxEvents = 6, showWeekday = false } = {}) {
    const key = localDateKey(date),
      today = key === localDateKey(model.now),
      outside =
        range.mode === 'month' && date.getMonth() !== range.month.getMonth(),
      events = eventsForDay(key),
      shown = Number.isFinite(maxEvents) ? events.slice(0, maxEvents) : events,
      extra = Math.max(0, events.length - shown.length),
      weekday = HEBREW_WEEKDAYS[date.getDay()];
    return `<section class="calendar-day${today ? ' today' : ''}${outside ? ' outside' : ''}${range.mode !== 'month' ? ` ${range.mode}-day` : ''}" data-calendar-day="${esc(key)}">${showWeekday ? `<div class="calendar-day-heading">${esc(weekday)}</div>` : ''}<button class="calendar-day-number" data-action="calendar-new-day" data-click-arg0="${esc(key)}" title="תור חדש בתאריך זה">${date.getDate()}</button><div class="calendar-day-events">${shown.map(event => eventMarkup(event, key)).join('')}${extra ? `<div class="calendar-more">+${extra} נוספים</div>` : ''}</div><button type="button" class="calendar-day-create-zone" data-action="calendar-day-create" data-click-arg0="${esc(key)}" aria-label="הוספת תור ב-${esc(key)}" title="לחיצה: הוספה מהירה · לחיצה כפולה: כל הפרטים"><span>+ הוספה מהירה</span></button></section>`;
  }

  function cachedNoteMarkup() {
    return model.cacheFetchedAt && (!model.online || !model.connected)
      ? `<div class="calendar-cache-note">מוצגת תצוגה שמורה מ-${esc(shortDateTimeFormatter.format(new Date(model.cacheFetchedAt)))}</div>`
      : '';
  }

  /** @param {CalendarRange} range */
  function monthBodyMarkup(range) {
    const days = [];
    for (let index = 0; index < range.days; index++) {
      const date = new Date(range.gridStart);
      date.setDate(date.getDate() + index);
      days.push(dayMarkup(date, range));
    }
    return `<div class="calendar-weekdays">${HEBREW_WEEKDAYS.map(day => `<div>${esc(day)}</div>`).join('')}</div><div class="calendar-grid calendar-grid-month">${days.join('')}</div>`;
  }

  /** @param {CalendarRange} range */
  function weekBodyMarkup(range) {
    const headers = [],
      days = [];
    for (let index = 0; index < range.days; index++) {
      const date = new Date(range.gridStart);
      date.setDate(date.getDate() + index);
      const key = localDateKey(date),
        today = key === localDateKey(model.now);
      headers.push(
        `<div class="calendar-weekday-date${today ? ' today' : ''}"><span>${esc(HEBREW_WEEKDAYS[date.getDay()])}</span><b>${date.getDate()}</b></div>`
      );
      days.push(dayMarkup(date, range, { maxEvents: 12 }));
    }
    return `<div class="calendar-weekdays calendar-weekdays-dated">${headers.join('')}</div><div class="calendar-grid calendar-grid-week">${days.join('')}</div>`;
  }

  /** @param {CalendarRange} range */
  function dayBodyMarkup(range) {
    const date = /** @type {Date} */ (parseDateKey(range.focusDate)),
      key = range.focusDate;
    return `<div class="calendar-day-view-heading"><span>${esc(longDateFormatter.format(date))}</span><button class="btn small" data-action="calendar-new-day" data-click-arg0="${esc(key)}">+ תור ביום זה</button></div><div class="calendar-grid calendar-grid-day">${dayMarkup(date, range, { maxEvents: Infinity })}</div>`;
  }

  function bodyMarkup() {
    const range = model.range,
      content =
        range.mode === 'month'
          ? monthBodyMarkup(range)
          : range.mode === 'week'
            ? weekBodyMarkup(range)
            : dayBodyMarkup(range);
    return `<div class="calendar-board mode-${esc(range.mode)}">${cachedNoteMarkup()}${content}</div>`;
  }
  return { body: bodyMarkup, toolbar: toolbarMarkup };
}
