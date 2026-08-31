import {computeKupaNetReadoutData} from './readout.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsBankSelectors({model}){
function computeKupaNetReadout(...args){return computeKupaNetReadoutData(model.state,...args)}

return { computeKupaNetReadout };
}
