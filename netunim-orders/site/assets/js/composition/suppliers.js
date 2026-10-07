import {createDomainsSuppliersSelectors} from '../domains/suppliers/selectors.js';
import {createDomainsSuppliersCommands} from '../domains/suppliers/commands.js';
import {createDomainsSuppliersNavigation} from '../domains/suppliers/navigation.js';
import {createDomainsSuppliersOrder} from '../domains/suppliers/order.js';
import {createDomainsSuppliersBulk} from '../domains/suppliers/bulk.js';
import {createDomainsSuppliersView} from '../domains/suppliers/view.js';
import {createDomainsSuppliersEditor} from '../domains/suppliers/editor.js';
import {createSuppliersActions} from '../ui/action-packs/suppliers.js';

// Selectors are available before the shell exists. UI controllers are bound once
// after navigation, modal and persistence exist, before any render or startup.
export function createOrdersSuppliersRuntime({model,supplierUi,ui}){
  if(!model||!supplierUi||!ui)throw new TypeError('suppliers_context_required');
  const selectors=createDomainsSuppliersSelectors({model});
  const commands=createDomainsSuppliersCommands({supplierTx:selectors.supplierTx});
  let bound=null;

  function ready(){
    if(!bound)throw new Error('suppliers_ui_not_bound');
    return bound;
  }

  function renderSupplier(...args){return ready().view.renderSupplier(...args)}

  function bindUi({uiLayout,uiNavigation,uiModal,uiStatus,storagePersistence}={}){
    if(bound)throw new Error('suppliers_ui_already_bound');
    for(const [name,port,methods] of [
      ['layout',uiLayout,['mountViewLayout','captureSupplierViewport','restoreSupplierViewport','storeSupplierViewport','scrollSupplierTransactionsEnd']],
      ['navigation',uiNavigation,['render']],
      ['modal',uiModal,['modal','triSelect','closeModal','parseTri','confirmDialog']],
      ['status',uiStatus,['toast']],
      ['persistence',storagePersistence,['scheduleSave']],
    ])for(const method of methods)if(typeof port?.[method]!=='function')throw new TypeError(`suppliers_${name}_${method}_required`);

    const scheduleSave=(message,options={})=>storagePersistence.scheduleSave(message,{...options,domains:['suppliers','transactions']});
    const navigation=createDomainsSuppliersNavigation({
      supplierUi,ui,supplierYearContext:selectors.supplierYearContext,
      renderSupplier,render:(...args)=>uiNavigation.render(...args),
    });
    const order=createDomainsSuppliersOrder({
      model,supplierUi,ui,modal:(...args)=>uiModal.modal(...args),scheduleSave,
      render:(...args)=>uiNavigation.render(...args),renderSupplier,
      closeModal:(...args)=>uiModal.closeModal(...args),
    });
    const bulk=createDomainsSuppliersBulk({
      supplierUi,model,renderSupplier,toast:(...args)=>uiStatus.toast(...args),
      supplierTx:selectors.supplierTx,supplierYearContext:selectors.supplierYearContext,
      modal:(...args)=>uiModal.modal(...args),
      resequenceSupplier:commands.resequenceSupplier,
      moveTransactionAfter:commands.moveTransactionAfter,
      supplierBalance:selectors.supplierBalance,scheduleSave,
      closeModal:(...args)=>uiModal.closeModal(...args),
      confirmDialog:(...args)=>uiModal.confirmDialog(...args),
    });
    const view=createDomainsSuppliersView({
      model,supplierUi,mountViewLayout:(...args)=>uiLayout.mountViewLayout(...args),
      orderedSuppliers:selectors.orderedSuppliers,
      captureSupplierViewport:(...args)=>uiLayout.captureSupplierViewport(...args),
      restoreSupplierViewport:(...args)=>uiLayout.restoreSupplierViewport(...args),
      syncSupplierBulkUi:(...args)=>bulk.syncSupplierBulkUi(...args),
      supplierMoveTargetRow:(...args)=>bulk.supplierMoveTargetRow(...args),
      storeSupplierViewport:(...args)=>uiLayout.storeSupplierViewport(...args),
      scrollSupplierTransactionsEnd:(...args)=>uiLayout.scrollSupplierTransactionsEnd(...args),
      scheduleSave,
    });
    const editor=createDomainsSuppliersEditor({
      model,supplierUi,ui,modal:(...args)=>uiModal.modal(...args),
      triSelect:(...args)=>uiModal.triSelect(...args),
      resequenceSupplier:commands.resequenceSupplier,
      insertTransactionAfter:commands.insertTransactionAfter,
      toast:(...args)=>uiStatus.toast(...args),scheduleSave,
      render:(...args)=>uiNavigation.render(...args),renderSupplier,
      closeModal:(...args)=>uiModal.closeModal(...args),
      parseTri:(...args)=>uiModal.parseTri(...args),
      confirmDialog:(...args)=>uiModal.confirmDialog(...args),
    });
    const actions=createSuppliersActions({
      domainsSuppliersBulk:bulk,domainsSuppliersEditor:editor,
      domainsSuppliersNavigation:navigation,domainsSuppliersOrder:order,
      domainsSuppliersView:view,supplierUi,
    });
    bound={navigation,view,actions};
  }

  function dashboardPorts(){
    return {
      supplierBalance:selectors.supplierBalance,
      supplierArchiveYears:selectors.supplierArchiveYears,
      supplierPeriodTx:selectors.supplierPeriodTx,
      supplierFinancialStats:selectors.supplierFinancialStats,
      totalStats:selectors.totalStats,
    };
  }

  function backupPorts(){
    return {
      balanceRows:selectors.balanceRows,
      supplierYearContext:selectors.supplierYearContext,
      boolText:ready().view.boolText,
    };
  }

  function initializeSelection(){supplierUi.currentSupplierId=selectors.orderedSuppliers()[0]?.id||null}

  return {
    bindUi,renderSupplier,dashboardPorts,backupPorts,initializeSelection,
    assertReady:()=>{ready();return true},
    orderedSuppliers:selectors.orderedSuppliers,
    get navigation(){return ready().navigation},
    get actions(){return ready().actions},
  };
}
