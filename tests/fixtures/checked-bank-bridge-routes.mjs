import {createBankBridgeRoutes} from '../../netunim-kupa/bank-bridge/http-routes.mjs';
/** @type {import('../../netunim-kupa/bank-bridge/http-routes.mjs').BankBridgeRoutePorts} */
const ports={version:73,contractVersion:2,
  service:{bankStatus:async()=>({configured:false}),creditStatus:async()=>({profiles:[]})},
  connections:{saveCreditProfile:async()=>({}),deleteCreditProfile:async()=>({}),resetCreditProfiles:async()=>{},
    saveCredentials:async()=>({}),selectAccount:async()=>({}),deleteCredentials:async()=>({}),
    importConnectionSettings:async()=>({bank:{},profiles:[],cleanupWarnings:[]})},
  finance:{balance:async()=>({}),syncCredit:async()=>({})},
  diagnostics:{credit:async()=>[],creditData:async()=>({}),bank:async()=>({})},
  cheques:{read:async()=>({data:new Uint8Array(),size:0,contentType:'image/png'})},shutdown:{afterResponse:()=>{}},
};
const routes=createBankBridgeRoutes(ports);
const route=routes.resolve('GET','/bank/cheque-image/'+'a'.repeat(64));
if(route?.response==='binary'){
  const image=await route.run();
  if(image){const size=image.data.byteLength;void size}
}
// @ts-expect-error private capabilities cannot be omitted
createBankBridgeRoutes({version:73,contractVersion:2,service:ports.service});
// @ts-expect-error cheque results are bytes, never a local filesystem path
createBankBridgeRoutes({...ports,cheques:{read:async()=>({path:'operator-secret.png'})}});
// @ts-expect-error an arbitrary buffer string cannot replace binary image bytes
createBankBridgeRoutes({...ports,cheques:{read:async()=>({data:'image',size:5,contentType:'image/png'})}});
// @ts-expect-error full credit reset must settle with no invented public result
createBankBridgeRoutes({...ports,connections:{...ports.connections,resetCreditProfiles:async()=> 'done'}});
// @ts-expect-error credit diagnostics must publish an event array
createBankBridgeRoutes({...ports,diagnostics:{...ports.diagnostics,credit:async()=> 'complete'}});
// @ts-expect-error importer returns a projection, not encrypted vault contents
createBankBridgeRoutes({...ports,connections:{...ports.connections,importConnectionSettings:async()=>({credentials:{password:'secret'}})}});
