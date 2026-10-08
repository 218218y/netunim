import {startupMark} from './marks.js';

// Optional backup/alerts have separate failure boundaries. Job startup failures
// are retained; a catch must never replay effects in a partially started runtime.
export function createOrdersBackgroundStartup({polling,finance,alerts,localServices,access,mark=startupMark}){
  for(const [name,port,methods] of [
    ['polling',polling,['start']],['finance',finance,['start']],
    ['alerts',alerts,['prepare','show']],['localServices',localServices,['backupAfterHydration']],
    ['access',access,['allowed']],
  ])for(const method of methods)if(typeof port?.[method]!=='function')throw new TypeError(`orders_background_${name}_${method}_required`);
  let task=null;
  async function run({ordersOnline}){
    if(!access.allowed())return false;
    if(ordersOnline)await polling.start();
    if(!access.allowed())return false;
    try{await localServices.backupAfterHydration()}catch(error){console.error('startup automatic backup',error)}
    if(!access.allowed())return false;
    try{await alerts.prepare()}catch(error){console.error('startup bank alerts preparation',error)}
    if(!access.allowed())return false;
    try{await alerts.show()}catch(error){console.error('startup alerts display',error)}
    if(!access.allowed())return false;
    await finance.start();mark('background-ready');return true;
  }
  function start(plan){if(!task)task=Promise.resolve().then(()=>run(plan));return task}
  return {start};
}
