// Browser implementation of the local Bridge's I/O ports. Preferences are read
// lazily; constructing an integration neither reads storage nor starts requests.
export function createBrowserBridgePlatform({
  preferences={getItem:key=>globalThis.localStorage.getItem(key),setItem:(key,value)=>globalThis.localStorage.setItem(key,value),removeItem:key=>globalThis.localStorage.removeItem(key)},
  fetchRequest=(...args)=>globalThis.fetch(...args),
  timers={setTimeout:(...args)=>globalThis.setTimeout(...args),clearTimeout:id=>globalThis.clearTimeout(id)},
  clock={now:()=>Date.now()},
  createAbortController=()=>new AbortController(),
}={}){return {preferences,fetchRequest,timers,clock,createAbortController}}
