import {createBridgeShutdownOwner} from '../../netunim-kupa/bank-bridge/shutdown-owner.mjs';
import {createBridgeReplacementCommand} from '../../netunim-kupa/bank-bridge/replacement-command.mjs';
import {createBridgeOperationOwner} from '../../netunim-kupa/bank-bridge/operation-owner.mjs';
/** @type {import('../../netunim-kupa/bank-bridge/shutdown-owner.mjs').ShutdownPlatform} */
const platform={schedule:()=>()=>{},subscribeStop:()=>()=>{},closeListener:async()=>{},exit:()=>{},reportError:()=>{}};
const operations=createBridgeOperationOwner();
const owner=createBridgeShutdownOwner({operations,diagnostics:{drain:async()=>{}},platform});
/** @type {Promise<void>} */ const completion=owner.request();void completion;
// @ts-expect-error drainage cannot be replaced with a precomputed status boolean
createBridgeShutdownOwner({operations,diagnostics:{drain:()=>true},platform});
// @ts-expect-error signal/timer resources must return their release function
createBridgeShutdownOwner({operations,diagnostics:{drain:async()=>{}},platform:{...platform,subscribeStop:()=> 'registered'}});
// @ts-expect-error listener completion must be asynchronous evidence of closure
createBridgeShutdownOwner({operations,diagnostics:{drain:async()=>{}},platform:{...platform,closeListener:()=>true}});
/** @type {import('../../netunim-kupa/bank-bridge/replacement-command.mjs').ReplacementPorts} */
const ports={probe:async()=>({response:{ok:true},data:{service:'netunim-kupa-bank-bridge'}}),readToken:async()=> 'fixture',shutdown:async()=>({response:{ok:true},data:{ok:true}}),waitUntilStopped:async()=>true};
createBridgeReplacementCommand(ports);
createBridgeReplacementCommand({...ports,probe:async()=>null});
// @ts-expect-error a replacement command has no process-killing authority
createBridgeReplacementCommand({...ports,forceStop:()=>{}});
// @ts-expect-error pairing tokens must retain their string identity
createBridgeReplacementCommand({...ports,readToken:async()=>123});
// @ts-expect-error a shutdown receipt is not a free-form success message
createBridgeReplacementCommand({...ports,shutdown:async()=> 'stopped'});
// @ts-expect-error pending state cannot be used as stopped process evidence
createBridgeReplacementCommand({...ports,waitUntilStopped:async()=> 'pending'});
