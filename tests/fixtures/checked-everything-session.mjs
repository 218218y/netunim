import {createEverythingSession} from '../../netunim-orders/document-bridge/everything-session.mjs';
/** @type {import('../../netunim-orders/document-bridge/everything-session.mjs').SessionPorts} */
const ports={configuration:{load:async()=>({everythingInstance:'',everythingExecutable:'',searchTimeoutMs:15000,allowedOrigins:[]}),save:async()=>{}},discovery:{es:async()=> 'es.exe',executable:async()=> 'Everything.exe'},process:{run:async()=>({stdout:''}),start:async()=>{}},runtime:{now:Date.now,wait:async()=>{}},audit:{write:async()=>{}}};
const session=createEverythingSession(ports);session.probe({fresh:true,autoStart:false});
/** @type {Promise<void>} */const draining=session.dispose();void draining;
// @ts-expect-error process replies are captured text, not objects
createEverythingSession({...ports,process:{...ports.process,run:async()=>({stdout:{version:'1.5'}})}});
// @ts-expect-error process launch must acknowledge spawn or reject before it is joined
createEverythingSession({...ports,process:{...ports.process,start:()=>undefined}});
// @ts-expect-error cache timestamps must be numeric milliseconds
createEverythingSession({...ports,runtime:{...ports.runtime,now:()=> 'now'}});
// @ts-expect-error configuration authority is asynchronous and complete
createEverythingSession({...ports,configuration:{...ports.configuration,load:()=>({everythingInstance:''})}});
// @ts-expect-error session has no file deletion authority
session.delete('C:\\synthetic.pdf');
