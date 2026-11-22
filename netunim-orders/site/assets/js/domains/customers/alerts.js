import {normalizeNoteReminderDate} from '../../contracts/note-reminder-date.js';

export function debtUrgencyWarningItems(debts,today){
  const items=[];
  for(const debt of debts||[]){
    const reminderDate=normalizeNoteReminderDate(debt.urgency?.reminderDate);
    if(!reminderDate||reminderDate>today)continue;
    items.push({
      id:`debt-urgency:${debt.id}`,
      kind:'debt_urgency_reminder',
      debtId:debt.id,
      reminderDate,
      customerName:String(debt.customerName||''),
      content:String(debt.urgency.note||'').trim(),
    });
  }
  return items.sort((a,b)=>a.reminderDate.localeCompare(b.reminderDate)||a.id.localeCompare(b.id));
}
