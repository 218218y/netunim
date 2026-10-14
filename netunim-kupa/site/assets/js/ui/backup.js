import {createBackupRestore} from './backup-restore.js';
import {createBackupLocal} from './backup-local.js';
import {createBackupCatalog} from './backup-catalog.js';
import {downloadText} from './backup-download.js';

// Composes the independent restore, local file and cloud catalog capabilities.
export function createUiBackup({model,session,ui,files,checksSession,projection={},view={},local={},cloud={},storage={}}){
  const restore=createBackupRestore({model,session,files,checksSession,view,local,cloud,storage});
  const localFiles=createBackupLocal({model,session,ui,files,projection,view,local,restore});
  const catalog=createBackupCatalog({model,session,ui,projection,view,cloud,restore});
  return {
    manualBackup:localFiles.manualBackup,
    downloadJsonBackup:localFiles.downloadJsonBackup,
    restoreBackup:localFiles.restoreBackup,
    resumeIncompleteRestore:restore.resumeIncompleteRestore,
    refreshCloudBackups:catalog.refreshCloudBackups,
    loadMoreCloudBackups:catalog.loadMoreCloudBackups,
    previewCloudBackup:catalog.previewCloudBackup,
    downloadCloudBackup:catalog.downloadCloudBackup,
    downloadSelectedCloudBackup:catalog.downloadSelectedCloudBackup,
    applySelectedCloudBackup:catalog.applySelectedCloudBackup,
    switchFolder:localFiles.switchFolder,
    exportCSV:localFiles.exportCSV,
    downloadText,
  };
}
