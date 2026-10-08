import {createStartupTask} from '../shared/startup-task.js';
import {startupMark} from './marks.js';

/** @typedef {{ordersOnline:boolean,sharedOnline:boolean,cloudEnabled:boolean,online:boolean}} HydrationPlan */

// Owns remote hydration and its domain outcomes. Journal/cursor failures are
// fatal; remote unavailability preserves the recovered local editing path.
export function createOrdersCloudStartup({main,checks,finance,status,access,mark=startupMark}){
  for(const [name,port,methods] of [
    ['main',main,['recoverCursor','open','cloudState','hasLocalWork','conflictBlocked']],
    ['checks',checks,['sync','pending','lastError','recordError']],
    ['finance',finance,['hydrate']],
    ['status',status,['beginStartupSync','setStartupDomain','setCloud']],
    ['access',access,['authenticated','online','cloudEnabled','canHydrate']],
  ])for(const method of methods)if(typeof port?.[method]!=='function')throw new TypeError(`orders_startup_${name}_${method}_required`);
  /** @type {HydrationPlan|null} */
  let plan=null;
  let preparation=null,mainCompleted=false;

  async function preparePlan(localEngineActive){
    if(!localEngineActive)await main.recoverCursor();
    mark('orders-local-recovered');
    const online=!!access.online(),authenticated=!!access.authenticated(),cloudEnabled=!!access.cloudEnabled();
    const next=Object.freeze({ordersOnline:!localEngineActive&&cloudEnabled&&online&&authenticated,sharedOnline:!localEngineActive&&online&&authenticated,cloudEnabled,online});
    status.beginStartupSync({orders:next.ordersOnline,checks:next.sharedOnline,finance:next.sharedOnline});
    plan=next;
    return plan;
  }
  function prepare({localEngineActive}){
    if(!preparation)preparation=preparePlan(localEngineActive);
    return preparation;
  }
  function requirePlan(){if(!plan)throw new Error('orders_startup_plan_required');return plan}

  const hydrateMain=createStartupTask(async()=>{
    const current=requirePlan();
    if(current.cloudEnabled&&!current.online)status.setCloud('ענן: אופליין','offline');
    if(current.ordersOnline){
      status.setStartupDomain('orders','loading');mark('orders-cloud-start');
      let ok=false;
      if(access.canHydrate())try{ok=await main.open({renderAfter:true,quiet:true,hydrateSecondary:false,manageStatus:false,startPoll:false})}
      catch(error){console.error('orders startup cloud',error)}
      mark('orders-cloud-end');
      if(!ok)status.setStartupDomain('orders','error','אימות נתוני ניהול ההזמנות מול הענן נכשל; העותק המקומי נשמר');
      else if(main.conflictBlocked())status.setStartupDomain('orders','error','נמצאה התנגשות מול הענן; הנתונים המקומיים נשמרו ולא נדרסו');
      else{
        const pending=await main.cloudState();
        if(pending?.pending||pending?.flight||main.hasLocalWork())status.setStartupDomain('orders','deferred','שינויים מקומיים שמורים וממתינים למועד הסנכרון');
        else status.setStartupDomain('orders','ready');
      }
    }
    mainCompleted=true;
  });

  const hydrateSecondary=createStartupTask(async()=>{
    const current=requirePlan();
    if(!mainCompleted)throw new Error('orders_startup_main_hydration_required');
    if(!current.sharedOnline)return;
    status.setStartupDomain('checks','loading');mark('checks-start');
    let checksOk=false;
    if(access.canHydrate())try{checksOk=await checks.sync({quiet:true,required:false})}
    catch(error){console.error('shared checks startup',error);checks.recordError(error)}
    mark('checks-end');
    if(checksOk)status.setStartupDomain('checks','ready');
    else if(checks.pending())status.setStartupDomain('checks','deferred',checks.lastError()||'שינויי הצ׳קים נשמרו מקומית וממתינים לסנכרון');
    else status.setStartupDomain('checks','error',checks.lastError()||'טעינת הצ׳קים מהענן נכשלה; נשמר העותק המקומי האחרון התקין');

    status.setStartupDomain('finance','loading');mark('finance-start');
    let financeOk=false;
    if(access.canHydrate())try{financeOk=await finance.hydrate({force:true,renderIfChanged:true})}
    catch(error){console.error('finance startup readout',error)}
    mark('finance-end');
    status.setStartupDomain('finance',financeOk?'ready':'error',financeOk?'':'טעינת נתוני הבנק והאשראי נכשלה; נשמר העותק האחרון התקין');
  });
  return {prepare,hydrateMain,hydrateSecondary};
}
