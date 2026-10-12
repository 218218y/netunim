import {createFinanceConnectionImporter} from '../shared/finance-connection-import.js';
import {createBankChequeImageStorage} from '../shared/bank-cheque-images.js';
import {createBankBridgeIntegration} from '../integrations/bank-bridge.js';
import {createKupaBankCapability} from './bank.js';
import {createKupaFinanceCloudPorts} from './finance-cloud.js';
import {createFinanceOperationScope} from '../shared/finance-fence.js';

export function composeKupaFinance({
  model,session,ui,cloudAuth,cloudTransport,syncDocument,
  checks,credit,storagePersistence,uiStatus,uiNavigation,
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

  credit.bindServices({
    bridge,authority:{scope:operationScope,automaticAccess},
    persistence:{save:(message,options={})=>storagePersistence.saveState(message,{...options,domains:['creditSync']})},
    cloud:{refresh:financeCloud.refreshFinanceCloudSnapshot,commit:(...args)=>financeCloud.saveFinancePatchTracked(...args),
      claimLease:financeCloud.claimFinanceSyncLease,releaseLease:financeCloud.releaseFinanceSyncLease},
    presentation:{toast:(...args)=>uiStatus.toast(...args),render:(...args)=>uiNavigation.render(...args),
      renderStatus:()=>{if(ui.currentPage==='credit')uiNavigation.render()},
      closeModal:(...args)=>getUiModal().closeModal(...args),confirmDialog:(...args)=>getUiModal().confirmDialog(...args)},
  });

  const bank=createKupaBankCapability({
    model,session,bridge,readout:bankQueries,
    authority:{scope:operationScope,automaticAccess},
    checks:{hasLocalWork:(...args)=>checks.queries.hasLocalWork(...args),
      sync:(...args)=>checks.commands.sync(...args),save:(...args)=>checks.commands.saveCloud(...args)},
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
        await Promise.all([bank.queries.refreshStatus(),credit.queries.refreshStatus({quiet:true})]);
        if(bank.runtime.isActive())uiNavigation.render();
      },
    });
  }

  const automation={
    start(){bank.runtime.start();return credit.runtime.start()},
    stop(){bank.runtime.stop();credit.runtime.stop()},
  };
  function bindBankUi(){
    const nextImport=createConnectionImporter();
    bank.bindUi({ui,modal:getUiModal(),date:uiDateEditor,toast:(...args)=>uiStatus.toast(...args),
      render:(...args)=>uiNavigation.render(...args),runFinance:financeDerivations.run,importConnections:nextImport});
    return true;
  }
  return {bank,bindBankUi,automation};
}
