import {createDomainsCashSelectors} from '../domains/cash/selectors.js';
import {createDomainsCashView} from '../domains/cash/view.js';
import {createDomainsCashController} from '../domains/cash/controller.js';
import {createDomainsCashEditor} from '../domains/cash/editor.js';
import {createCashActions} from '../ui/action-packs/cash.js';

// Balances are available before the shell. Rendering and commands are bound
// once the modal, bulk controls and record commands have been constructed.
export function createKupaCashRuntime({model,ui}){
  if(!model||!ui)throw new TypeError('cash_context_required');
  const selectors=createDomainsCashSelectors({model});
  let bound=null;

  function ready(){
    if(!bound)throw new Error('cash_ui_not_bound');
    return bound;
  }

  function renderCash(...args){return ready().view.renderCash(...args)}

  function bindUi({uiBulk,uiDateEditor,domainsDashboardView,uiModal,uiStatus,storagePersistence,domainsRecordsCommands}={}){
    if(bound)throw new Error('cash_ui_already_bound');
    for(const [name,port,methods] of [
      ['bulk',uiBulk,['syncBulkUi','bulkControls','bulkHeader','bulkCell']],
      ['date',uiDateEditor,['dateEditorMarkup']],
      ['dashboard',domainsDashboardView,['kpi']],
      ['modal',uiModal,['armModalDraftGuard','modal','closeModal']],
      ['status',uiStatus,['toast']],
      ['persistence',storagePersistence,['saveState']],
      ['records',domainsRecordsCommands,['deleteRecord']],
    ])for(const method of methods)if(typeof port?.[method]!=='function')throw new TypeError(`cash_${name}_${method}_required`);

    const view=createDomainsCashView({
      model,ui,
      cashBalance:(...args)=>selectors.cashBalance(...args),
      rightsBalance:(...args)=>selectors.rightsBalance(...args),
      kpi:(...args)=>domainsDashboardView.kpi(...args),
      syncBulkUi:(...args)=>uiBulk.syncBulkUi(...args),
      bulkControls:(...args)=>uiBulk.bulkControls(...args),
      bulkHeader:(...args)=>uiBulk.bulkHeader(...args),
      bulkCell:(...args)=>uiBulk.bulkCell(...args),
      dateEditorMarkup:(...args)=>uiDateEditor.dateEditorMarkup(...args),
    });
    const controller=createDomainsCashController({
      model,
      saveState:(message,options={})=>storagePersistence.saveState(message,{...options,domains:['rights']}),
      toast:(...args)=>uiStatus.toast(...args),
    });
    const editor=createDomainsCashEditor({
      model,
      armModalDraftGuard:(...args)=>uiModal.armModalDraftGuard(...args),
      modal:(...args)=>uiModal.modal(...args),
      deleteRecord:(...args)=>domainsRecordsCommands.deleteRecord(...args),
      saveState:(...args)=>storagePersistence.saveState(...args),
      toast:(...args)=>uiStatus.toast(...args),
      closeModal:(...args)=>uiModal.closeModal(...args),
      dateEditorMarkup:(...args)=>uiDateEditor.dateEditorMarkup(...args),
      renderCash,
    });
    const actions=createCashActions({domainsCashController:controller,domainsCashEditor:editor,domainsCashView:view,ui});
    bound={view,actions};
  }

  return {
    bindUi,renderCash,cashBalance:selectors.cashBalance,
    assertReady:()=>{ready();return true},
    get actions(){return ready().actions},
  };
}
