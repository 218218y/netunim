import {createMorningOperationCommands} from '../../netunim-orders/site/assets/js/domains/customers/morning-operation-commands.js';
import {decodeMorningOperationStatus} from '../../netunim-orders/site/assets/js/domains/customers/morning-operation-evidence.js';
import {createMorningIssuance} from '../../netunim-orders/site/assets/js/domains/customers/morning-issuance.js';
import {createMorningRecovery} from '../../netunim-orders/site/assets/js/domains/customers/morning-recovery.js';
const commands=createMorningOperationCommands({request:{json:async()=>null}}),assertCurrent=()=>undefined;
const payload={operation_id:'bound-ID',document:{type:305,amount:42}};
void commands.status('bound-ID',true,assertCurrent);void commands.create(payload,assertCurrent);
// @ts-expect-error An async assertion cannot grant request or publication authority.
commands.status('bound-ID',true,async()=>undefined);
// @ts-expect-error Status requests cannot be accidentally passed a document object.
commands.status(payload,true,assertCurrent);
// @ts-expect-error This capability has no arbitrary backend action API.
commands.json('create',payload,assertCurrent);
// @ts-expect-error Formatted amount text cannot authorize an outgoing document.
commands.create({...payload,document:{type:305,amount:'42'}},assertCurrent);
const status=decodeMorningOperationStatus(JSON.parse('{}'),'bound-ID');
// @ts-expect-error Decoded financial evidence is numerical, not truthiness.
if(status.operation)status.operation.amount=true;
const persistence={persist:()=>{},reset:()=>{},block:()=>{}};
createMorningIssuance({commands,recovery:persistence});
// @ts-expect-error A provider result cannot certify verification with display text.
createMorningIssuance({commands:{...commands,create:async()=>({ok:true,verified:'yes',document:{id:'doc',type:305,amount:42}})},recovery:persistence});
// @ts-expect-error The retired unvalidated backend port is not an issuance input.
createMorningIssuance({backend:async()=>null,recovery:persistence});
/** @type {Parameters<typeof createMorningRecovery>[0]} */
const recoveryPorts={lifetime:{capture:()=>assertCurrent,join:async(_key,_assert,work)=>work(),scheduleRecovery:()=>false},commands,recovery:{read:()=>null,abandon:async()=>({abandoned:false,operation:null}),reset:()=>false},application:{apply:async()=>({changed:false}),settle:()=>({durable:false,recoveryCleared:false,blocked:true})},publish:{isBusy:()=>false,state(){},notify(){},toast(){}}};
const recovery=createMorningRecovery(recoveryPorts);
void recovery.recover({quiet:true,assertCurrent});
// @ts-expect-error Truthy status strings cannot claim completed reconciliation.
createMorningRecovery({...recoveryPorts,commands:{status:async()=>({ok:'ready',operation:null})}});
// @ts-expect-error A caller cannot reach raw transport through recovery.
recovery.commands;
