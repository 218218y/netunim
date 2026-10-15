// Browser authority is bound at composition. Sync policies receive synchronous
// connectivity and preference commands without access to browser globals.
export function createMainSyncBrowserPorts({storagePreferenceKey='',autoConnectKey=''}={}){
  return {
    isOnline:()=>globalThis.navigator?.onLine!==false,
    reload:()=>globalThis.location?.reload?.(),
    markCloudMode:()=>{
      if(storagePreferenceKey)globalThis.localStorage.setItem(storagePreferenceKey,'supabase');
      if(autoConnectKey)globalThis.localStorage.setItem(autoConnectKey,'1');
    },
  };
}
