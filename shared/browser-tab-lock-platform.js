// @ts-check

/** @typedef {{notify:(id:string)=>void,close:()=>void}} PrimaryTabChannel */
/** @typedef {{now:()=>number,random:()=>number,setTimeout:(run:()=>void,delay:number)=>number,clearTimeout:(id:number)=>void,setInterval:(run:()=>void,delay:number)=>number,clearInterval:(id:number)=>void}} PrimaryTabClock */
/** @typedef {{requestNative:((name:string,hold:(granted:boolean)=>Promise<void>)=>Promise<void>)|null,identity:()=>string,lease:Pick<Storage,'getItem'|'setItem'|'removeItem'>,
 * events:{pageHide:(run:()=>void)=>()=>void,storage:(key:string,run:(raw:string|null)=>void)=>()=>void,channel:(name:string,run:(id:string)=>void)=>PrimaryTabChannel|null},clock:PrimaryTabClock}} PrimaryTabPlatform */

// Inert adapter: native locks, channels, listeners and timers start only when
// their owner acquires. Identity is per instance; copied sessionStorage is not
// proof that another document owns our lease.
/** @returns {PrimaryTabPlatform} */
export function createBrowserTabLockPlatform(){
  return {
    requestNative:globalThis.navigator?.locks?.request
      ?(name,hold)=>globalThis.navigator.locks.request(name,{mode:'exclusive',ifAvailable:true},lock=>hold(!!lock))
      :null,
    identity:()=>globalThis.crypto.randomUUID?.()||`${Date.now()}-${Math.random()}`,
    lease:{getItem:key=>globalThis.localStorage.getItem(key),setItem:(key,value)=>globalThis.localStorage.setItem(key,value),removeItem:key=>globalThis.localStorage.removeItem(key)},
    events:{
      pageHide(run){globalThis.window.addEventListener('pagehide',run);return ()=>globalThis.window.removeEventListener('pagehide',run)},
      storage(key,run){
        /** @param {StorageEvent} event */
        const listener=event=>{if(event.key===key)run(event.newValue)};
        globalThis.window.addEventListener('storage',listener);return ()=>globalThis.window.removeEventListener('storage',listener);
      },
      channel(name,run){
        if(typeof globalThis.BroadcastChannel!=='function')return null;
        const channel=new globalThis.BroadcastChannel(name);
        /** @param {MessageEvent<unknown>} event */
        const listener=event=>{
          const data=event.data;
          if(data&&typeof data==='object'&&'type' in data&&data.type==='primary-heartbeat'&&'id' in data&&typeof data.id==='string')run(data.id);
        };
        channel.addEventListener('message',listener);
        return {notify:id=>channel.postMessage({type:'primary-heartbeat',id}),close:()=>{channel.removeEventListener('message',listener);channel.close()}};
      },
    },
    clock:{now:()=>Date.now(),random:()=>Math.random(),
      setTimeout:(run,delay)=>globalThis.setTimeout(run,delay),clearTimeout:id=>globalThis.clearTimeout(id),
      setInterval:(run,delay)=>globalThis.setInterval(run,delay),clearInterval:id=>globalThis.clearInterval(id)},
  };
}
