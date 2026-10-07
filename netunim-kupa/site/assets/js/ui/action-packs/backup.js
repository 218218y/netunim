// Backup owns these delegated UI actions and its local event ports.
export function createBackupActions({uiBackup,uiFolders}){
const chooseBackupFolder=(...args)=>uiFolders.chooseBackupFolder(...args);
const downloadCloudBackup=(...args)=>uiBackup.downloadCloudBackup(...args);
const downloadJsonBackup=(...args)=>uiBackup.downloadJsonBackup(...args);
const downloadSelectedCloudBackup=(...args)=>uiBackup.downloadSelectedCloudBackup(...args);
const exportCSV=(...args)=>uiBackup.exportCSV(...args);
const loadMoreCloudBackups=(...args)=>uiBackup.loadMoreCloudBackups(...args);
const manualBackup=(...args)=>uiBackup.manualBackup(...args);
const previewCloudBackup=(...args)=>uiBackup.previewCloudBackup(...args);
const refreshCloudBackups=(...args)=>uiBackup.refreshCloudBackups(...args);
const restoreBackup=(...args)=>uiBackup.restoreBackup(...args);
const switchFolder=(...args)=>uiBackup.switchFolder(...args);
return {
  'manual-backup':(element,event)=>{manualBackup()},
  'download-json-backup':(element,event)=>{downloadJsonBackup()},
  'document':(element,event)=>{document.getElementById('restoreInput').click()},
  'restore-backup':(element,event)=>{restoreBackup(element.files[0])},
  'refresh-cloud-backups':(element,event)=>{refreshCloudBackups()},
  'load-more-cloud-backups':(element,event)=>{loadMoreCloudBackups()},
  'preview-cloud-backup':(element,event)=>{previewCloudBackup(element.dataset.clickArg0,element.dataset.clickArg1)},
  'download-cloud-backup':(element,event)=>{downloadCloudBackup(element.dataset.clickArg0,element.dataset.clickArg1)},
  'restore-cloud-backup':(element,event)=>{previewCloudBackup(element.dataset.clickArg0,element.dataset.clickArg1)},
  'download-selected-cloud-backup':(element,event)=>{downloadSelectedCloudBackup()},
  'switch-folder':(element,event)=>{switchFolder()},
  'choose-backup-folder':(element,event)=>{chooseBackupFolder()},
  'export-c-s-v':(element,event)=>{exportCSV('checks')},
  'export-c-s-v-2':(element,event)=>{exportCSV('credits')},
};
}
