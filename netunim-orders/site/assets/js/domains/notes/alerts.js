import {checkTodayISO} from '../../core/dates.js';
import {normalizeNoteReminderDate} from '../../contracts/note-reminder-date.js';
export {normalizeNoteReminderDate} from '../../contracts/note-reminder-date.js';

export function noteReminderWarningItems(notes,today=checkTodayISO()){
  const current=normalizeNoteReminderDate(today)||checkTodayISO();
  return (Array.isArray(notes)?notes:[])
    .map(note=>({note,reminderDate:normalizeNoteReminderDate(note?.reminderDate)}))
    .filter(({note,reminderDate})=>note?.id&&reminderDate&&reminderDate<=current)
    .sort((a,b)=>a.reminderDate.localeCompare(b.reminderDate)||String(a.note.createdAt||'').localeCompare(String(b.note.createdAt||''))||String(a.note.id).localeCompare(String(b.note.id)))
    .map(({note,reminderDate})=>({
      id:`note:${String(note.id)}`,
      kind:'note_reminder',
      noteId:String(note.id),
      reminderDate,
      content:String(note.content||'').trim(),
      createdAt:String(note.createdAt||''),
    }));
}
