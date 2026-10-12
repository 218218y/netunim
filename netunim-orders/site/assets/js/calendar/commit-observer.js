// @ts-check
/** @typedef {{owner:string,assertCurrent:()=>void}} CommitAuthority */
/** @param {unknown} error */
function obsoleteCommitObservation(error){return !!error&&typeof error==='object'&&'code' in error&&['CALENDAR_OPERATION_SCOPE_CHANGED','calendar_cloud_auth_required'].includes(String(error.code))}

/**
 * One read owner, with one trailing read if another commit arrives during it.
 * A hint cannot authorize delivery, clear an error or publish remote success.
 * Disposal stops new reads/publication, without aborting any durable work.
 * @param {{subscribe:(listener:()=>void)=>()=>void,capture:()=>CommitAuthority|null,refresh:(authority:CommitAuthority)=>Promise<boolean>,onError:(error:unknown,authority:CommitAuthority)=>void}} ports
 */
export function createCalendarCommitObserver({subscribe,capture,refresh,onError}){
  let started=false,disposed=false,dirty=false;
  /** @type {(()=>void)|null} */ let unsubscribe=null;
  /** @type {{promise:Promise<boolean>}|null} */ let running=null;
  function wake(){
    if(disposed||!started)return Promise.resolve(false);
    dirty=true;if(running)return running.promise;
    const task={promise:Promise.resolve(false)};running=task;
    task.promise=Promise.resolve().then(async()=>{
      let result=false;
      while(dirty&&!disposed){
        dirty=false;
        /** @type {CommitAuthority|null} */ let authority=null;
        try{authority=capture();if(!authority)continue;authority.assertCurrent();result=await refresh(authority);authority.assertCurrent()}
        catch(error){
          result=false;if(disposed||obsoleteCommitObservation(error))continue;
          if(authority)try{authority.assertCurrent();onError(error,authority)}catch(reportError){if(!obsoleteCommitObservation(reportError))console.error('Calendar commit observation failed',reportError)}
          else console.error('Calendar commit observation capture failed',error);
        }
      }
      return result;
    }).finally(()=>{if(running===task){running=null;if(dirty&&!disposed)void wake()}});
    return task.promise;
  }
  function start(){if(disposed||started)return false;unsubscribe=subscribe(()=>{void wake()});started=true;void wake();return true}
  function dispose(){if(disposed)return false;disposed=true;dirty=false;unsubscribe?.();unsubscribe=null;return true}
  async function drain(){while(running)await Promise.allSettled([running.promise])}
  return {start,wake,dispose,drain,isPending:()=>!!running};
}
