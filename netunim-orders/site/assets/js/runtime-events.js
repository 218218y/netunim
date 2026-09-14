import {bindBackdropDismissal} from './shared/events.js';
import {$} from './state/constants.js';

// Browser lifecycle wiring lives outside the composition root so main.js only composes domain ports.
export function bindOrdersRuntimeEvents({uiModal,uiNavigation,domainsSuppliersNavigation,cloudAuth,uiStatus,syncChecks,tab,domainsCustomers,domainsFinanceController,stateSnapshots,syncDocument,storageBrowser,storageChecks,storagePersistence,uiFolders,uiAlertCenter,uiTabGuard}){
  bindBackdropDismissal($('#modalBackdrop'),()=>uiModal.dismissModal());
  document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>uiNavigation.switchView(button.dataset.view)));
  document.addEventListener('click',event=>{const menu=$('#supplierMenu');if(menu&&!menu.contains(event.target))domainsSuppliersNavigation.closeSupplierMenu()});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')domainsSuppliersNavigation.closeSupplierMenu()});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)return;if(cloudAuth.loadSession()&&!uiStatus.startupDomainLocked('checks'))setTimeout(syncChecks.pollSharedChecks,120);if(tab.primaryTab&&navigator.onLine&&cloudAuth.loadSession())setTimeout(()=>void domainsCustomers.recoverPendingMorningOperation({quiet:true}),180);if(!uiStatus.startupDomainLocked('finance'))domainsFinanceController.startAutoSync()});
  window.addEventListener('online',()=>{if(cloudAuth.cloudEnabled()){uiStatus.setCloud('ענן: חזרה רשת…');setTimeout(()=>{const resume=stateSnapshots.cloudHasLocalWork()?syncDocument.requestCloudSave('שינויים ממתינים סונכרנו'):Promise.resolve(true);resume.then(()=>syncDocument.cloudPoll())},250)}else if(cloudAuth.loadSession()&&!uiStatus.startupDomainLocked('checks'))setTimeout(syncChecks.pollSharedChecks,300);if(tab.primaryTab&&cloudAuth.loadSession())setTimeout(()=>void domainsCustomers.recoverPendingMorningOperation({quiet:true}),450);if(!uiStatus.startupDomainLocked('finance'))domainsFinanceController.startAutoSync()});
  window.addEventListener('offline',()=>{if(cloudAuth.cloudEnabled())uiStatus.setCloud('ענן: אופליין','offline')});
  window.addEventListener('pagehide',()=>{if(!tab.primaryTab)return;storageBrowser.localSnapshot();if(cloudAuth.cloudEnabled()&&stateSnapshots.cloudHasLocalWork())storageBrowser.markCloudPending();if(cloudAuth.loadSession()&&stateSnapshots.checksHaveLocalWork())storageChecks.markChecksPending()});
  if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js').catch(console.error));
  document.getElementById('saveNowButton').addEventListener('click',()=>{if(uiStatus.guardStartupMutation('all'))storagePersistence.manualSaveNow()});
  document.getElementById('folderAccessButton').addEventListener('click',uiFolders.handleTopFolderAccess);
  document.getElementById('alertCenterButton').addEventListener('click',()=>uiAlertCenter.openAlertCenter());
  document.getElementById('retryPrimaryTab').addEventListener('click',uiTabGuard.retryPrimaryTabLock);
}
