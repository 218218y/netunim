import {createDomainsChecksSelectors} from '../domains/checks/selectors.js';
import {createDomainsChecksView} from '../domains/checks/view.js';
import {createDomainsChecksEditor} from '../domains/checks/editor.js';
import {createChecksActions} from '../ui/action-packs/checks.js';

// Dashboard and backup need check balances before the UI is constructed. The
// view is bound after bulk controls and the bank controller exist; editing is
// bound after the modal, date editor, and record commands exist.
export function createKupaChecksRuntime({model,ui}){
  if(!model||!ui)throw new TypeError('checks_context_required');
  const selectors=createDomainsChecksSelectors({model});
  let view=null;
  let editor=null;
  let actions=null;

  function requireView(){
    if(!view)throw new Error('checks_view_not_bound');
    return view;
  }

  function requireEditor(){
    if(!editor)throw new Error('checks_editor_not_bound');
    return editor;
  }

  function bindView({uiBulk,getBankImageContext}={}){
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

  function bindEditor({uiDateEditor,uiModal,uiStatus,storagePersistence,domainsRecordsCommands,uiNavigation,uiBulk}={}){
    if(editor)throw new Error('checks_editor_already_bound');
    requireView();
    for(const [name,port,methods] of [
      ['date',uiDateEditor,['checkDateEditorMarkup','setCheckDateValue','normalizeCheckModalDates','applyCheckDatePicker','handleCheckDatePartBlur','handleCheckDatePartInput','handleCheckDatePartKeydown','openCheckDatePicker']],
      ['modal',uiModal,['armModalDraftGuard','modal','closeModal']],
      ['status',uiStatus,['toast']],
      ['persistence',storagePersistence,['saveChecksState']],
      ['records',domainsRecordsCommands,['deleteRecord']],
      ['navigation',uiNavigation,['checksChanged']],
      ['bulk',uiBulk,['deleteBulkSelected','toggleBulkMode','toggleBulkRow','toggleBulkVisible']],
    ])for(const method of methods)if(typeof port?.[method]!=='function')throw new TypeError(`checks_${name}_${method}_required`);

    const nextEditor=createDomainsChecksEditor({
      model,
      onChecksChanged:()=>uiNavigation.checksChanged(),
      checkDateEditorMarkup:(...args)=>uiDateEditor.checkDateEditorMarkup(...args),
      toast:(...args)=>uiStatus.toast(...args),
      armModalDraftGuard:(...args)=>uiModal.armModalDraftGuard(...args),
      modal:(...args)=>uiModal.modal(...args),
      deleteRecord:(...args)=>domainsRecordsCommands.deleteRecord(...args),
      setCheckDateValue:(...args)=>uiDateEditor.setCheckDateValue(...args),
      saveChecksState:(...args)=>storagePersistence.saveChecksState(...args),
      normalizeCheckModalDates:(...args)=>uiDateEditor.normalizeCheckModalDates(...args),
      closeModal:(...args)=>uiModal.closeModal(...args),
    });
    const nextActions=createChecksActions({domainsChecksEditor:nextEditor,domainsChecksView:view,ui,uiBulk,uiDateEditor,uiModal});
    editor=nextEditor;
    actions=nextActions;
  }

  return {
    bindView,bindEditor,
    renderChecks:(...args)=>requireView().renderChecks(...args),
    markCheckSeriesManual:(...args)=>requireEditor().markCheckSeriesManual(...args),
    syncCheckSeriesFromFirst:(...args)=>requireEditor().syncCheckSeriesFromFirst(...args),
    activeChecks:selectors.activeChecks,
    depositedChecks:selectors.depositedChecks,
    checksBalance:selectors.checksBalance,
    depositedBalance:selectors.depositedBalance,
    assertReady:()=>{if(!actions)throw new Error('checks_editor_not_bound');return true},
    get actions(){if(!actions)throw new Error('checks_editor_not_bound');return actions},
  };
}
