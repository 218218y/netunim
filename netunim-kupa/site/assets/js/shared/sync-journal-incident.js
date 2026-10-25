import {journalIncidentSample} from './sync-incident-model.js';

// Loaded by observers, outside the business journal's startup dependency graph.
/** @typedef {import('./storage-journal-contracts.js').CloudSnapshot} CloudSnapshot */
/** @param {{read:()=>Promise<CloudSnapshot|null>,ready:()=>boolean,current:(cloud:CloudSnapshot)=>boolean,epoch:()=>string|null|undefined,durabilityError:()=>boolean,blocked:()=>boolean,fatal:(error:unknown)=>'fatal'|'retryable'}} options */
export async function sampleJournalIncident({read,ready,current,epoch,durabilityError,blocked,fatal}){
  const unavailable=(/** @type {unknown} */ error=undefined)=>({known:false,blocked:blocked()||ready()&&!!error&&fatal(error)==='fatal',durabilityError:durabilityError(),epoch:epoch()||'unavailable',evidence:'unknown'});
  if(!ready())return unavailable();
  try{
    const cloud=await read();
    if(!cloud||!ready())return unavailable();
    const sample=journalIncidentSample(cloud,{durabilityError:durabilityError(),current:()=>ready()&&!blocked()&&!durabilityError()&&current(cloud)});
    sample.blocked=sample.blocked||!!blocked();
    if(sample.blocked)sample.verified=false;
    return sample;
  }catch(error){return unavailable(error)}
}

