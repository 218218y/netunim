import {createMorningStatus} from '../../netunim-orders/site/assets/js/domains/customers/morning-status.js';
import {createMorningDebtApplication} from '../../netunim-orders/site/assets/js/domains/customers/morning-debt-application.js';
/** @type {Parameters<typeof createMorningStatus>[0]} */
const ports={lifetime:{capture:()=>()=>undefined,run:async work=>work(),scheduleRecovery:()=>false},commands:{status:async()=>({ok:true,operation:null})},session:{assertModal(){},read:()=>({operationId:'bound-ID',generation:1,busy:false,blocked:false,completed:false,pendingOperationId:null,context:null}),isActive:()=>true,update(){}},recovery:{abandon:async()=>({abandoned:false,operation:null}),reset:()=>false},application:{apply:async()=>({changed:false}),settle:()=>({durable:false,blocked:true,recoveryCleared:false}),notify(){}},presentation:{status(){},operation(){},markSaved(){},button(){}}};
const status=createMorningStatus(ports);void status.refresh({reconcile:true});status.cancelPending();
// @ts-expect-error An async truthy callback cannot grant presentation authority.
createMorningStatus({...ports,session:{...ports.session,isActive:async()=>true}});
// @ts-expect-error A generation is numeric identity, not a display label.
createMorningStatus({...ports,session:{...ports.session,read:()=>({...ports.session.read(),generation:'current'})}});
// @ts-expect-error Session completion cannot be a truthy formatted string.
createMorningStatus({...ports,session:{...ports.session,read:()=>({...ports.session.read(),completed:'saved'})}});
// @ts-expect-error Reconciliation requires an actual Boolean option.
status.refresh({reconcile:'true'});
// @ts-expect-error Consumers cannot reach an arbitrary JSON/backend action.
status.commands;
/** @type {Parameters<typeof createMorningDebtApplication>[0]} */
const applicationPorts={lifetime:{capture:()=>()=>undefined,join:async(_key,_assert,work)=>work(),pending:()=>false},recovery:{read:()=>null},debts:{read:()=>null,refresh:async()=>true,isBlocked:()=>false,apply:()=>({changed:false})},policy:{matches:()=>false,snapshot:()=>null,changes:()=>({changed:true})},feedback:{toast(){},status(){},decide(){}}};
const application=createMorningDebtApplication(applicationPorts);
// @ts-expect-error Promise truthiness cannot certify a current form.
application.apply(null,{}, {isCurrent:async()=>true});
/** @type {boolean} */ const pending=application.isPending();void pending;
