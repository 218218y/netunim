export const CASHFLOW_SETTINGS_VERSION=2;
export const DEFAULT_BUSINESS_CHECK_CUTOFF_DAY=14;
export const DEFAULT_HOME_CHECK_CUTOFF_DAY=9;

function finiteNullable(value){
  if(value===null||value===undefined||value==='')return null;
  const n=Number(value);
  return Number.isFinite(n)?n:null;
}

function minimumNullable(value){const n=finiteNullable(value);return n===null?null:Math.max(0,n)}
function cutoffDay(value,fallback){const n=Number(value);return Number.isInteger(n)&&n>=1&&n<=31?n:fallback}

export function cashflowAccountRole(value){return value==='ביתי'||value==='home'?'ביתי':'עסקי'}

export function normalizeCashflowSettings(raw={}){
  const source=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
  return {
    version:CASHFLOW_SETTINGS_VERSION,
    businessMinimum:minimumNullable(source.businessMinimum),
    homeMinimum:minimumNullable(source.homeMinimum),
    businessCheckCutoffDay:cutoffDay(source.businessCheckCutoffDay,DEFAULT_BUSINESS_CHECK_CUTOFF_DAY),
    homeCheckCutoffDay:cutoffDay(source.homeCheckCutoffDay,DEFAULT_HOME_CHECK_CUTOFF_DAY),
  };
}

export function cashflowMinimumForAccount(settings,account='עסקי'){
  const normalized=normalizeCashflowSettings(settings);
  return cashflowAccountRole(account)==='ביתי'?normalized.homeMinimum:normalized.businessMinimum;
}

export function cashflowCheckCutoffDayForAccount(settings,account='עסקי'){
  const normalized=normalizeCashflowSettings(settings);
  return cashflowAccountRole(account)==='ביתי'?normalized.homeCheckCutoffDay:normalized.businessCheckCutoffDay;
}

export function cashflowAlertForAccount(projected,settings,account='עסקי'){
  const role=cashflowAccountRole(account),value=finiteNullable(projected),minimum=cashflowMinimumForAccount(settings,role);
  if(value===null)return {account:role,projected:null,minimum,active:false,reason:'unavailable'};
  if(value<0)return {account:role,projected:value,minimum,active:true,reason:'negative'};
  if(minimum!==null&&value<=minimum)return {account:role,projected:value,minimum,active:true,reason:'minimum'};
  return {account:role,projected:value,minimum,active:false,reason:'ok'};
}

export function cashflowAlerts(projectedByAccount,settings){
  const values=projectedByAccount&&typeof projectedByAccount==='object'?projectedByAccount:{};
  return [cashflowAlertForAccount(values.business,settings,'עסקי'),cashflowAlertForAccount(values.home,settings,'ביתי')];
}
