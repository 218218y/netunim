import {checkTodayISO} from '../../core/dates.js';

export function normalizeNoteReminderDate(value){
  const raw=String(value||'').trim();
  const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if(!match)return '';
  const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
  const date=new Date(year,month-1,day);
  if(date.getFullYear()!==year||date.getMonth()!==month-1||date.getDate()!==day)return '';
  return raw;
}

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
