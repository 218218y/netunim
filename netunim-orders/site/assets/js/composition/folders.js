import {createUiFolders} from '../ui/folders.js';
import {createFolderPicker} from '../platform/folder-picker.js';

// Connects folder commands to the selected native target, persistence and UI.
export function createOrdersFolderCapability({files,tab,ui,storage,preferences,presentation,picker=createFolderPicker()}){
  return createUiFolders({
    selection:{available:()=>!!files.dirHandle,capture:storage.captureSelection,select:storage.selectDirectory},
    authority:{isPrimary:()=>tab.primaryTab,rejectSecondary:presentation.rejectSecondary},
    persistence:{requestPersistence:preferences.requestPersistentBrowserStorage,refreshPermission:storage.refreshDirPermission,
      preserve:storage.preserveExistingFolderState,write:storage.writeStateToFolder,saveDirectory:preferences.saveDirHandle},
    picker,
    view:{
      toast:presentation.toast,
      success:message=>{presentation.syncStatus();presentation.toast(message);if(ui.currentView==='settings')presentation.renderSettings()},
      failure:(error,message)=>{
        console.error(error);
        if(!storage.isFolderPermissionError(error))files.folderLastError=error.message||String(error);
        presentation.syncStatus();presentation.toast(message);
      },
    },
  });
}
