import {esc} from '../core/values.js';
import {createSpreadsheetWorkspace} from '../shared/spreadsheet-workspace.js';
import {createDomainsNotesController} from '../domains/notes/controller.js';
import {createNotesActions} from '../ui/action-packs/notes.js';

// Recovery and navigation receive guarded Notes ports before the modal and
// cloud session exist. Bind the workbook and controller once those ports exist,
// and before lifecycle startup can invoke recovery or render.
export function createKupaNotesRuntime({model,ui,session,tab}){
  if(!model||!ui||!session||!tab)throw new TypeError('notes_context_required');
  let bound=null;

  function ready(){
    if(!bound)throw new Error('notes_runtime_not_bound');
    return bound;
  }

  function renderNotes(...args){return ready().controller.renderNotes(...args)}

  function bind({cloudAuth,uiModal,storagePersistence}={}){
    if(bound)throw new Error('notes_runtime_already_bound');
    for(const [name,port,methods] of [
      ['cloud',cloudAuth,['supaRest','loadSupaSession']],
      ['modal',uiModal,['confirmDialog','modal','closeModal']],
      ['persistence',storagePersistence,['saveState']],
    ])for(const method of methods)if(typeof port?.[method]!=='function')throw new TypeError(`notes_${name}_${method}_required`);

    const workspace=createSpreadsheetWorkspace({
      domain:'kupa',
      request:(...args)=>cloudAuth.supaRest(...args),
      account:()=>cloudAuth.loadSupaSession()?.user?.id,
      enabled:()=>session.connectionMode==='supabase'&&!!cloudAuth.loadSupaSession(),
      primary:()=>tab.primaryTab,
      active:()=>ui.currentPage==='notes'&&ui.notesTab==='sheet',
      render:renderNotes,
      legacy:()=>model.legacyNotesSheet,
      esc,
      confirmDialog:(...args)=>uiModal.confirmDialog(...args),
      modal:(title,body)=>uiModal.modal(title,body,'\u05e1\u05d2\u05d5\u05e8',()=>uiModal.closeModal()),
      closeModal:()=>uiModal.closeModal(),
    });
    const controller=createDomainsNotesController({
      workspace,model,ui,
      saveState:(message,options={})=>storagePersistence.saveState(message,{...options,domains:['notes']}),
      confirmDialog:(...args)=>uiModal.confirmDialog(...args),
    });
    const actions=createNotesActions({domainsNotesController:controller,ui});
    bound={workspace,controller,actions};
  }

  return {
    bind,renderNotes,
    captureLegacyWorkbook:(...args)=>ready().workspace.sync.captureLegacy(...args),
    activateSheetIfVisible:page=>{if(page==='notes'&&ui.notesTab==='sheet')return ready().workspace.activate()},
    revisionSuffix:page=>page==='notes'&&ui.notesTab==='sheet'?':'+ready().workspace.sync.cacheStamp:'',
    assertReady:()=>{ready();return true},
    get actions(){return ready().actions},
    get sheetActions(){return ready().controller.sheetActions},
    get workspaceActions(){return ready().workspace.actions},
    get workbook(){return ready().workspace},
  };
}
