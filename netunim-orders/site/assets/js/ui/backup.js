import {createBackupRestore} from './backup-restore.js';
import {createBackupLocal} from './backup-local.js';
import {createBackupCatalog} from './backup-catalog.js';
import {downloadBlob} from './backup-download.js';
import {syncRecoveryDiffText} from './backup-presentation.js';

// Composes the independent restore, local file and cloud catalog capabilities.
export function createUiBackup({model,session,ui,tab,checksSession,projection={},view={},local={},cloud={},storage={}}){
  const restore=createBackupRestore({model,session,tab,checksSession,projection,view,local,cloud,storage});
  const localFiles=createBackupLocal({model,ui,tab,projection,view,restore});
  const catalog=createBackupCatalog({model,ui,projection,view,cloud,restore});
  return {
    syncRecoveryDiffText,
    downloadBlob,
    exportJson:localFiles.exportJson,
    beginJsonRestore:localFiles.beginJsonRestore,
    applyJsonRestore:localFiles.applyJsonRestore,
    resumeIncompleteRestore:restore.resumeIncompleteRestore,
    refreshCloudBackups:catalog.refreshCloudBackups,
    loadMoreCloudBackups:catalog.loadMoreCloudBackups,
    previewCloudBackup:catalog.previewCloudBackup,
    downloadCloudBackup:catalog.downloadCloudBackup,
    downloadSelectedCloudBackup:catalog.downloadSelectedCloudBackup,
    applySelectedCloudBackup:catalog.applySelectedCloudBackup,
    exportCsv:localFiles.exportCsv,
  };
}
