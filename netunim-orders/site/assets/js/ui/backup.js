import {createBackupBrowserResources} from '../shared/backup-browser-resources.js';
import {createBackupFileAuthority} from '../shared/backup-file-authority.js';
import {createBackupRestore} from './backup-restore.js';
import {createBackupLocal} from './backup-local.js';
import {createBackupCatalog} from './backup-catalog.js';
import {syncRecoveryDiffText} from './backup-presentation.js';

// Composes the independent restore, local file and cloud catalog capabilities.
export function createUiBackup({model,session,ui,tab,checksSession,projection={},view={},local={},cloud={},storage={}}){
  let disposed=false;
  const authority=createBackupFileAuthority({
    owner:()=>storage.storageOwnerCurrent(),generation:()=>Number(session.localGeneration||0),
    account:()=>cloud.accountScope(),
    writable:()=>tab.primaryTab&&storage.storageV2LocalPrimary(),
  });
  const browser=view.browserResources??createBackupBrowserResources({authority});
  const downloadBlob=(...args)=>browser.download(...args);
  const restore=createBackupRestore({model,session,tab,checksSession,projection,view,local,cloud,storage,browser});
  const localFiles=createBackupLocal({model,ui,tab,projection,view,restore,browser});
  const catalog=createBackupCatalog({model,ui,projection,view,cloud,restore,browser});
  const invalidate=()=>{localFiles.invalidate?.();catalog.invalidate();return browser.runtime.invalidate()};
  const unsubscribe=cloud.subscribeAccountScope(()=>{if(!disposed)invalidate()});
  const runtime={
    cancelPending:invalidate,isPending:browser.runtime.isPending,drain:browser.runtime.drain,
    dispose(){if(disposed)return false;disposed=true;unsubscribe();localFiles.invalidate?.();catalog.invalidate();return browser.runtime.dispose()},
  };
  const active=command=>(...args)=>disposed?false:command(...args);
  return {
    runtime,
    syncRecoveryDiffText,
    downloadBlob:active(downloadBlob),
    exportJson:active(localFiles.exportJson),
    beginJsonRestore:active(localFiles.beginJsonRestore),
    applyJsonRestore:active(localFiles.applyJsonRestore),
    resumeIncompleteRestore:active(restore.resumeIncompleteRestore),
    refreshCloudBackups:active(catalog.refreshCloudBackups),
    loadMoreCloudBackups:active(catalog.loadMoreCloudBackups),
    previewCloudBackup:active(catalog.previewCloudBackup),
    downloadCloudBackup:active(catalog.downloadCloudBackup),
    downloadSelectedCloudBackup:active(catalog.downloadSelectedCloudBackup),
    applySelectedCloudBackup:active(catalog.applySelectedCloudBackup),
    exportCsv:active(localFiles.exportCsv),
  };
}
