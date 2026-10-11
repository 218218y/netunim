// @ts-check
/** @typedef {{owner:string,assertCurrent:()=>void}} Authority */
/** @param {{captureOperation:()=>Authority,subscribeAccountScope:(listener:()=>void)=>()=>void,onInvalidate:()=>undefined}} ports */
export function createCalendarDisplayLifetime({captureOperation,subscribeAccountScope,onInvalidate}){
  let disposed=false,generation=0,controller=new AbortController();
  function checkpoint(){const captured=generation;return ()=>{if(disposed||captured!==generation)throw Object.assign(new Error('Calendar display authority changed'),{code:'CALENDAR_OPERATION_SCOPE_CHANGED'})}}
  function capture(){const assertDisplay=checkpoint();assertDisplay();const authority=captureOperation(),signal=controller.signal;return {owner:authority.owner,signal,assertCurrent(){assertDisplay();authority.assertCurrent()}}}
  function invalidate(){generation++;controller.abort();controller=new AbortController();onInvalidate()}
  const unsubscribe=subscribeAccountScope(()=>{if(!disposed)invalidate()});
  function dispose(){if(disposed)return false;disposed=true;unsubscribe();invalidate();return true}
  return {capture,checkpoint,dispose};
}
