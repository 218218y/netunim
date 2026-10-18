import { markMutationActions } from '../../shared/action-registry.js';
export function createCalendarActions({ calendarPorts }) {
  const { calendarAuthAction, calendarDayCreate, calendarDeleteEvent, calendarExpandQuickEvent, calendarNewEvent, calendarNextPeriod, calendarOpenEvent, calendarPrevPeriod, calendarRefresh, calendarSaveEvent, calendarSaveQuickEvent, calendarSetView, calendarSyncEndDate, calendarSyncStartDate, calendarToday, calendarToggleAllDay } = calendarPorts;
  const actions = {
    'calendar-prev-period': (element, event) => { return calendarPrevPeriod(); },
    'calendar-today': (element, event) => { return calendarToday(); },
    'calendar-next-period': (element, event) => { return calendarNextPeriod(); },
    'calendar-set-view': (element, event) => { return calendarSetView(element.dataset.clickArg0); },
    'calendar-refresh': (element, event) => { return calendarRefresh(); },
    'calendar-auth': (element, event) => { return calendarAuthAction(); },
    'calendar-new-event': (element, event) => { return calendarNewEvent(); },
    'calendar-new-day': (element, event) => { return calendarNewEvent(element.dataset.clickArg0); },
    'calendar-day-create': (element, event) => { return calendarDayCreate(element.dataset.clickArg0, event); },
    'calendar-open-event': (element, event) => { return calendarOpenEvent(element.dataset.clickArg0); },
    'calendar-toggle-all-day': (element, event) => { return calendarToggleAllDay(element); },
    'calendar-start-date-change': (element, event) => { return calendarSyncStartDate(element); },
    'calendar-end-date-change': (element, event) => { return calendarSyncEndDate(element); },
    'calendar-quick-save': (element, event) => { return calendarSaveQuickEvent(); },
    'calendar-quick-details': (element, event) => { return calendarExpandQuickEvent(); },
    'calendar-save-event': (element, event) => { return calendarSaveEvent(element.dataset.clickArg0); },
    'calendar-delete-event': (element, event) => { return calendarDeleteEvent(element.dataset.clickArg0); },
  };
  return markMutationActions(actions, { calendar: ['calendar-auth', 'calendar-new-event', 'calendar-new-day', 'calendar-day-create', 'calendar-open-event', 'calendar-toggle-all-day', 'calendar-start-date-change', 'calendar-end-date-change', 'calendar-quick-save', 'calendar-quick-details', 'calendar-save-event', 'calendar-delete-event'] });
}
