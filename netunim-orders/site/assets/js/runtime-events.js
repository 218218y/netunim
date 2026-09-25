import {bindBackdropDismissal} from './shared/events.js';
import {$} from './state/constants.js';

// Browser lifecycle wiring lives outside the composition root so main.js only composes domain ports.
export function bindOrdersRuntimeEvents({uiModal,uiNavigation,domainsSuppliersNavigation,cloudAuth,uiStatus,syncChecks,tab,session,domainsCustomers,domainsFinanceController,stateSnapshots,syncDocument,uiFolders,uiAlertCenter,uiTabGuard,storageV2=null,sharedChecksV2=null}){
  bindBackdropDismissal($('#modalBackdrop'),()=>uiModal.dismissModal());
  document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>uiNavigation.switchView(button.dataset.view)));
  document.addEventListener('visibilitychange',()=>{if(document.hidden||session.storageProtocolBlocked)return;if(cloudAuth.loadSession()&&!uiStatus.startupDomainLocked('checks'))setTimeout(syncChecks.pollSharedChecks,120);if(tab.primaryTab&&navigator.onLine&&cloudAuth.loadSession())setTimeout(()=>void domainsCustomers.recoverPendingMorningOperation({quiet:true}),180);if(!uiStatus.startupDomainLocked('finance'))domainsFinanceController.startAutoSync()});
  window.addEventListener('online',()=>{if(session.storageProtocolBlocked)return;if(cloudAuth.cloudEnabled()){uiStatus.setCloud('ענן: חזרה רשת…');setTimeout(()=>{const resume=stateSnapshots.cloudHasLocalWork()?syncDocument.requestCloudSave('שינויים ממתינים סונכרנו'):Promise.resolve(true);resume.then(()=>syncDocument.cloudPoll())},250)}else if(cloudAuth.loadSession()&&!uiStatus.startupDomainLocked('checks'))setTimeout(syncChecks.pollSharedChecks,300);if(tab.primaryTab&&cloudAuth.loadSession())setTimeout(()=>void domainsCustomers.recoverPendingMorningOperation({quiet:true}),450);if(!uiStatus.startupDomainLocked('finance'))domainsFinanceController.startAutoSync()});
  window.addEventListener('offline',()=>{if(cloudAuth.cloudEnabled())uiStatus.setCloud('ענן: אופליין','offline')});
  window.addEventListener('beforeunload',event=>{if(!tab.primaryTab||!(storageV2?.durabilityAtRisk||sharedChecksV2?.durabilityAtRisk||session?.localUndurableGenerations?.size))return;event.preventDefault();event.returnValue=''});
  if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js').catch(console.error));
  document.getElementById('folderAccessButton').addEventListener('click',uiFolders.handleTopFolderAccess);
  document.getElementById('alertCenterButton').addEventListener('click',()=>uiAlertCenter.openAlertCenter());
  document.getElementById('retryPrimaryTab').addEventListener('click',uiTabGuard.retryPrimaryTabLock);
}
