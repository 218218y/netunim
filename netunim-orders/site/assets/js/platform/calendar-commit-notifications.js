// @ts-check
/** @typedef {{addEventListener:(type:'message',listener:(event:{data:unknown})=>void)=>void,removeEventListener:(type:'message',listener:(event:{data:unknown})=>void)=>void,postMessage:(data:unknown)=>void,close:()=>void}} CommitChannel */
const CHANNEL='netunim-orders-calendar-commits';
const SIGNAL=Object.freeze({type:'calendar-local-commit',version:1});

/**
 * Payload-free hints after a local commit, never queue data or an ACK.
 * A subscriber owns its channel; a drained write can notify peers after the
 * last subscriber has disposed, using a temporary channel with no listeners.
 * @param {{createChannel?:(name:string)=>CommitChannel|null,onError?:(error:unknown)=>void}} [ports]
 */
export function createCalendarCommitNotifications({createChannel=name=>typeof globalThis.BroadcastChannel==='function'?new BroadcastChannel(name):null,onError=error=>console.warn('Calendar commit notification unavailable',error)}={}){
  /** @type {Set<()=>void>} */ const listeners=new Set();
  /** @type {CommitChannel|null} */ let channel=null;
  /** @param {unknown} error */
  function report(error){try{onError(error)}catch(reportError){console.error('Calendar notification reporter failed',reportError)}}
  function emit(){for(const listener of [...listeners])try{listener()}catch(error){report(error)}}
  /** @param {{data:unknown}} event */
  function receive({data}){if(data&&typeof data==='object'&&'type' in data&&data.type===SIGNAL.type&&'version' in data&&data.version===SIGNAL.version)emit()}
  function open(){try{return createChannel(CHANNEL)}catch(error){report(error);return null}}
  function close(){const previous=channel;channel=null;if(!previous)return;try{previous.removeEventListener('message',receive)}catch(error){report(error)}try{previous.close()}catch(error){report(error)}}
  /** @param {()=>void} listener */
  function subscribe(listener){
    if(typeof listener!=='function')throw new TypeError('calendar_commit_listener_required');
    if(!listeners.size){channel=open();try{channel?.addEventListener('message',receive)}catch(error){report(error);close()}}
    listeners.add(listener);let removed=false;
    return ()=>{if(removed)return;removed=true;listeners.delete(listener);if(!listeners.size)close()};
  }
  function notify(){
    emit();const target=channel||open(),temporary=target!==channel;
    try{target?.postMessage(SIGNAL)}catch(error){report(error)}finally{if(temporary)try{target?.close()}catch(error){report(error)}}
  }
  return {subscribe,notify};
}
