import {markMutationActions} from '../../shared/action-registry.js';

export function createBackupActions({ui,uiBackup,uiFolders,uiModal}){
const activateSavedFolder=(...args)=>uiFolders.activateSavedFolder(...args);
const applyJsonRestore=(...args)=>uiBackup.applyJsonRestore(...args);
const applySelectedCloudBackup=(...args)=>uiBackup.applySelectedCloudBackup(...args);
const backupToFolder=(...args)=>uiFolders.backupToFolder(...args);
const beginJsonRestore=(...args)=>uiBackup.beginJsonRestore(...args);
const chooseFolder=(...args)=>uiFolders.chooseFolder(...args);
const closeModal=(...args)=>uiModal.closeModal(...args);
const downloadCloudBackup=(...args)=>uiBackup.downloadCloudBackup(...args);
const downloadSelectedCloudBackup=(...args)=>uiBackup.downloadSelectedCloudBackup(...args);
const exportCsv=(...args)=>uiBackup.exportCsv(...args);
const exportJson=(...args)=>uiBackup.exportJson(...args);
const loadMoreCloudBackups=(...args)=>uiBackup.loadMoreCloudBackups(...args);
const previewCloudBackup=(...args)=>uiBackup.previewCloudBackup(...args);
const refreshCloudBackups=(...args)=>uiBackup.refreshCloudBackups(...args);
const actions={
  'apply-json-restore':(element,event)=>{applyJsonRestore()},
  'pending-json-restore':(element,event)=>{ui.pendingJsonRestore=null;closeModal()},
  'refresh-orders-cloud-backups':(element,event)=>{refreshCloudBackups()},
  'load-more-orders-cloud-backups':(element,event)=>{loadMoreCloudBackups()},
  'preview-orders-cloud-backup':(element,event)=>{previewCloudBackup(element.dataset.clickArg0,element.dataset.clickArg1)},
  'download-orders-cloud-backup':(element,event)=>{downloadCloudBackup(element.dataset.clickArg0,element.dataset.clickArg1)},
  'restore-orders-cloud-backup':(element,event)=>{previewCloudBackup(element.dataset.clickArg0,element.dataset.clickArg1)},
  'download-selected-orders-cloud-backup':(element,event)=>{downloadSelectedCloudBackup()},
  'apply-orders-cloud-backup-restore':(element,event)=>{applySelectedCloudBackup()},
  'choose-folder':(element,event)=>{chooseFolder()},
  'activate-saved-folder':(element,event)=>{activateSavedFolder()},
  'backup-to-folder':(element,event)=>{backupToFolder()},
  'export-json':(element,event)=>{exportJson()},
  'begin-json-restore':(element,event)=>{beginJsonRestore()},
  'export-csv':(element,event)=>{exportCsv()},
};
return markMutationActions(actions,{all:['apply-json-restore', 'apply-orders-cloud-backup-restore', 'begin-json-restore']});
}
