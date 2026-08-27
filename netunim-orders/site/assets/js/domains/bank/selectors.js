import {pendingChecksBankDeltaData, sharedCheckBankEffectsTotalData, computeKupaNetReadoutData} from './readout.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsBankSelectors({model, checksSession}){
function pendingChecksBankDelta(...args){return pendingChecksBankDeltaData(checksSession.checksCloudBase,model.state,...args)}

function sharedCheckBankEffectsTotal(...args){return sharedCheckBankEffectsTotalData(checksSession.checksBankEvents,checksSession.checksCloudBase,model.state,...args)}

function computeKupaNetReadout(...args){return computeKupaNetReadoutData(checksSession.checksBankEvents,checksSession.checksCloudBase,model.state,...args)}

return { pendingChecksBankDelta, sharedCheckBankEffectsTotal, computeKupaNetReadout };
}
