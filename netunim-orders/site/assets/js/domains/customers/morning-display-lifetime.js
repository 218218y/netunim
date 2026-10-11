// @ts-check
// This signal owns presentation and unaccepted confirmations only. It must
// never cancel an issuance, ledger reconciliation, or durable write in progress.
/** @param {{subscribeAccountScope:(listener:()=>void)=>()=>void,onInvalidate:()=>undefined}} ports */
export function createMorningDisplayLifetime({subscribeAccountScope,onInvalidate}){
  let disposed=false,controller=new AbortController();
  function invalidate(){controller.abort();onInvalidate()}
  const unsubscribe=subscribeAccountScope(()=>{if(!disposed)invalidate()});
  function renew(){
    if(disposed)throw new Error('morning_display_disposed');
    controller.abort();controller=new AbortController();
  }
  function dispose(){if(disposed)return false;disposed=true;unsubscribe();invalidate();return true}
  return {renew,dispose,get signal(){return controller.signal}};
}

/** @param {{isConnected:boolean}|null} surface
 * @param {(title:string,body:string,foot:string)=>undefined} render */
export function clearMorningDisplay(surface,render){
  if(!surface?.isConnected)return false;
  render('Morning — יש לפתוח את התצוגה מחדש','<p role="status">התצוגה הקודמת הוסרה. יש לאמת את ההתחברות ולפתוח את המסמך מחדש. ניסיון הפקה שנשמר יישאר זמין להתאוששות.</p>','<button class="btn" data-action="close-modal">סגור</button>');
  return true;
}
