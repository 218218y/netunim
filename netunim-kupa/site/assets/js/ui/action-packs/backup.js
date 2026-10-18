// Backup owns these delegated UI actions and its local event ports.
export function createBackupActions({ uiBackup, uiFolders }) {
  const chooseBackupFolder = (...args) => uiFolders.chooseBackupFolder(...args);
  const downloadCloudBackup = (...args) => uiBackup.downloadCloudBackup(...args);
  const downloadJsonBackup = (...args) => uiBackup.downloadJsonBackup(...args);
  const downloadSelectedCloudBackup = (...args) => uiBackup.downloadSelectedCloudBackup(...args);
  const exportCSV = (...args) => uiBackup.exportCSV(...args);
  const loadMoreCloudBackups = (...args) => uiBackup.loadMoreCloudBackups(...args);
  const manualBackup = (...args) => uiBackup.manualBackup(...args);
  const previewCloudBackup = (...args) => uiBackup.previewCloudBackup(...args);
  const refreshCloudBackups = (...args) => uiBackup.refreshCloudBackups(...args);
  const beginRestoreBackup = (...args) => uiBackup.beginRestoreBackup(...args);
  const switchFolder = (...args) => uiBackup.switchFolder(...args);
  return {
    'manual-backup': (element, event) => { return manualBackup(); },
    'download-json-backup': (element, event) => { return downloadJsonBackup(); },
    'document': () => beginRestoreBackup(),
    'refresh-cloud-backups': (element, event) => { return refreshCloudBackups(); },
    'load-more-cloud-backups': (element, event) => { return loadMoreCloudBackups(); },
    'preview-cloud-backup': (element, event) => { return previewCloudBackup(element.dataset.clickArg0, element.dataset.clickArg1); },
    'download-cloud-backup': (element, event) => { return downloadCloudBackup(element.dataset.clickArg0, element.dataset.clickArg1); },
    'restore-cloud-backup': (element, event) => { return previewCloudBackup(element.dataset.clickArg0, element.dataset.clickArg1); },
    'download-selected-cloud-backup': (element, event) => { return downloadSelectedCloudBackup(); },
    'switch-folder': (element, event) => { return switchFolder(); },
    'choose-backup-folder': (element, event) => { return chooseBackupFolder(); },
    'export-c-s-v': (element, event) => { return exportCSV('checks'); },
    'export-c-s-v-2': (element, event) => { return exportCSV('credits'); },
  };
}
