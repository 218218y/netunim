// @ts-check
import { addDaysKey, parseDateKey } from '../../calendar/view.js';
/** @typedef {{summary:string,description:string,location:string,start:{date:string}|{dateTime:string},end:{date:string}|{dateTime:string}}} EditorPayload */
/** @param {{field:(selector:string)=>{value:string,checked?:boolean}|null}} ports */
export function createCalendarEditorPayload({ field: $ }) {
  /** @param {unknown} [existing] @returns {EditorPayload} */
  function readEditorPayload(existing = null) {
    const summary = $('#calendarSummary')?.value.trim() || '';
    if (!summary) throw new Error('יש להזין כותרת לתור');
    const startDate = $('#calendarStartDate')?.value || '',
      endDate = $('#calendarEndDate')?.value || startDate;
    if (!startDate || !endDate) throw new Error('יש להזין תאריך התחלה וסיום');
    if (endDate < startDate)
      throw new Error('תאריך הסיום לא יכול להיות לפני תאריך ההתחלה');
    const allDay = !!$('#calendarAllDay')?.checked;
    let start, end;
    if (allDay) {
      start = { date: startDate };
      end = { date: addDaysKey(endDate, 1) };
    } else {
      const startTime = $('#calendarStartTime')?.value || '',
        endTime = $('#calendarEndTime')?.value || '';
      if (!startTime || !endTime) throw new Error('יש להזין שעת התחלה וסיום');
      const startDateTime = new Date(`${startDate}T${startTime}:00`),
        endDateTime = new Date(`${endDate}T${endTime}:00`);
      if (
        Number.isNaN(startDateTime.getTime()) ||
        Number.isNaN(endDateTime.getTime()) ||
        endDateTime <= startDateTime
      )
        throw new Error('שעת הסיום חייבת להיות אחרי שעת ההתחלה');
      start = { dateTime: startDateTime.toISOString() };
      end = { dateTime: endDateTime.toISOString() };
    }
    return {
      summary,
      description: $('#calendarDescription')?.value.trim() || '',
      location: $('#calendarLocation')?.value.trim() || '',
      start,
      end
    };
  }
  /** @returns {EditorPayload} */
  function readQuickEditorPayload() {
    const summary = $('#calendarQuickSummary')?.value.trim() || '',
      date = $('#calendarQuickDate')?.value || '',
      startTime = $('#calendarQuickStartTime')?.value || '',
      endTime = $('#calendarQuickEndTime')?.value || '';
    if (!summary) throw new Error('יש להזין שם לתור');
    if (!parseDateKey(date) || !startTime || !endTime)
      throw new Error('יש להזין תאריך ושעה תקינים');
    const startDateTime = new Date(`${date}T${startTime}:00`),
      endDateTime = new Date(`${date}T${endTime}:00`);
    if (
      Number.isNaN(startDateTime.getTime()) ||
      Number.isNaN(endDateTime.getTime()) ||
      endDateTime <= startDateTime
    )
      throw new Error('שעת הסיום חייבת להיות אחרי שעת ההתחלה');
    return {
      summary,
      description: '',
      location: '',
      start: { dateTime: startDateTime.toISOString() },
      end: { dateTime: endDateTime.toISOString() }
    };
  }
  return { readEditorPayload, readQuickEditorPayload };
}
