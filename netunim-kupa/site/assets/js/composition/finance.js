import {createFinanceConnectionImporter} from '../shared/finance-connection-import.js';
import {createBankChequeImageStorage} from '../shared/bank-cheque-images.js';
import {createBankBridgeIntegration} from '../integrations/bank-bridge.js';
import {createKupaBankCapability} from './bank.js';
import {createDomainsCreditController} from '../domains/credit/controller.js';
import {createKupaFinanceCloudPorts} from './finance-cloud.js';
import {createFinanceOperationScope} from '../shared/finance-fence.js';
import {createCreditPreferences} from '../platform/credit-preferences.js';

export function composeKupaFinance({
  model,session,ui,cloudAuth,cloudTransport,syncDocument,
  syncChecksState,syncChecks,storagePersistence,uiStatus,uiNavigation,
  uiDateEditor,financeDerivations,bankQueries,domainRevisions,
  getUiModal,automaticAccess,operationAccess,
}){
  if(typeof automaticAccess!=='function')throw new Error('finance_automatic_access_required');
  if(typeof storagePersistence?.recoverLocalState!=='function')throw new TypeError('finance_local_recovery_required');
  const bridge=createBankBridgeIntegration();
  const chequeImages=createBankChequeImageStorage({
    supaFetch:(...args)=>cloudAuth.supaRest(...args),
    ensureSession:(...args)=>cloudAuth.supaEnsureSession(...args),
    fetchBridgeImage:(...args)=>bridge.fetchChequeImage(...args),
  });
  const financeCloud=createKupaFinanceCloudPorts({model,session,cloudTransport,syncDocument});
  const operationScope=createFinanceOperationScope({readAccess:operationAccess});

  const creditController=createDomainsCreditController({
    preferences:createCreditPreferences(),
    captureOperation:operationScope.capture,
    autoScope:automaticAccess,
    model,
    saveState:(message,options={})=>storagePersistence.saveState(message,{...options,domains:['creditSync']}),
    toast:(...args)=>uiStatus.toast(...args),
    render:(...args)=>uiNavigation.render(...args),
    renderStatus:()=>{if(ui.currentPage==='credit')uiNavigation.render()},
    bridge,
    modal:(...args)=>getUiModal().modal(...args),
    armModalDraftGuard:(...args)=>getUiModal().armModalDraftGuard(...args),
    closeModal:(...args)=>getUiModal().closeModal(...args),
    confirmDialog:(...args)=>getUiModal().confirmDialog(...args),
    refreshFinanceCloudSnapshot:financeCloud.refreshFinanceCloudSnapshot,
    saveFinancePatch:(...args)=>financeCloud.saveFinancePatchTracked(...args),
    claimFinanceSyncLease:financeCloud.claimFinanceSyncLease,
    releaseFinanceSyncLease:financeCloud.releaseFinanceSyncLease,
  });

  const bank=createKupaBankCapability({
    model,session,bridge,readout:bankQueries,
    authority:{scope:operationScope,automaticAccess},
    checks:{hasLocalWork:(...args)=>syncChecksState.sharedChecksHaveLocalWork(...args),
      sync:(...args)=>syncChecks.syncSharedChecksFromCloud(...args),save:(...args)=>syncChecks.saveSharedChecksToCloud(...args)},
    persistence:{save:(message,options={})=>storagePersistence.saveState(message,{...options,domains:['bank','bankFeed']}),
      recover:assertCurrent=>storagePersistence.recoverLocalState(assertCurrent)},
    cloud:{refreshFinance:financeCloud.refreshFinanceCloudSnapshot,saveFinancePatch:(...args)=>financeCloud.saveFinancePatchTracked(...args),
      claimLease:financeCloud.claimFinanceSyncLease,releaseLease:financeCloud.releaseFinanceSyncLease,
      saveSnapshot:(...args)=>cloudTransport.saveBankSyncSnapshot(...args),mergeTransactions:(...args)=>cloudTransport.mergeBankTransactions(...args),
      syncTransactions:(...args)=>cloudTransport.syncBankTransactionsSnapshot(...args),readTransactions:(...args)=>cloudTransport.readBankTransactions(...args),
      readTransactionSnapshot:(...args)=>cloudTransport.readBankTransactionSnapshot(...args),acknowledgeMissing:(...args)=>cloudTransport.acknowledgeBankTransactionMissing(...args),
      syncImages:(...args)=>chequeImages.sync(...args),downloadImage:(...args)=>chequeImages.download(...args)},
    revisions:{touchData:()=>domainRevisions.touch(['bank','bankFeed']),touchDisplay:()=>domainRevisions.touch('bankDisplay')},
  });
  function createConnectionImporter(){
    return createFinanceConnectionImporter({
      bridge,
      getCreditProfiles:()=>model.state.creditSync?.profiles||[],
      confirmDialog:async(...args)=>bank.runtime.isActive()&&await getUiModal().confirmDialog(...args)&&bank.runtime.isActive(),
      toast:(...args)=>{if(bank.runtime.isActive())uiStatus.toast(...args)},
      afterImport:async()=>{
        if(!bank.runtime.isActive())return;
        await Promise.all([bank.queries.refreshStatus(),creditController.refreshCreditBridgeStatus({quiet:true})]);
        if(bank.runtime.isActive())uiNavigation.render();
      },
    });
  }

  const automation={
    start(){bank.runtime.start();return creditController.startAutoSync()},
    stop(){bank.runtime.stop();creditController.stopAutoSync()},
  };
  function bindBankUi(){
    const nextImport=createConnectionImporter();
    bank.bindUi({ui,modal:getUiModal(),date:uiDateEditor,toast:(...args)=>uiStatus.toast(...args),
      render:(...args)=>uiNavigation.render(...args),runFinance:financeDerivations.run,importConnections:nextImport});
    return true;
  }
  return {creditController,bank,bindBankUi,automation};
}
