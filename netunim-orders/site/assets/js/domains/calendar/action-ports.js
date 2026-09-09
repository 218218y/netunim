export function createCalendarActionPorts(controller){
  return {
    calendarPrevPeriod:()=>controller.changePeriod(-1),
    calendarNextPeriod:()=>controller.changePeriod(1),
    calendarToday:(...args)=>controller.goToday(...args),
    calendarSetView:(...args)=>controller.setViewMode(...args),
    calendarRefresh:(...args)=>controller.refreshCalendar(...args),
    calendarAuthAction:(...args)=>controller.calendarAuthAction(...args),
    calendarNewEvent:(...args)=>controller.newEvent(...args),
    calendarDayCreate:(...args)=>controller.calendarDayCreate(...args),
    calendarOpenEvent:(...args)=>controller.openCalendarEvent(...args),
    calendarToggleAllDay:(...args)=>controller.toggleCalendarAllDay(...args),
    calendarSyncStartDate:(...args)=>controller.syncCalendarStartDate(...args),
    calendarSyncEndDate:(...args)=>controller.syncCalendarEndDate(...args),
    calendarSaveQuickEvent:(...args)=>controller.saveQuickCalendarEvent(...args),
    calendarExpandQuickEvent:(...args)=>controller.expandQuickCalendarEvent(...args),
    calendarSaveEvent:(...args)=>controller.saveCalendarEvent(...args),
    calendarDeleteEvent:(...args)=>controller.deleteCalendarEvent(...args),
  };
}
