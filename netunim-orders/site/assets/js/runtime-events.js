import {createOrdersConnectivityRuntime} from './connectivity.js';
import {bindBackdropDismissal} from './shared/events.js';
import {$} from './state/constants.js';

// Browser lifecycle wiring lives outside the composition root so main.js only composes domain ports.
export function bindOrdersRuntimeEvents({uiModal,uiNavigation,domainsSuppliersNavigation,cloudAuth,uiStatus,syncChecks,tab,session,recoverPendingMorningOperation,domainsFinanceController,stateSnapshots,syncDocument,uiFolders,uiAlertCenter,uiTabGuard,storageV2=null,sharedChecksV2=null}){
  bindBackdropDismissal($('#modalBackdrop'),()=>uiModal.dismissModal());
  document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>uiNavigation.switchView(button.dataset.view)));
  const connectivity=createOrdersConnectivityRuntime({
    access:{primary:()=>tab.primaryTab,blocked:()=>session.storageProtocolBlocked,authenticated:()=>!!cloudAuth.loadSession()},
    cloud:{enabled:()=>cloudAuth.cloudEnabled(),resumeAfterReconnect:()=>syncDocument.resumeAfterReconnect()},
    checks:syncChecks,finance:domainsFinanceController,morning:{recoverPendingMorningOperation},status:uiStatus,
  });
  connectivity.start();
  window.addEventListener('beforeunload',event=>{if(!tab.primaryTab||!(storageV2?.durabilityAtRisk||sharedChecksV2?.durabilityAtRisk||session?.localUndurableGenerations?.size))return;event.preventDefault();event.returnValue=''});
  if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js').catch(console.error));
  document.getElementById('folderAccessButton').addEventListener('click',uiFolders.handleTopFolderAccess);
  document.getElementById('alertCenterButton').addEventListener('click',()=>uiAlertCenter.openAlertCenter());
  document.getElementById('retryPrimaryTab').addEventListener('click',uiTabGuard.retryPrimaryTabLock);
  return connectivity;
}
