import {createMorningLifetime} from '../../netunim-orders/site/assets/js/domains/customers/morning-lifetime.js';
import {createMorningDebtApplication} from '../../netunim-orders/site/assets/js/domains/customers/morning-debt-application.js';
const operationScope={capture:()=>()=>undefined,captureRead:()=>()=>undefined};
const owner=createMorningLifetime({operationScope,getPendingOperationId:()=>null,recover:async()=>({ok:false}),onInterrupt(){},events:{}});
/** @type {Promise<void>} */ const drained=owner.drain();void drained;
/** @type {Promise<number>} */ const command=owner.run(async()=>7);void command;
// @ts-expect-error A current operation assertion must complete synchronously.
createMorningLifetime({operationScope:{...operationScope,capture:()=>async()=>{}},getPendingOperationId:()=>null,recover(){},onInterrupt(){}});
// @ts-expect-error Recovery wakes are bound to a stable textual operation ID.
createMorningLifetime({operationScope,getPendingOperationId:()=>7,recover(){},onInterrupt(){}});
// @ts-expect-error A timer deadline cannot be formatted status text.
owner.scheduleRecovery('60000');
// @ts-expect-error A coalesced flight requires real current authority.
owner.join('application',true,async()=>true);
// @ts-expect-error Caller-supplied asynchronous assertions cannot authorize work.
owner.join('application',async()=>{},async()=>true);
/** @type {Parameters<typeof createMorningDebtApplication>[0]} */
const ports={lifetime:owner,recovery:{read:()=>null},debts:{read:()=>null,refresh:async()=>false,isBlocked:()=>false,apply:()=>({changed:false,reason:'missing-debt'})},policy:{matches:()=>false,snapshot:()=>null,changes:()=>({changed:true})},feedback:{toast(){},status(){},decide(){}}};
const application=createMorningDebtApplication(ports);
/** @type {Promise<{changed:boolean,persisted?:boolean,reason?:string}>} */ const result=application.apply(null);void result;
// @ts-expect-error Formatted text cannot certify a durable debt update.
createMorningDebtApplication({...ports,debts:{...ports.debts,apply:()=>({changed:true,persisted:'saved'})}});
// @ts-expect-error A read-only truthy Promise cannot stand in for mutation policy.
createMorningDebtApplication({...ports,debts:{...ports.debts,isBlocked:async()=>false}});
// @ts-expect-error Bank/Morning amounts are numerical financial evidence.
application.apply(null,{operationId:'same-ID',type:320,amount:'42'});
// @ts-expect-error Snapshot changes must be decided before authority is granted.
createMorningDebtApplication({...ports,policy:{...ports.policy,changes:async()=>({changed:false})}});
// @ts-expect-error Callers cannot reach the raw debt model through this capability.
application.model;
