import {cashBalanceData,rightsBalanceData} from './model.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsCashSelectors({model}){
function cashBalance(...args){return cashBalanceData(model.state,...args)}
function rightsBalance(...args){return rightsBalanceData(model.state,...args)}

return { cashBalance, rightsBalance };
}
