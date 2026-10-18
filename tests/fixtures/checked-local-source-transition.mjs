import {createLocalSourceTransition} from '../../netunim-kupa/site/assets/js/storage/local-source-transition.js';
const ports={captureScope:()=>()=>undefined,drain:async()=>{},setBusy:/** @param {boolean} value */ value=>{void value}};
const transition=createLocalSourceTransition(ports);
/** @type {number} */ const result=await transition.run(async()=>({handle:'candidate'}),async candidate=>candidate.handle.length);void result;
// @ts-expect-error Preparation captures a typed candidate before adoption.
transition.run(async()=>({handle:'candidate'}),async candidate=>candidate.nonexistent);
// @ts-expect-error Scope assertions must throw synchronously before source authority.
createLocalSourceTransition({...ports,captureScope:()=>true});
// @ts-expect-error An async assertion cannot fence the next synchronous commit.
createLocalSourceTransition({...ports,captureScope:()=>async()=>{}});
// @ts-expect-error Draining previous writes requires a completion acknowledgement.
createLocalSourceTransition({...ports,drain:()=>true});
