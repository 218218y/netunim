import {activeChecksData, depositedChecksData, checksBalanceData, depositedBalanceData, futureCheckMonthsData} from './model.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsChecksSelectors({model}){
function activeChecks(...args){return activeChecksData(model.state,...args)}

function depositedChecks(...args){return depositedChecksData(model.state,...args)}

function checksBalance(...args){return checksBalanceData(model.state,...args)}

function depositedBalance(...args){return depositedBalanceData(model.state,...args)}

function futureCheckMonths(...args){return futureCheckMonthsData(model.state,...args)}

return { activeChecks, depositedChecks, checksBalance, depositedBalance, futureCheckMonths };
}
