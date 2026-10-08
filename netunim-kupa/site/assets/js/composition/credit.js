import {createDomainsCreditSelectors} from '../domains/credit/selectors.js';
import {createDomainsCreditView} from '../domains/credit/view.js';
import {createDomainsCreditEditor} from '../domains/credit/editor.js';
import {createCreditActions} from '../ui/action-packs/credit.js';
import {KUPA_FINANCE_DOMAINS} from '../state/revisions.js';

// Forecast selectors are needed during backup construction. The view binds
// after the finance controller exists, and editing binds after record commands.
export function createKupaCreditRuntime({model,ui}){
  if(!model||!ui)throw new TypeError('credit_context_required');
  const selectors=createDomainsCreditSelectors({model});
  let view=null;
  let creditController=null;
  let actions=null;

  function requireView(){
    if(!view)throw new Error('credit_view_not_bound');
    return view;
  }

  function bindView({controller,uiBulk,uiDateEditor,financeDerivations,domainRevisions,expensesMarkup}={}){
    if(view)throw new Error('credit_view_already_bound');
    for(const [name,port,methods] of [
      ['controller',controller,['creditSyncUiState','refreshCreditBridgeStatus']],
      ['bulk',uiBulk,['syncBulkUi','bulkControls','bulkHeader','bulkCell']],
      ['date',uiDateEditor,['dateEditorMarkup']],
      ['finance',financeDerivations,['run']],
      ['revisions',domainRevisions,['stamp']],
    ])for(const method of methods)if(typeof port?.[method]!=='function')throw new TypeError(`credit_${name}_${method}_required`);
    if(typeof expensesMarkup!=='function')throw new TypeError('credit_expenses_markup_required');

    view=createDomainsCreditView({
      detailRevision:()=>domainRevisions.stamp(KUPA_FINANCE_DOMAINS),
      runFinance:financeDerivations.run,
      dateEditorMarkup:(...args)=>uiDateEditor.dateEditorMarkup(...args),
      model,ui,
      syncBulkUi:(...args)=>uiBulk.syncBulkUi(...args),
      bulkControls:(...args)=>uiBulk.bulkControls(...args),
      bulkHeader:(...args)=>uiBulk.bulkHeader(...args),
      bulkCell:(...args)=>uiBulk.bulkCell(...args),
      creditSyncUiState:(...args)=>controller.creditSyncUiState(...args),
      refreshCreditBridgeStatus:(...args)=>controller.refreshCreditBridgeStatus(...args),
      expensesMarkup,
    });
    creditController=controller;
  }

  function bindEditor({uiModal,uiDateEditor,uiStatus,storagePersistence,domainsRecordsCommands}={}){
    if(actions)throw new Error('credit_editor_already_bound');
    requireView();
    for(const [name,port,methods] of [
      ['modal',uiModal,['armModalDraftGuard','modal','closeModal']],
      ['date',uiDateEditor,['dateEditorMarkup','setDateValue']],
      ['status',uiStatus,['toast']],
      ['persistence',storagePersistence,['saveState']],
      ['records',domainsRecordsCommands,['deleteRecord']],
    ])for(const method of methods)if(typeof port?.[method]!=='function')throw new TypeError(`credit_${name}_${method}_required`);

    const editor=createDomainsCreditEditor({
      model,
      armModalDraftGuard:(...args)=>uiModal.armModalDraftGuard(...args),
      modal:(...args)=>uiModal.modal(...args),
      nextChargeDate:(...args)=>selectors.nextChargeDate(...args),
      deleteRecord:(...args)=>domainsRecordsCommands.deleteRecord(...args),
      saveState:(message,options={})=>storagePersistence.saveState(message,{...options,domains:['credits']}),
      toast:(...args)=>uiStatus.toast(...args),
      closeModal:(...args)=>uiModal.closeModal(...args),
      dateEditorMarkup:(...args)=>uiDateEditor.dateEditorMarkup(...args),
      setDateValue:(...args)=>uiDateEditor.setDateValue(...args),
      renderCredit:(...args)=>view.renderCredit(...args),
    });
    actions=createCreditActions({domainsCreditController:creditController,domainsCreditEditor:editor,domainsCreditView:view,ui});
  }

  return {
    bindView,bindEditor,
    renderCredit:(...args)=>requireView().renderCredit(...args),
    assertReady:()=>{if(!actions)throw new Error('credit_editor_not_bound');return true},
    get actions(){if(!actions)throw new Error('credit_editor_not_bound');return actions},
  };
}
