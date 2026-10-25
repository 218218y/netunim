// @ts-check
import {createOrdersFinanceAutomation} from '../../netunim-orders/site/assets/js/domains/finance/automation.js';
/** @type {import('../../netunim-orders/site/assets/js/domains/finance/automation-contracts.js').AutomationPorts} */
const ports={
  access:{primary:()=>true,authenticated:()=>true,online:()=>true,busy:()=>false,capture:()=>()=>undefined},
  preferences:{getBridgeToken:()=> 'paired',bankAutoEnabled:()=>true,creditAutoEnabled:()=>true,creditAutoMode:()=> 'smart'},
  readLastSyncAt:()=>null,commands:{bank:async()=>false,credit:async()=>false},
  timers:{setTimeout:()=>1,clearTimeout:()=>undefined},
};
const runtime=createOrdersFinanceAutomation(ports);
runtime.currentEpoch().toFixed();
runtime.dispose().valueOf();
runtime.allowed('bank').valueOf();
// @ts-expect-error automatic entry cannot await a primary-access decision
createOrdersFinanceAutomation({...ports,access:{...ports.access,primary:async()=>true}});
// @ts-expect-error captured operation authority must remain synchronous
createOrdersFinanceAutomation({...ports,access:{...ports.access,capture:()=>async()=>undefined}});
// @ts-expect-error both existing provider command ports are required
createOrdersFinanceAutomation({...ports,commands:{bank:async()=>false}});
// @ts-expect-error the browser timer handle is a number
createOrdersFinanceAutomation({...ports,timers:{setTimeout:()=> 'timer',clearTimeout:()=>undefined}});
// @ts-expect-error arbitrary domains cannot create another automatic resource
runtime.allowed('shared_checks');
// @ts-expect-error credit mode is a value rather than a boolean permission
runtime.setCreditAutoMode(true);
