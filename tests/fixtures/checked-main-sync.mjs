import {createCloudWriteAuthority} from '../../shared/cloud-write-authority.js';
import {createCloudWriteAuthority as kupaAuthority} from '../../netunim-kupa/site/assets/js/shared/cloud-write-authority.js';
import {createCloudWriteAuthority as ordersAuthority} from '../../netunim-orders/site/assets/js/shared/cloud-write-authority.js';
import {createMainDocumentWrite} from '../../netunim-kupa/site/assets/js/cloud/main-document-write.js';

/** @type {import('../../shared/cloud-write-authority.js').CloudWriteAuthorityPorts} */
const ports={scope:{read:()=>null},leadership:{primary:()=>true,preparing:()=>false},control:{write:async()=>null}};
const authority=createCloudWriteAuthority(ports);
kupaAuthority(ports);ordersAuthority(ports);
/** @type {boolean} */ export const current=authority.isCurrent(null);
/** @type {Promise<unknown>} */ export const control=authority.setControl(null,{retry:{attempts:1}});
// @ts-expect-error A deferred leadership decision cannot authorize a write.
createCloudWriteAuthority({...ports,leadership:{...ports.leadership,primary:async()=>true}});
// @ts-expect-error Text status is not preparation authority.
ordersAuthority({...ports,leadership:{...ports.leadership,preparing:()=> 'ready'}});
// @ts-expect-error Transport status cannot manufacture a live storage identity.
kupaAuthority({...ports,scope:{read:()=>({writable:true})}});
// @ts-expect-error Control completion does not grant ACK or saved status.
/** @type {Promise<boolean>} */ export const notAnAck=authority.setControl(null,{conflict:{kind:'review'}});
/** @type {Pick<import('../../netunim-kupa/site/assets/js/cloud/main-document-write.js').MainDocumentWritePorts,'validate'|'beginMeasure'>} */
const policies={validate:state=>state,beginMeasure:()=>()=>{}};
const writer=createMainDocumentWrite({...policies,documentName:()=> 'main',request:async()=>({ok:true,text:async()=> '{}'})});
export const reply=writer.rpcSaveCloudV2({},1,'immutable-operation',{},{});
reply.then(result=>{
  // @ts-expect-error Network payload starts unknown; only the ACK decoder grants revision.
  return result.row.revision;
});
// @ts-expect-error A write target is a synchronous document identifier.
createMainDocumentWrite({...policies,documentName:async()=> 'main',request:async()=>({ok:true,text:async()=> '{}'})});
// @ts-expect-error A numeric flag is not HTTP response evidence.
createMainDocumentWrite({...policies,documentName:()=> 'main',request:async()=>({ok:1,text:async()=> '{}'})});
// @ts-expect-error Delete intent identifiers remain strings.
writer.rpcSaveCloudV2({},1,'operation',{notes:[7]});
