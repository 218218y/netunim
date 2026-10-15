import {createStorageStartupAdmission} from '../../shared/storage-startup-protocol.js';
/** @param {import('../../shared/storage-startup-protocol.js').AdmissionPorts} ports */
export async function consumer(ports){
  const owner=createStorageStartupAdmission(ports);
  const result=await owner.admit({owner:'local',accountV2Active:false,localEngineActive:true});
  // @ts-expect-error Blocked admission has no journal authority.
  result.state.owner;
  if(result.ok)owner.assertCurrent(result.state);
}
// @ts-expect-error Admission needs explicit policy ports.
createStorageStartupAdmission({});
