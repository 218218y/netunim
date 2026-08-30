import {supplierTxData, balanceRowsData, supplierBalanceData, supplierYearContextData, supplierArchiveYearsData, supplierPeriodTxData, supplierFinancialStatsData, supplierViewRowsData, totalStatsData, orderedSuppliersData} from './model.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsSuppliersSelectors({model}){
function supplierTx(...args){return supplierTxData(model.state,...args)}

function balanceRows(...args){return balanceRowsData(model.state,...args)}

function supplierBalance(...args){return supplierBalanceData(model.state,...args)}

function supplierYearContext(...args){return supplierYearContextData(model.state,...args)}

function supplierArchiveYears(...args){return supplierArchiveYearsData(model.state,...args)}

function supplierPeriodTx(...args){return supplierPeriodTxData(model.state,...args)}

function supplierFinancialStats(...args){return supplierFinancialStatsData(model.state,...args)}

function supplierViewRows(...args){return supplierViewRowsData(model.state,...args)}

function totalStats(...args){return totalStatsData(model.state,...args)}

function orderedSuppliers(...args){return orderedSuppliersData(model.state,...args)}

return { supplierTx, balanceRows, supplierBalance, supplierYearContext, supplierArchiveYears, supplierPeriodTx, supplierFinancialStats, supplierViewRows, totalStats, orderedSuppliers };
}
