import type {BankIdentityRow} from './bank-transaction-identity.js';
import type {AccountRole} from './credit-calculation-contracts.js';

// Retained bank rows keep their existing unknown-valued evidence fields. This
// model still reads dates, money, currency and status before admitting a seed.
export type BankRow = BankIdentityRow;
export type BankFeed = {accountNumber?:unknown,balance?:unknown,syncedAt?:unknown,transactions?:BankRow[],recurringDebitHistory?:BankRow[]};
export type BankState = {bank?:{source?:unknown,feed?:BankFeed|null,homeFeed?:BankFeed|null}|null};
export type RecurringRule = {id:string,account:AccountRole,name:string,bankLabels:string[],startMonth:string,day:number,direction?:1|-1,moveSaturday?:boolean};
export type SourceMovement = {date:string,amount:number,transactionId:unknown};
export type RecurringObligation = {
  id:string,name:string,account:AccountRole,status:'no_bank_source'|'awaiting'|'estimated',
  lastDebit?:SourceMovement|null,lastCredit?:SourceMovement|null,nextDueDate:string,nextAmount:number|null,
};
export type RecurringMovement = {
  id:string,ruleId:string,account:AccountRole,name:string,description:string,type:string,
  recurring:true,active:true,dueDate:string,amount:number,source:'bank_recurring',amountEstimated:true,
  bankSettlementState:'awaiting'|'estimated',sourceTransactionId:unknown,sourceDate:string,sourceDescription:unknown,
};
export type RecurringWarning = {ruleId:string,name:string,kind:'no_bank_source'|'ambiguous',dueDate?:string};
export type RecurringForecast = {rows:RecurringMovement[],obligations:RecurringObligation[],warnings:RecurringWarning[],incomplete:boolean};
export interface RecurringCalculation {
  role(value:unknown):AccountRole;
  cents(value:unknown):number;
  text(value:unknown):string;
  dayOf(row:BankRow):string;
  matches(row:BankRow,rule:RecurringRule):boolean;
  posted(row:BankRow,asOf:string,direction?:1|-1):boolean;
  nextMonth(key:string):string;
  months(from:string,to:string):string[];
  dueDate(month:string,day:number,moveSaturday?:boolean):string;
  combinedRows(feed?:BankFeed|null):BankRow[];
  bankRecurringDebitHistoryData(previousFeed:BankFeed|null|undefined,nextFeed:BankFeed|null|undefined,account:string,coverage?:Record<string,unknown>):BankRow[];
  bankRecurringExpensesData(kupa:BankState|null|undefined,account:string,reference:string,horizon:string):RecurringForecast;
  bankRecurringIncomeData(kupa:BankState|null|undefined,account:string,reference:string,horizon:string):RecurringForecast;
  bankRecurringMovementsData(kupa:BankState|null|undefined,account:string,reference:string,horizon:string,rules:readonly RecurringRule[]):RecurringForecast;
}
