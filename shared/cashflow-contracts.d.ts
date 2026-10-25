import type {AccountRole} from './credit-calculation-contracts.js';
export type Settings = {version:number,businessMinimum:number|null,homeMinimum:number|null,businessCheckCutoffDay:number,homeCheckCutoffDay:number};
type AlertBase = {account:AccountRole,minimum:number|null};
export type CashflowAlert = AlertBase & (
  {projected:null,active:false,reason:'unavailable'} |
  {projected:number,active:true,reason:'negative'|'minimum'} |
  {projected:number,active:false,reason:'ok'});
// The warning calculator consumes retained movement fields; date/money coercion
// remains owned by its existing runtime checks. These are not bank receipts.
export type Movement = {amount?:unknown,date?:unknown,dueDate?:unknown};
export type WarningWindow = {targetDate?:string,forecastIncomplete?:boolean,creditRows?:Movement[],expenseRows?:Movement[],checkRows?:Movement[],incomeRows?:Movement[]};
export type WarningInput = WarningWindow & {account:unknown,balance:unknown,projected?:unknown,warningProjection?:WarningWindow};
export type CashflowNotification = AlertBase & {projected:number|null,active:boolean,reason:CashflowAlert['reason'],breachDate:string,daysUntilBreach:number|null,projectedAtHorizon:unknown,warningTargetDate:string,forecastIncomplete:boolean};
