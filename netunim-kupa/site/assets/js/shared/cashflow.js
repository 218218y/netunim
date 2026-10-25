export const CASHFLOW_SETTINGS_VERSION=3;
export const DEFAULT_BUSINESS_CHECK_CUTOFF_DAY=14;
export const DEFAULT_HOME_CHECK_CUTOFF_DAY=9;

/** @param {unknown} value @returns {number|null} */
function finiteNullable(value){
  if(value===null||value===undefined||value==='')return null;
  const n=Number(value);
  return Number.isFinite(n)?n:null;
}

/** @param {unknown} value @returns {number|null} */
function minimumNullable(value){const n=finiteNullable(value);return n===null?null:Math.max(0,n)}
/** @param {unknown} value @param {number} fallback @returns {number} */
function cutoffDay(value,fallback){const n=Number(value);return Number.isInteger(n)&&n>=1&&n<=31?n:fallback}

/** @param {unknown} value @returns {import('./credit-calculation-contracts.js').AccountRole} */
export function cashflowAccountRole(value){return value==='ביתי'||value==='home'?'ביתי':'עסקי'}

/** @param {unknown} [raw] @returns {import('./cashflow-contracts.js').Settings} */
export function normalizeCashflowSettings(raw={}){
  const source=/** @type {Record<string,unknown>} */ (raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{});
  return {
    version:CASHFLOW_SETTINGS_VERSION,
    businessMinimum:minimumNullable(source.businessMinimum),
    homeMinimum:minimumNullable(source.homeMinimum),
    businessCheckCutoffDay:cutoffDay(source.businessCheckCutoffDay,DEFAULT_BUSINESS_CHECK_CUTOFF_DAY),
    homeCheckCutoffDay:cutoffDay(source.homeCheckCutoffDay,DEFAULT_HOME_CHECK_CUTOFF_DAY),
  };
}

/** @param {unknown} settings @param {unknown} [account] @returns {number|null} */
export function cashflowMinimumForAccount(settings,account='עסקי'){
  const normalized=normalizeCashflowSettings(settings);
  return cashflowAccountRole(account)==='ביתי'?normalized.homeMinimum:normalized.businessMinimum;
}

/** @param {unknown} settings @param {unknown} [account] @returns {number} */
export function cashflowCheckCutoffDayForAccount(settings,account='עסקי'){
  const normalized=normalizeCashflowSettings(settings);
  return cashflowAccountRole(account)==='ביתי'?normalized.homeCheckCutoffDay:normalized.businessCheckCutoffDay;
}

/** @param {unknown} projected @param {unknown} settings @param {unknown} [account] @returns {import('./cashflow-contracts.js').CashflowAlert} */
export function cashflowAlertForAccount(projected,settings,account='עסקי'){
  const role=cashflowAccountRole(account),value=finiteNullable(projected),minimum=cashflowMinimumForAccount(settings,role);
  if(value===null)return {account:role,projected:null,minimum,active:false,reason:'unavailable'};
  if(value<0)return {account:role,projected:value,minimum,active:true,reason:'negative'};
  if(minimum!==null&&value<=minimum)return {account:role,projected:value,minimum,active:true,reason:'minimum'};
  return {account:role,projected:value,minimum,active:false,reason:'ok'};
}

/** @param {unknown} projectedByAccount @param {unknown} settings @returns {import('./cashflow-contracts.js').CashflowAlert[]} */
export function cashflowAlerts(projectedByAccount,settings){
  const values=/** @type {Record<string,unknown>} */ (projectedByAccount&&typeof projectedByAccount==='object'?projectedByAccount:{});
  return [cashflowAlertForAccount(values.business,settings,'עסקי'),cashflowAlertForAccount(values.home,settings,'ביתי')];
}
