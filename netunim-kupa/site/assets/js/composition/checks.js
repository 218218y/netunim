import {createDomainsChecksSelectors} from '../domains/checks/selectors.js';
import {createDomainsChecksView} from '../domains/checks/view.js';
import {createDomainsChecksEditor} from '../domains/checks/editor.js';
import {createChecksActions} from '../ui/action-packs/checks.js';
import {createSyncChecks} from '../sync/checks.js';
import {createSyncChecksState} from '../sync/checks-state.js';
import {createSharedChecksMerge} from '../sync/checks-merge.js';
import {createChecksPersistence} from '../sync/checks-persistence.js';
import {createLazyDeferredSearchUpdater} from '../shared/search-scheduler.js';

// Dashboard and backup need check balances before the UI is constructed. The
// view is bound after bulk controls and the bank controller exist; editing is
// bound after the modal, date editor, and record commands exist.
export function createKupaChecksRuntime({model,ui,checksSession={},sharedChecksHasLocalWork=()=>true}){
  if(!model||!ui)throw new TypeError('checks_context_required');
  const selectors=createDomainsChecksSelectors({model});
  let view=null;
  let editor=null;
  let actions=null;
  let sync=null,persistence=null,disposed=false;
  const mergeSharedChecks=createSharedChecksMerge({checksSession});
  const state=createSyncChecksState({model,checksSession,sharedChecksHasLocalWork});
  const requireSync=()=>{if(!sync)throw new Error('checks_sync_not_bound');return sync};
  const requirePersistence=()=>{if(!persistence)throw new Error('checks_persistence_not_bound');return persistence};
  const search=createLazyDeferredSearchUpdater(value=>{if(!disposed)ui.checkSearchValue=value},()=>{if(!disposed)requireView().renderChecksSearch()});
  function bindSync(ports){
    if(disposed)throw new Error('checks_disposed');
    if(sync)throw new Error('checks_sync_already_bound');
    sync=createSyncChecks({...ports,model,checksSession});
  }
  function bindPersistence(ports){
    if(disposed)throw new Error('checks_disposed');
    if(persistence)throw new Error('checks_persistence_already_bound');
    persistence=createChecksPersistence({...ports,model,checksSession,saveSharedChecksToCloud:(...args)=>requireSync().saveSharedChecksToCloud(...args)});
  }
  const commands={
    saveLocal:(...args)=>disposed?Promise.resolve(false):requirePersistence().saveChecksState(...args),
    sync:(...args)=>disposed?Promise.resolve(false):requireSync().syncSharedChecksFromCloud(...args),
    saveCloud:(...args)=>disposed?Promise.resolve(false):requireSync().saveSharedChecksToCloud(...args),
  };
  const runtime={
    poll:(...args)=>disposed?Promise.resolve():requireSync().pollSharedChecks(...args),
    cancelPending:()=>persistence?.runtime.cancelPending()??false,
    isPending:()=>!!(sync?.runtime.isPending()||persistence?.runtime.isPending()),
    async drain(){await persistence?.runtime.drain();await sync?.runtime.drain()},
    dispose(){
      if(disposed)return false;
      disposed=true;search.cancel();persistence?.runtime.dispose();sync?.runtime.dispose();return true;
    },
  };

  function requireView(){
    if(!view)throw new Error('checks_view_not_bound');
    return view;
  }

  function requireEditor(){
    if(!editor)throw new Error('checks_editor_not_bound');
    return editor;
  }

  function bindView({uiBulk,getBankImageContext}={}){
    if(disposed)throw new Error('checks_disposed');
    if(view)throw new Error('checks_view_already_bound');
    for(const method of ['syncBulkUi','bulkControls','bulkHeader','bulkCell']){
      if(typeof uiBulk?.[method]!=='function')throw new TypeError(`checks_bulk_${method}_required`);
    }
    if(typeof getBankImageContext!=='function')throw new TypeError('checks_bank_image_context_required');
    view=createDomainsChecksView({
      model,ui,getBankImageContext,
      syncBulkUi:(...args)=>uiBulk.syncBulkUi(...args),
      bulkControls:(...args)=>uiBulk.bulkControls(...args),
      bulkHeader:(...args)=>uiBulk.bulkHeader(...args),
      bulkCell:(...args)=>uiBulk.bulkCell(...args),
      futureCheckMonths:(...args)=>selectors.futureCheckMonths(...args),
    });
  }

  function bindEditor({uiDateEditor,uiModal,uiStatus,domainsRecordsCommands,uiNavigation,uiBulk}={}){
    if(disposed)throw new Error('checks_disposed');
    if(editor)throw new Error('checks_editor_already_bound');
    requireView();
    requirePersistence();
    for(const [name,port,methods] of [
      ['date',uiDateEditor,['checkDateEditorMarkup','setCheckDateValue','normalizeCheckModalDates','applyCheckDatePicker','handleCheckDatePartBlur','handleCheckDatePartInput','handleCheckDatePartKeydown','openCheckDatePicker']],
      ['modal',uiModal,['armModalDraftGuard','modal','closeModal']],
      ['status',uiStatus,['toast']],
      ['records',domainsRecordsCommands,['deleteRecord']],
      ['navigation',uiNavigation,['checksChanged']],
      ['bulk',uiBulk,['deleteBulkSelected','toggleBulkMode','toggleBulkRow','toggleBulkVisible']],
    ])for(const method of methods)if(typeof port?.[method]!=='function')throw new TypeError(`checks_${name}_${method}_required`);

    const nextEditor=createDomainsChecksEditor({
      model,
      isActive:()=>!disposed,
      onChecksChanged:()=>uiNavigation.checksChanged(),
      checkDateEditorMarkup:(...args)=>uiDateEditor.checkDateEditorMarkup(...args),
      toast:(...args)=>uiStatus.toast(...args),
      armModalDraftGuard:(...args)=>uiModal.armModalDraftGuard(...args),
      modal:(...args)=>uiModal.modal(...args),
      deleteRecord:(...args)=>!disposed&&domainsRecordsCommands.deleteRecord(...args),
      setCheckDateValue:(...args)=>uiDateEditor.setCheckDateValue(...args),
      saveChecksState:commands.saveLocal,
      normalizeCheckModalDates:(...args)=>uiDateEditor.normalizeCheckModalDates(...args),
      closeModal:(...args)=>uiModal.closeModal(...args),
    });
    const nextActions=createChecksActions({domainsChecksEditor:nextEditor,domainsChecksView:view,ui,uiBulk,uiDateEditor,uiModal,search});
    editor=nextEditor;
    actions=Object.fromEntries(Object.entries(nextActions).map(([name,run])=>[name,(...args)=>!disposed&&run(...args)]));
  }

  return {
    bindView,bindEditor,bindSync,bindPersistence,commands,runtime,mergeSharedChecks,
    queries:{hasLocalWork:state.sharedChecksHaveLocalWork},
    renderChecks:(...args)=>!disposed&&requireView().renderChecks(...args),
    markCheckSeriesManual:(...args)=>!disposed&&requireEditor().markCheckSeriesManual(...args),
    syncCheckSeriesFromFirst:(...args)=>!disposed&&requireEditor().syncCheckSeriesFromFirst(...args),
    activeChecks:selectors.activeChecks,
    depositedChecks:selectors.depositedChecks,
    checksBalance:selectors.checksBalance,
    depositedBalance:selectors.depositedBalance,
    assertReady:()=>{requireSync();requirePersistence();if(!actions)throw new Error('checks_editor_not_bound');return true},
    get actions(){if(!actions)throw new Error('checks_editor_not_bound');return actions},
  };
}
