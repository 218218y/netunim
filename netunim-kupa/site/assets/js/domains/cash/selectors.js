import {cashBalanceData} from './model.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsCashSelectors({model}){
function cashBalance(...args){return cashBalanceData(model.state,...args)}

return { cashBalance };
}
