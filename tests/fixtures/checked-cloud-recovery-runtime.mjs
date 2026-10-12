import {createCloudRecoveryRuntime} from '../../shared/cloud-recovery-runtime.js';

const owner=createCloudRecoveryRuntime({isEligible:()=>true,run:async()=>false,onError:()=>{}});
/** @type {boolean} */
export const scheduled=owner.schedule();
/** @type {Promise<void>} */
export const completed=owner.drain();
// @ts-expect-error Eligibility must return boolean evidence.
createCloudRecoveryRuntime({isEligible:()=> 'online',run:()=>{},onError:()=>{}});
// @ts-expect-error Recovery must be callable.
createCloudRecoveryRuntime({isEligible:()=>true,run:Promise.resolve(),onError:()=>{}});
// @ts-expect-error Allocated wakeup IDs must remain numeric.
createCloudRecoveryRuntime({isEligible:()=>true,run:()=>{},onError:()=>{},timers:{setTimeout:()=> 'timer',clearTimeout:()=>{}}});
