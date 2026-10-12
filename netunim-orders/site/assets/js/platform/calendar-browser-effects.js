// @ts-check
import {createDebouncedTask} from '../shared/debounced-task.js';
/** @typedef {{setTimeout:(run:()=>void,delay:number)=>number,clearTimeout:(id:number)=>void,setInterval:(run:()=>void,delay:number)=>number,clearInterval:(id:number)=>void,requestAnimationFrame:(run:()=>void)=>number,cancelAnimationFrame:(id:number)=>void}} CalendarTimers */
/** @typedef {{window:Pick<EventTarget,'addEventListener'|'removeEventListener'>,document:Pick<Document,'addEventListener'|'removeEventListener'|'visibilityState'>,navigator:Pick<Navigator,'onLine'>,timers:CalendarTimers}} CalendarBrowser */
/** @param {{environment?:CalendarBrowser,onError?:(error:unknown)=>void}} [ports] */
export function createCalendarBrowserEffects({environment={window:globalThis.window,document:globalThis.document,navigator:globalThis.navigator,timers:globalThis},onError=error=>console.error('calendar effects',error)}={}){
  let active=true,started=false;
  /** @type {number|null} */ let poll=null;
  /** @type {Array<()=>void>} */ const listeners=[];
  /** @type {Set<number>} */ const frames=new Set();
  const dayClick=createDebouncedTask({delay:320,timers:environment.timers,onError});
  const reconnect=createDebouncedTask({delay:15_000,timers:environment.timers,onError});
  /** @type {()=>boolean} */ const isOnline=()=>active&&environment.navigator.onLine===true;
  /** @type {()=>boolean} */ const isVisible=()=>active&&environment.document.visibilityState==='visible';
  /** @param {EventTarget|Pick<EventTarget,'addEventListener'|'removeEventListener'>} target @param {string} event @param {()=>void} run */
  function listen(target,event,run){
    const listener=()=>{if(active)run()};
    target.addEventListener(event,listener);listeners.push(()=>target.removeEventListener(event,listener));
  }
  /** @param {{resume:()=>void,offline:()=>void,canPoll:()=>boolean,interval:number}} ports */
  function start({resume,offline,canPoll,interval}){
    if(!active||started)return false;
    if(!Number.isFinite(interval)||interval<0)throw new TypeError('calendar_poll_interval_required');
    started=true;
    try{
      listen(environment.window,'online',resume);listen(environment.window,'offline',offline);
      listen(environment.document,'visibilitychange',()=>{if(isVisible()&&isOnline())resume()});
      poll=environment.timers.setInterval(()=>{if(active&&isVisible()&&isOnline()&&canPoll())resume()},interval);
      return true;
    }catch(error){dispose();throw error}
  }
  /** @param {()=>void} run */
  function frame(run){
    if(!active)return false;
    const id=environment.timers.requestAnimationFrame(()=>{if(!active||!frames.delete(id))return;run()});frames.add(id);return true;
  }
  function cancelFrames(){for(const id of frames)environment.timers.cancelAnimationFrame(id);frames.clear()}
  function invalidate(){dayClick.cancel();reconnect.cancel();cancelFrames()}
  function dispose(){
    if(!active)return false;active=false;
    if(poll!==null)environment.timers.clearInterval(poll);poll=null;
    for(const release of listeners.splice(0))release();
    dayClick.dispose();reconnect.dispose();cancelFrames();return true;
  }
  async function drain(){await Promise.all([dayClick.drain(),reconnect.drain()])}
  return {isOnline,isVisible,start,frame,dayClick:{schedule:dayClick.schedule,cancel:dayClick.cancel},reconnect:{schedule:reconnect.schedule,cancel:reconnect.cancel},invalidate,dispose,drain};
}
