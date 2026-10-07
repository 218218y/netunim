import {markMutationActions} from '../../shared/action-registry.js';

export function createCalendarActions({calendarPorts}){

const {calendarAuthAction,calendarDayCreate,calendarDeleteEvent,calendarExpandQuickEvent,calendarNewEvent,calendarNextPeriod,calendarOpenEvent,calendarPrevPeriod,calendarRefresh,calendarSaveEvent,calendarSaveQuickEvent,calendarSetView,calendarSyncEndDate,calendarSyncStartDate,calendarToday,calendarToggleAllDay}=calendarPorts;
const actions={
  'calendar-prev-period':(element,event)=>{calendarPrevPeriod()},
  'calendar-today':(element,event)=>{calendarToday()},
  'calendar-next-period':(element,event)=>{calendarNextPeriod()},
  'calendar-set-view':(element,event)=>{calendarSetView(element.dataset.clickArg0)},
  'calendar-refresh':(element,event)=>{calendarRefresh()},
  'calendar-auth':(element,event)=>{calendarAuthAction()},
  'calendar-new-event':(element,event)=>{calendarNewEvent()},
  'calendar-new-day':(element,event)=>{calendarNewEvent(element.dataset.clickArg0)},
  'calendar-day-create':(element,event)=>{calendarDayCreate(element.dataset.clickArg0,event)},
  'calendar-open-event':(element,event)=>{calendarOpenEvent(element.dataset.clickArg0)},
  'calendar-toggle-all-day':(element,event)=>{calendarToggleAllDay(element)},
  'calendar-start-date-change':(element,event)=>{calendarSyncStartDate(element)},
  'calendar-end-date-change':(element,event)=>{calendarSyncEndDate(element)},
  'calendar-quick-save':(element,event)=>{calendarSaveQuickEvent()},
  'calendar-quick-details':(element,event)=>{calendarExpandQuickEvent()},
  'calendar-save-event':(element,event)=>{calendarSaveEvent(element.dataset.clickArg0)},
  'calendar-delete-event':(element,event)=>{calendarDeleteEvent(element.dataset.clickArg0)},
};
return markMutationActions(actions,{calendar:['calendar-auth', 'calendar-new-event', 'calendar-new-day', 'calendar-day-create', 'calendar-open-event', 'calendar-toggle-all-day', 'calendar-start-date-change', 'calendar-end-date-change', 'calendar-quick-save', 'calendar-quick-details', 'calendar-save-event', 'calendar-delete-event']});
}
