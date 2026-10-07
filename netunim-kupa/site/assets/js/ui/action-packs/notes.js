import {createLazyDeferredSearchUpdater} from '../../shared/search-scheduler.js';

// Workbook actions come from the workbook itself; this pack owns notes UI.
export function createNotesActions({domainsNotesController,ui}){
const addStickyNote=(...args)=>domainsNotesController.addStickyNote(...args);
const blurStickyNote=(...args)=>domainsNotesController.blurStickyNote(...args);
const deleteStickyNote=(...args)=>domainsNotesController.deleteStickyNote(...args);
const setNotesSearch=(...args)=>domainsNotesController.setNotesSearch(...args);
const updateStickyNote=(...args)=>domainsNotesController.updateStickyNote(...args);
const notesSearch=createLazyDeferredSearchUpdater(value=>{if(ui.notesTab==='sheet')ui.notesSheetSearchValue=value;else ui.notesSearchValue=value},setNotesSearch);
return {
  'notes-search':(element,event)=>{notesSearch(element.value,element)},
  'add-kupa-sticky-note':(element,event)=>{addStickyNote()},
  'update-kupa-sticky-note':(element,event)=>{updateStickyNote(element.dataset.inputArg0,element)},
  'blur-kupa-sticky-note':(element,event)=>{blurStickyNote()},
  'delete-kupa-sticky-note':(element,event)=>{deleteStickyNote(element.dataset.clickArg0)},
};
}
