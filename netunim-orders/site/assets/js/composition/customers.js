import {createMorningRequest} from '../integrations/morning.js';
import {createDomainsCustomersSelectors} from '../domains/customers/selectors.js';
import {createDomainsCustomers} from '../domains/customers/composition.js';
import {createCustomersActions} from '../ui/action-packs/customers.js';
import {createMorningActions} from '../ui/action-packs/morning.js';

// Read-only customer totals are needed by Dashboard before the UI is assembled.
// Morning issuance, recovery, and customer-debt persistence remain owned by the
// existing domain implementation; this boundary controls its construction and
// exposes only the commands that other capabilities actually need.
export function createOrdersCustomersRuntime({model,customerUi,customerRevision}={}){
  if(!model||!customerUi||typeof customerRevision!=='function')throw new TypeError('customers_context_required');
  const selectors=createDomainsCustomersSelectors({model});
  let bound=null;
  function ready(){
    if(!bound)throw new Error('customers_ui_not_bound');
    return bound;
  }

  function bindUi({morningOperationScope,uiLayout,uiModal,uiStatus,storagePersistence,cloudAuth,uiNavigation,uiDateEditor,refreshForMorningRecovery,bankTransactions}={}){
    if(bound)throw new Error('customers_ui_already_bound');
    for(const [name,port,methods] of [
      ['layout',uiLayout,['bindScrollViewport','mountViewLayout']],
      ['modal',uiModal,['modal','closeModal','confirmDialog','markModalDraftSaved']],
      ['status',uiStatus,['toast']],
      ['persistence',storagePersistence,['scheduleSave','rejectSecondaryAction','rejectSecondaryMutation']],
      ['cloud',cloudAuth,['supaFetch']],
      ['morning',morningOperationScope,['capture','captureRead']],
      ['navigation',uiNavigation,['setCustomerRoute']],
      ['date',uiDateEditor,['dateEditorMarkup','setDateValue']],
      ['bank',bankTransactions,['getTransactions','ensureTransactions','onDocumentVerified']],
    ])for(const method of methods)if(typeof port?.[method]!=='function')throw new TypeError(`customers_${name}_${method}_required`);
    if(typeof refreshForMorningRecovery!=='function')throw new TypeError('customers_recovery_refresh_required');

    const domain=createDomainsCustomers({
      morningOperationScope,morningRequest:createMorningRequest({supaFetch:(...args)=>cloudAuth.supaFetch(...args),operationScope:morningOperationScope}),customerRevision,model,customerUi,selectors,
      uiLayout,uiModal,uiStatus,storagePersistence,uiNavigation,uiDateEditor,
      refreshForMorningRecovery,
      getBusinessBankTransactions:bankTransactions.getTransactions,
      ensureBusinessBankTransactions:bankTransactions.ensureTransactions,
      onBankDocumentVerified:bankTransactions.onDocumentVerified,
    });
    const actions=createCustomersActions({customerUi,domainsCustomers:domain});
    const morningActions=createMorningActions({domainsCustomers:domain});
    bound={domain,actions,morningActions};
  }

  return {
    customerStats:selectors.customerStats,
    dispose:()=>bound?.domain.dispose(),
    bindUi,
    assertReady:()=>{ready();return true},
    renderCustomers:(...args)=>ready().domain.renderCustomers(...args),
    openBankMorningDocument:(...args)=>ready().domain.openBankMorningDocument(...args),
    recoverPendingMorningOperation:(...args)=>ready().domain.recoverPendingMorningOperation(...args),
    get actions(){return ready().actions},
    get morningActions(){return ready().morningActions},
    // Browser audit harnesses exercise verified Morning replay against the real
    // editor/view; these existing integration seams remain available post-bind.
    get editor(){return ready().domain.editor},
    get view(){return ready().domain.view},
  };
}
