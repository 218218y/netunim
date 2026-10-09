import {createFinanceConnectionImporter} from '../shared/finance-connection-import.js';
import {createBankChequeImageStorage} from '../shared/bank-cheque-images.js';
import {createBankBridgeIntegration} from '../integrations/bank-bridge.js';
import {createDomainsBankController} from '../domains/bank/controller.js';
import {createDomainsBankView} from '../domains/bank/view.js';
import {createDomainsCreditController} from '../domains/credit/controller.js';
import {createKupaFinanceCloudPorts} from './finance-cloud.js';
import {createFinanceOperationScope} from '../shared/finance-fence.js';
import {createCreditPreferences} from '../platform/credit-preferences.js';

export function composeKupaFinance({
  model,session,checksSession,ui,cloudAuth,cloudTransport,syncDocument,
  syncChecksState,syncChecks,storagePersistence,uiStatus,uiNavigation,
  uiDateEditor,financeDerivations,domainsBankSelectors,domainRevisions,
  getUiModal,automaticAccess,operationAccess,
}){
  if(typeof automaticAccess!=='function')throw new Error('finance_automatic_access_required');
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

  const bankController=createDomainsBankController({
    operationScope,
    autoScope:automaticAccess,
    model,session,checksSession,
    sharedChecksHaveLocalWork:(...args)=>syncChecksState.sharedChecksHaveLocalWork(...args),
    saveSharedChecksToCloud:(...args)=>syncChecks.saveSharedChecksToCloud(...args),
    saveState:(message,options={})=>storagePersistence.saveState(message,{...options,domains:['bank','bankFeed']}),
    syncSharedChecksFromCloud:(...args)=>syncChecks.syncSharedChecksFromCloud(...args),
    sharedChecksObservedSequence:(...args)=>domainsBankSelectors.sharedChecksObservedSequence(...args),
    toast:(...args)=>uiStatus.toast(...args),
    render:(...args)=>uiNavigation.render(...args),
    bridge,
    refreshFinanceCloudSnapshot:financeCloud.refreshFinanceCloudSnapshot,
    saveFinancePatch:(...args)=>financeCloud.saveFinancePatchTracked(...args),
    claimFinanceSyncLease:financeCloud.claimFinanceSyncLease,
    releaseFinanceSyncLease:financeCloud.releaseFinanceSyncLease,
    saveBankSyncSnapshot:(...args)=>cloudTransport.saveBankSyncSnapshot(...args),
    mergeBankTransactions:(...args)=>cloudTransport.mergeBankTransactions(...args),
    syncBankTransactionsSnapshot:(...args)=>cloudTransport.syncBankTransactionsSnapshot(...args),
    readBankTransactions:(...args)=>cloudTransport.readBankTransactions(...args),
    readBankTransactionSnapshot:(...args)=>cloudTransport.readBankTransactionSnapshot(...args),
    acknowledgeBankTransactionMissing:(...args)=>cloudTransport.acknowledgeBankTransactionMissing(...args),
    syncBankChequeImages:(...args)=>chequeImages.sync(...args),
    touchBankDataRevision:()=>domainRevisions.touch(['bank','bankFeed']),
    touchBankDisplayRevision:()=>domainRevisions.touch('bankDisplay'),
  });

  const bankView=createDomainsBankView({
    runFinance:financeDerivations.run,
    modal:(...args)=>getUiModal().modal(...args),
    closeModal:(...args)=>getUiModal().closeModal(...args),
    model,ui,
    bankHomeBalance:(...args)=>domainsBankSelectors.bankHomeBalance(...args),
    bankNextCycleCommitments:(...args)=>domainsBankSelectors.bankNextCycleCommitments(...args),
    bankHomeNextCycleCommitments:(...args)=>domainsBankSelectors.bankHomeNextCycleCommitments(...args),
    bankBridgeUiState:(...args)=>bankController.bankBridgeUiState(...args),
    refreshBankBridgeStatus:(...args)=>bankController.refreshBankBridgeStatus(...args),
    ensureBankDisplayArchive:(...args)=>bankController.ensureBankDisplayArchive(...args),
    downloadBankChequeImage:(date,key)=>chequeImages.download(date,key,{assertCurrent:operationScope.captureRead()}),
    dateEditorMarkup:(...args)=>uiDateEditor.dateEditorMarkup(...args),
  });

  function createConnectionImporter(){
    return createFinanceConnectionImporter({
      bridge,
      getCreditProfiles:()=>model.state.creditSync?.profiles||[],
      confirmDialog:(...args)=>getUiModal().confirmDialog(...args),
      toast:(...args)=>uiStatus.toast(...args),
      afterImport:async()=>{
        await Promise.all([bankController.refreshBankBridgeStatus(),creditController.refreshCreditBridgeStatus({quiet:true})]);
        uiNavigation.render();
      },
    });
  }

  const automation={
    start(){bankController.startAutoSync();return creditController.startAutoSync()},
    stop(){bankController.stopAutoSync();creditController.stopAutoSync()},
  };
  return {creditController,bankController,bankView,createConnectionImporter,automation};
}
