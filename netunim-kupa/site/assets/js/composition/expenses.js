import {createDomainsExpensesView} from '../domains/expenses/view.js';
import {createDomainsExpensesEditor} from '../domains/expenses/editor.js';
import {createExpensesActions} from '../ui/action-packs/expenses.js';

// Credit hosts the expense view before its editor exists. Construct that
// read-only side first, then bind editing after the shell and Credit view exist.
export function createKupaExpensesRuntime({model,ui,bankForecast}){
  if(!model||!ui)throw new TypeError('expenses_context_required');
  if(typeof bankForecast?.business!=='function'||typeof bankForecast?.home!=='function')throw new TypeError('expenses_bank_forecast_required');
  const view=createDomainsExpensesView({
    model,ui,
    bankNextCycleCommitments:(...args)=>bankForecast.business(...args),
    bankHomeNextCycleCommitments:(...args)=>bankForecast.home(...args),
  });
  let actions=null;

  function bindEditor({uiModal,uiDateEditor,uiStatus,storagePersistence,domainsRecordsCommands,renderCredit}={}){
    if(actions)throw new Error('expenses_editor_already_bound');
    for(const [name,port,methods] of [
      ['modal',uiModal,['armModalDraftGuard','modal','closeModal']],
      ['date',uiDateEditor,['dateEditorMarkup']],
      ['status',uiStatus,['toast']],
      ['persistence',storagePersistence,['saveState']],
      ['records',domainsRecordsCommands,['deleteRecord']],
    ])for(const method of methods)if(typeof port?.[method]!=='function')throw new TypeError(`expenses_${name}_${method}_required`);
    if(typeof renderCredit!=='function')throw new TypeError('expenses_render_credit_required');

    const editor=createDomainsExpensesEditor({
      model,
      armModalDraftGuard:(...args)=>uiModal.armModalDraftGuard(...args),
      modal:(...args)=>uiModal.modal(...args),
      deleteRecord:(...args)=>domainsRecordsCommands.deleteRecord(...args),
      saveState:(message,options={})=>storagePersistence.saveState(message,{...options,domains:['expenses']}),
      toast:(...args)=>uiStatus.toast(...args),
      closeModal:(...args)=>uiModal.closeModal(...args),
      dateEditorMarkup:(...args)=>uiDateEditor.dateEditorMarkup(...args),
      renderCredit,
    });
    actions=createExpensesActions({domainsExpensesEditor:editor,domainsExpensesView:view,ui});
  }

  function ready(){
    if(!actions)throw new Error('expenses_editor_not_bound');
    return actions;
  }

  return {
    bindEditor,expensesMarkup:(...args)=>view.expensesMarkup(...args),
    assertReady:()=>{ready();return true},
    get actions(){return ready()},
  };
}
