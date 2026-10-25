import {createSharedChecksV2Runtime} from '../../shared/shared-checks-v2-runtime.js';
const runtime=createSharedChecksV2Runtime({owner:()=> 'A',primary:()=>true,mode:()=> 'primary',
  readState:()=>({checks:[],bankEvents:[]}),applyState:state=>{void state.checks},
  merge:(_base,local)=>({checks:local,conflicts:[]}),readRemote:async()=>null,rpc:async()=>null});
const result=runtime.persist([{type:'delete',collection:'checks',id:'C'}],{deleteIds:['C']});
if(result.handled){
  /** @type {Promise<boolean>} */ const committed=result.committed;
  // @ts-expect-error local commit does not certify a cloud ACK
  /** @type {import('../../shared/storage-journal-contracts.js').CloudAck} */ const ack=result;
  void [committed,ack];
}else{
  // @ts-expect-error inactive routing does not admit a write
  result.committed;
}
// @ts-expect-error initialization requires explicit provenance
runtime.initialize({state:{},revision:0});
// @ts-expect-error retired migration intent is forbidden
runtime.initialize({state:{},revision:0,intent:'legacy-upgrade',sourceOwner:'A'});
// @ts-expect-error a coordinated replacement needs a real boundary identity
runtime.replaceLocalWithPending({}, {boundaryId:200,expectedSeq:0,expectedBaseRevision:1});
// @ts-expect-error primary authority must be synchronous
createSharedChecksV2Runtime({primary:async()=>true});
/** @type {boolean} */ const ready=runtime.primaryReady;
/** @type {Promise<boolean>} */ const flushed=runtime.flush();
// @ts-expect-error flush waits for durability and authority
/** @type {true} */ const immediate=runtime.flush();
void [ready,flushed,immediate];
