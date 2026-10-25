import type {CreditTransactionStatus,CreditChargeAmountStatus} from './credit-transaction-evidence.mjs';

export type CreditProvider = 'visaCal'|'max'|'isracard'|'amex';
export type FetchStatus = 'success'|'provider_error'|'schema_error'|'network_error';
export type FrameStatus = 'fresh'|'stale'|'missing';
export type CreditScrapeTransaction = {
  id:string,type:string,status:CreditTransactionStatus,
  date:unknown,processedDate:unknown,transactionDate:unknown,transactionTime:string,
  originalAmount:number|null,originalCurrency:string,
  chargedAmount:number|null,chargedCurrency:string,chargeAmountStatus?:CreditChargeAmountStatus,
  foreignTransaction:boolean,description:string,memo:string,category:string|undefined,
  installments:{number:number,total:number}|null,
};
export type CreditMonthSlice = {
  month:string,tier:'core'|'forecast',status:'fresh'|'missing',fetchStatus:FetchStatus,
  fetchedAt:string|null,transactions:CreditScrapeTransaction[],providerSchemaVersion:string,
  lastErrorCode:string,lastErrorAt:unknown,
};
export type CreditScrapeAccount = {
  accountNumber:string,balance:number|null,balanceDate:unknown,cardType:string,cardFrame:number|null,
  availableCredit:number|null,frameStatus:FrameStatus,frameFetchStatus:FetchStatus|'unavailable',
  frameFetchedAt:unknown,frameErrorCode:string,frameErrorAt:unknown,
  months:CreditMonthSlice[],pendingTransactions:CreditScrapeTransaction[],pendingStatus:FetchStatus|'missing',
  pendingFetchedAt:unknown,pendingErrorCode:string,pendingErrorAt:unknown,
  unassignedTransactions:CreditScrapeTransaction[],txns:CreditScrapeTransaction[],
};
export type CreditPublicProfile = {
  profileId:string,provider:string,label:string,ownerLabel:string,
  defaultAccount:'ביתי'|'עסקי',active:boolean,configured:true,
};
export type CreditProfileInput = Omit<CreditPublicProfile,'configured'|'provider'> & {
  provider:CreditProvider,credentials:Record<string,unknown>,
};
