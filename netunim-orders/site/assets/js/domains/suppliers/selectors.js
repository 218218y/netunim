import {supplierTxData, balanceRowsData, supplierBalanceData, supplierYearContextData, totalStatsData, orderedSuppliersData} from './model.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsSuppliersSelectors({model}){
function supplierTx(...args){return supplierTxData(model.state,...args)}

function balanceRows(...args){return balanceRowsData(model.state,...args)}

function supplierBalance(...args){return supplierBalanceData(model.state,...args)}

function supplierYearContext(...args){return supplierYearContextData(model.state,...args)}

function totalStats(...args){return totalStatsData(model.state,...args)}

function orderedSuppliers(...args){return orderedSuppliersData(model.state,...args)}

return { supplierTx, balanceRows, supplierBalance, supplierYearContext, totalStats, orderedSuppliers };
}
