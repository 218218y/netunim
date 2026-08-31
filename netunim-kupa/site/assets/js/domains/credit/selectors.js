import {pendingInstallmentsData, allInstallmentsData, monthSumInstallmentsData, nextCreditCycleData, nextChargeDateData, pendingBusinessInstallmentsData, monthSumBusinessInstallmentsData, nextBusinessCreditCycleData} from './model.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsCreditSelectors({model}){
function pendingInstallments(...args){return pendingInstallmentsData(model.state,...args)}

function allInstallments(...args){return allInstallmentsData(model.state,...args)}

function monthSumInstallments(...args){return monthSumInstallmentsData(model.state,...args)}

function nextCreditCycle(...args){return nextCreditCycleData(model.state,...args)}

function pendingBusinessInstallments(...args){return pendingBusinessInstallmentsData(model.state,...args)}

function monthSumBusinessInstallments(...args){return monthSumBusinessInstallmentsData(model.state,...args)}

function nextBusinessCreditCycle(...args){return nextBusinessCreditCycleData(model.state,...args)}

function nextChargeDate(...args){return nextChargeDateData(model.state,...args)}

return { pendingInstallments, allInstallments, monthSumInstallments, nextCreditCycle, pendingBusinessInstallments, monthSumBusinessInstallments, nextBusinessCreditCycle, nextChargeDate };
}
