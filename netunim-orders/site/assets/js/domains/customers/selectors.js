import {customerStatsData} from './model.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsCustomersSelectors({model}){
function customerStats(...args){return customerStatsData(model.state,...args)}

return { customerStats };
}
