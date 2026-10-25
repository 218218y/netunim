import {createStorageV2Runtime,storageV2Mode} from '../../shared/storage-v2-runtime.js';
const runtime=createStorageV2Runtime({app:'orders',owner:()=> 'account',primary:()=>true,validate:()=>{},mode:()=> 'primary'});
const admission=runtime.persist({notes:[]},{operations:[{type:'set',field:'inventoryCategoryOrder',value:[]}]});
if(admission.handled){
  /** @type {Promise<boolean>} */ const committed=admission.committed;
  /** @type {boolean} */ const emergency=admission.emergencyDurable;
  // @ts-expect-error an accepted asynchronous commit is not immediate completion
  /** @type {boolean} */ const durable=admission.committed;
  // @ts-expect-error a local admission is not a cloud acknowledgement
  /** @type {import('../../shared/storage-journal-contracts.js').CloudAck} */ const ack=admission;
  void [committed,emergency,durable,ack];
}else{
  // @ts-expect-error an unhandled mutation has no commit receipt
  admission.committed;
}
const ack=await runtime.acknowledgeFlight('operation',3,{});
// @ts-expect-error a cloud ACK is not a local journal admission
/** @type {import('../../shared/storage-journal-contracts.js').AppendAdmission} */ const local=ack;
// @ts-expect-error owners are identities, not response status codes
createStorageV2Runtime({app:'orders',owner:()=>200,primary:()=>true,validate:()=>{}});
// @ts-expect-error primary authority must be synchronous
createStorageV2Runtime({app:'orders',owner:()=> 'A',primary:async()=>true,validate:()=>{}});
// @ts-expect-error mode is a closed domain
storageV2Mode('calendar');
// @ts-expect-error epoch cannot be replaced by a numeric revision
runtime.setCloudControl({},{expectedScope:{owner:'A:orders',epoch:3}});
// @ts-expect-error a rebase requires an explicit checkpoint
runtime.rejectFlight('operation',3,{},{expectedSeq:1});
const recovered=await runtime.recover();
// @ts-expect-error a missing recovery is not authoritative success
recovered.state;
if(recovered){
  /** @type {'v2'} */ const source=recovered.source;
  // @ts-expect-error recovered epoch is a string identity
  /** @type {number} */ const epoch=recovered.epoch;
  void [source,epoch];
}
void local;
