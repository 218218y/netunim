import {createBackupBrowserResources} from '../shared/backup-browser-resources.js';
import {createBackupFileAuthority} from '../shared/backup-file-authority.js';
import {createBackupRestore} from './backup-restore.js';
import {createBackupLocal} from './backup-local.js';
import {createBackupCatalog} from './backup-catalog.js';

// Composes the independent restore, local file and cloud catalog capabilities.
export function createUiBackup({model,session,ui,files,checksSession,projection={},view={},local={},cloud={},storage={}}){
  let disposed=false;
  const authority=createBackupFileAuthority({
    owner:()=>storage.storageOwnerCurrent(),generation:()=>Number(session.localGeneration||0),
    account:()=>cloud.accountScope(),
    writable:()=>storage.storageV2LocalPrimary(),
  });
  const browser=view.browserResources??createBackupBrowserResources({authority});
  const downloadText=(name,text,type,scope)=>browser.download(new Blob([text],{type}),name,scope);
  const restore=createBackupRestore({model,session,files,checksSession,view,local,cloud,storage});
  const localFiles=createBackupLocal({model,session,ui,files,projection,view,local,restore,browser});
  const catalog=createBackupCatalog({model,session,ui,projection,view,cloud,restore,browser});
  const invalidate=()=>{localFiles.invalidate?.();catalog.invalidate();return browser.runtime.invalidate()};
  const unsubscribe=cloud.subscribeAccountScope(()=>{if(!disposed)invalidate()});
  const runtime={
    cancelPending:invalidate,isPending:browser.runtime.isPending,drain:browser.runtime.drain,
    dispose(){if(disposed)return false;disposed=true;unsubscribe();localFiles.invalidate?.();catalog.invalidate();return browser.runtime.dispose()},
  };
  const active=command=>(...args)=>disposed?false:command(...args);
  return {
    runtime,
    manualBackup:active(localFiles.manualBackup),
    downloadJsonBackup:active(localFiles.downloadJsonBackup),
    beginRestoreBackup:active(localFiles.beginRestoreBackup),
    restoreBackup:active(localFiles.restoreBackup),
    resumeIncompleteRestore:active(restore.resumeIncompleteRestore),
    refreshCloudBackups:active(catalog.refreshCloudBackups),
    loadMoreCloudBackups:active(catalog.loadMoreCloudBackups),
    previewCloudBackup:active(catalog.previewCloudBackup),
    downloadCloudBackup:active(catalog.downloadCloudBackup),
    downloadSelectedCloudBackup:active(catalog.downloadSelectedCloudBackup),
    applySelectedCloudBackup:active(catalog.applySelectedCloudBackup),
    switchFolder:active(localFiles.switchFolder),
    exportCSV:active(localFiles.exportCSV),
    downloadText:active(downloadText),
  };
}
