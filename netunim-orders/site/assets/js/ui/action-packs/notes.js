import { markMutationActions } from '../../shared/action-registry.js';
export function createNotesActions({ domainsNotesController }) {
  const addStickyNote = (...args) => domainsNotesController.addStickyNote(...args);
  const changeStickyNoteReminderMonth = (...args) => domainsNotesController.changeStickyNoteReminderMonth(...args);
  const deleteSelectedStickyNotes = (...args) => domainsNotesController.deleteSelectedStickyNotes(...args);
  const deleteStickyNote = (...args) => domainsNotesController.deleteStickyNote(...args);
  const handleStickyNoteReminderCalendarKeydown = (...args) => domainsNotesController.handleStickyNoteReminderCalendarKeydown(...args);
  const openStickyNoteReminder = (...args) => domainsNotesController.openStickyNoteReminder(...args);
  const saveStickyNoteReminder = (...args) => domainsNotesController.saveStickyNoteReminder(...args);
  const selectStickyNoteReminderDate = (...args) => domainsNotesController.selectStickyNoteReminderDate(...args);
  const syncStickyNoteReminderCalendar = (...args) => domainsNotesController.syncStickyNoteReminderCalendar(...args);
  const toggleNotesBulkMode = (...args) => domainsNotesController.toggleNotesBulkMode(...args);
  const toggleNotesBulkRow = (...args) => domainsNotesController.toggleNotesBulkRow(...args);
  const toggleNotesBulkVisible = (...args) => domainsNotesController.toggleNotesBulkVisible(...args);
  const updateStickyNote = (...args) => domainsNotesController.updateStickyNote(...args);
  const actions = {
    'toggle-notes-bulk-mode': (element, event) => { return toggleNotesBulkMode(); },
    'toggle-notes-bulk-visible': (element, event) => { return toggleNotesBulkVisible(); },
    'delete-selected-sticky-notes': (element, event) => { return deleteSelectedStickyNotes(); },
    'toggle-notes-bulk-row': (element, event) => { return toggleNotesBulkRow(element.dataset.clickArg0, element.checked, !!event?.shiftKey); },
    'update-sticky-note': (element, event) => { return updateStickyNote(element.dataset.inputArg0, element); },
    'delete-sticky-note': (element, event) => { return deleteStickyNote(element.dataset.clickArg0); },
    'open-sticky-note-reminder': (element, event) => { return openStickyNoteReminder(element.dataset.clickArg0); },
    'note-reminder-prev-month': (element, event) => { return changeStickyNoteReminderMonth(-1); },
    'note-reminder-next-month': (element, event) => { return changeStickyNoteReminderMonth(1); },
    'note-reminder-select-day': (element, event) => { return selectStickyNoteReminderDate(element.dataset.clickArg0); },
    'note-reminder-calendar-keydown': (element, event) => { return handleStickyNoteReminderCalendarKeydown(event, element); },
    'note-reminder-date-change': (element, event) => { return syncStickyNoteReminderCalendar(element); },
    'save-sticky-note-reminder': (element, event) => { return saveStickyNoteReminder(element.dataset.clickArg0); },
    'add-sticky-note': (element, event) => { return addStickyNote(); },
  };
  return markMutationActions(actions, { orders: ['delete-selected-sticky-notes', 'update-sticky-note', 'delete-sticky-note', 'open-sticky-note-reminder', 'save-sticky-note-reminder', 'add-sticky-note'] });
}
