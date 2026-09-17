import {createSpreadsheetWorkspace} from '../../shared/spreadsheet-workspace.js';
import {createDomainsNotesController} from './controller.js';
import {esc} from '../../core/values.js';

export function createNotesDomain({cloudAuth,tab,ui,notesUi,model,uiModal,storagePersistence,uiStatus,uiLayout,uiAlertCenter,uiDateEditor}){
const spreadsheetWorkspace=createSpreadsheetWorkspace({
  domain:'orders',request:(...args)=>cloudAuth.supaFetch(...args),account:()=>cloudAuth.loadSession()?.user?.id,enabled:()=>cloudAuth.cloudEnabled(),primary:()=>tab.primaryTab,
  active:()=>ui.currentView==='notes'&&notesUi.notesTab==='sheet',render:()=>domainsNotesController.renderNotes(),legacy:()=>model.legacyNotesSheet,
  esc,confirmDialog:(...args)=>uiModal.confirmDialog(...args),modal:(...args)=>uiModal.modal(...args),closeModal:()=>uiModal.closeModal(),
});

const domainsNotesController=createDomainsNotesController({
  workspace:spreadsheetWorkspace,
  model,
  notesUi,
  scheduleSave:(...args)=>storagePersistence.scheduleSave(...args),
  toast:(...args)=>uiStatus.toast(...args),
  mountViewLayout:(...args)=>uiLayout.mountViewLayout(...args),
  confirmDialog:(...args)=>uiModal.confirmDialog(...args),
  modal:(...args)=>uiModal.modal(...args),
  closeModal:(...args)=>uiModal.closeModal(...args),
  refreshAlertCenter:(...args)=>uiAlertCenter.refreshIndicator(...args),
  currentView:()=>ui.currentView,
  dateEditorMarkup:(...args)=>uiDateEditor.dateEditorMarkup(...args),
  setDateValue:(...args)=>uiDateEditor.setDateValue(...args),
});

return {spreadsheetWorkspace,domainsNotesController};
}
