import { markMutationActions } from '../../shared/action-registry.js';
export function createBackupActions({ ui, uiBackup, uiFolders, uiModal }) {
  const activateSavedFolder = (...args) => uiFolders.activateSavedFolder(...args);
  const applyJsonRestore = (...args) => uiBackup.applyJsonRestore(...args);
  const applySelectedCloudBackup = (...args) => uiBackup.applySelectedCloudBackup(...args);
  const backupToFolder = (...args) => uiFolders.backupToFolder(...args);
  const beginJsonRestore = (...args) => uiBackup.beginJsonRestore(...args);
  const chooseFolder = (...args) => uiFolders.chooseFolder(...args);
  const closeModal = (...args) => uiModal.closeModal(...args);
  const downloadCloudBackup = (...args) => uiBackup.downloadCloudBackup(...args);
  const downloadSelectedCloudBackup = (...args) => uiBackup.downloadSelectedCloudBackup(...args);
  const exportCsv = (...args) => uiBackup.exportCsv(...args);
  const exportJson = (...args) => uiBackup.exportJson(...args);
  const loadMoreCloudBackups = (...args) => uiBackup.loadMoreCloudBackups(...args);
  const previewCloudBackup = (...args) => uiBackup.previewCloudBackup(...args);
  const refreshCloudBackups = (...args) => uiBackup.refreshCloudBackups(...args);
  const actions = {
    'apply-json-restore': (element, event) => { return applyJsonRestore(); },
    'pending-json-restore': (element, event) => { ui.pendingJsonRestore = null; return closeModal(); },
    'refresh-orders-cloud-backups': (element, event) => { return refreshCloudBackups(); },
    'load-more-orders-cloud-backups': (element, event) => { return loadMoreCloudBackups(); },
    'preview-orders-cloud-backup': (element, event) => { return previewCloudBackup(element.dataset.clickArg0, element.dataset.clickArg1); },
    'download-orders-cloud-backup': (element, event) => { return downloadCloudBackup(element.dataset.clickArg0, element.dataset.clickArg1); },
    'restore-orders-cloud-backup': (element, event) => { return previewCloudBackup(element.dataset.clickArg0, element.dataset.clickArg1); },
    'download-selected-orders-cloud-backup': (element, event) => { return downloadSelectedCloudBackup(); },
    'apply-orders-cloud-backup-restore': (element, event) => { return applySelectedCloudBackup(); },
    'choose-folder': (element, event) => { return chooseFolder(); },
    'activate-saved-folder': (element, event) => { return activateSavedFolder(); },
    'backup-to-folder': (element, event) => { return backupToFolder(); },
    'export-json': (element, event) => { return exportJson(); },
    'begin-json-restore': (element, event) => { return beginJsonRestore(); },
    'export-csv': (element, event) => { return exportCsv(); },
  };
  return markMutationActions(actions, { all: ['apply-json-restore', 'apply-orders-cloud-backup-restore', 'begin-json-restore'] });
}
