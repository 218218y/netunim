// Inputs are retained application records. Raw issuer responses keep their
// separate evidence boundary; these types do not authorize unvalidated JSON.
export type AccountRole = 'ביתי'|'עסקי';
export type AccountTransition = {effectiveDate:string,fromAccount:AccountRole,toAccount:AccountRole};
export type CardMapping = Record<string,unknown> & {account?:unknown,accountTransitions?:unknown,included?:boolean,hidden?:boolean,cardName?:string};
export type Transaction = Record<string,unknown> & {installments?:{number?:unknown,total?:unknown}|null};
export type AccountMonth = Record<string,unknown> & {transactions?:Transaction[]};
export type CreditAccount = Record<string,unknown> & {months?:AccountMonth[],pendingTransactions?:Transaction[],unassignedTransactions?:Transaction[],txns?:Transaction[]};
export type CreditProfile = Record<string,unknown> & {accounts?:CreditAccount[],provider?:string};
export type BillingState = Record<string,unknown> & {creditSync?:{profiles?:CreditProfile[],cardMappings?:Record<string,CardMapping>}|null,credits?:Record<string,unknown>[]};
export type BillingOptions = {asOf?:string,includeHidden?:boolean};
export type AmountSource = 'issuer_not_billed'|'charged_amount'|'foreign_only'|'original_ils_estimate'|'unknown';
export type TransactionAmount =
  | {amount:number,rawAmount:number,currency:string,included:true,estimated:false,source:'issuer_not_billed'|'charged_amount'}
  | {amount:number,rawAmount:number,currency:'ILS',included:true,estimated:true,source:'original_ils_estimate'}
  | {amount:0,rawAmount:number,currency:string,included:false,estimated:boolean,source:'foreign_only'}
  | {amount:0,rawAmount:null,currency:string,included:false,estimated:boolean,source:'unknown'};
export type TransactionEntry = {tx:Transaction,billingMonthHint:string,coverageIncomplete:boolean,coverageStatus?:string,coveragePlaceholder?:false};
export type CoverageEntry = {tx:null,billingMonthHint:string,coverageIncomplete:true,coverageStatus:string,coveragePlaceholder:true};
export type AccountEntry = TransactionEntry|CoverageEntry;
export type BillingProjection = {date:string,source:'unassigned'|'inferred_billing_day'|'issuer_billing_day_projection'|'issuer_processed_date'|'known_billing_cycle'|'issuer_next_charge_day'|'issuer_next_charge'|'known_future_cycle',confidence:'unassigned'|'inferred'|'issuer'|'authoritative'|'known_cycle',nominalDay?:number|null};
export type BillingRow = {
  source:'credit_unknown'|'credit_pending'|'credit_sync'|'credit_foreign'|'manual',
  creditId:string,profileId:string,provider:string,accountNumber:string,creditAccountKey:string,
  date:string,billingDate:string,billingMonth:string,transactionDate:string,transactionTime:string,
  amount:number,displayAmount:number,transactionAmount:number,displayCurrency:string,
  isShekel:boolean,foreignCurrency:boolean,originalAmount:number|null,originalCurrency:string,
  part:number,totalParts:number,card:string,account:AccountRole,ownerLabel:string,hidden:boolean,
  description:string,memo:string,status:string,pendingFresh:boolean,chargeDateSource:BillingProjection['source']|'manual_schedule',
  billingDateConfidence:BillingProjection['confidence']|'manual',includedInIlsTotal:boolean,amountEstimated:boolean,
  amountSource:AmountSource|'coverage_missing'|'manual',amountStatus:'known_ils'|'foreign_unconverted'|'unknown_amount',
  unconverted:boolean,unknownAmount:boolean,uncertainBillingDate:boolean,coverageIncomplete:boolean,coverageStatus:string,totalAmount:number,
  record?:Record<string,unknown>,series?:{id:string,totalAmount:number,partial:boolean,transactionDate:string,transactionTime:string},
  charge?:{date:string,amount:number,part:number,totalParts:number},pending?:{id:string,isShekel:boolean},foreign?:{id:string},
};
export type BillingCycle = Pick<BillingRow,'creditAccountKey'|'date'|'billingDate'|'billingMonth'|'card'|'account'|'provider'|'profileId'|'accountNumber'|'hidden'> & {
  id:string,rows:BillingRow[],finalizedTotal:number,pendingTotal:number,total:number,pendingCount:number,
  unconvertedCount:number,unknownAmountCount:number,stalePendingCount:number,missingAmountCount:number,coverageGapCount:number,incompleteCount:number,
  status:'incomplete'|'estimated'|'finalized',
};
export type BillingModel = {asOf:string,rows:BillingRow[],cycles:BillingCycle[],unassignedRows:BillingRow[]};
export type BillingHorizon = {rows:BillingRow[],cycles:BillingCycle[],nextCycles:BillingCycle[],total:number,targetDate:string,targetMonth:string,targetEnd:string,unassignedRows:BillingRow[],incompleteRows:BillingRow[]};

export type UpcomingCharge =
  | {amount:number,date:string,source:'transactions',pendingAmount:number,estimated:boolean,status:BillingCycle['status'],incompleteCount:number,missingAmountCount:number,coverageGapCount:number,stalePendingCount:number,unconvertedCount:number,unknownAmountCount:number,amountKnown:boolean,complete:boolean}
  | {amount:number,date:string,source:'issuer_balance',pendingAmount:0,estimated:false};
// Contextual signatures check the actual function bodies, not a parallel facade.
export interface CreditCalculation {
  finite(value:unknown): number|null;
  roundMoney(value:unknown): number;
  pad2(value:unknown): string;
  creditBillingISODate(value:unknown): string;
  creditBillingMonthKey(value:unknown): string;
  daysInMonth(year:number,month:number): number;
  addMonthsISO(value:unknown,delta:number): string;
  transactionTime(value:unknown): string;
  normalizedCurrency(value:unknown): string;
  creditBillingIsShekelCurrency(value:unknown): boolean;
  transactionOriginDate(tx:Transaction|null): string;
  transactionBillingDate(tx:Transaction|null): string;
  transactionBillingLowerBound(tx:Transaction|null): string;
  transactionPart(tx:Transaction|null): number;
  transactionTotalParts(tx:Transaction|null): number;
  cardMappingKey(profile:CreditProfile,account:CreditAccount): string;
  synchronizedCardKey(profile:CreditProfile,account:CreditAccount): string;
  accountRole(value:unknown): AccountRole;
  creditTransactionAmountData(tx?:Transaction): TransactionAmount;
  creditPendingFreshData(account?:CreditAccount,asOf?:string): boolean;
  creditPendingAuthorizationTotalData(account?:CreditAccount,asOf?:string): number;
  accountTransactionEntries(account?:CreditAccount): AccountEntry[];
  accountTransactions(account?:CreditAccount): (Transaction|null)[];
  canonicalBillingDates(account:CreditAccount): string[];
  knownBillingDates(account:CreditAccount,reference:string,transactionDate:string): string[];
  nominalBillingDay(date:string): number|null;
  inferredBillingDay(account:CreditAccount): number|null;
  nextDateForBillingDay(day:number,reference:string,transactionDate:string): string;
  dateForBillingMonth(day:number,key:string): string;
  billingCycleDateForMonth(day:number,key:string): string;
  creditAccountStatementCycleDateData(account?:CreditAccount,value?:string): BillingProjection;
  creditFinalizedBillingDateData(account?:CreditAccount,tx?:Transaction,billingMonthHint?:string): BillingProjection;
  creditPendingBillingDateData(account?:CreditAccount,tx?:Transaction,asOf?:string): BillingProjection;
  creditAccountNextDisplayBillingDateData(account?:CreditAccount,asOf?:string): BillingProjection;
  transactionDisplayAmount(tx:Transaction|null,amountData:TransactionAmount): number;
  transactionTotalAmount(tx:Transaction|null,amountData:TransactionAmount): number;
  transactionIdentity(profile:CreditProfile,account:CreditAccount,tx:Transaction,index:number,date:string,amountData:TransactionAmount): string;
  correlationKey(tx:Transaction|null): string;
  matchedPendingIndexes(entries:AccountEntry[]): Set<number>;
  synchronizedRows(state:BillingState,asOf:string,includeHidden:boolean): BillingRow[];
  manualRows(state:BillingState,asOf:string): BillingRow[];
  seriesKey(row:BillingRow): string;
  enrichSeries(rows:BillingRow[]): BillingRow[];
  cycleRows(rows:BillingRow[]): BillingCycle[];
  creditBillingModelData(state?:BillingState,options?:BillingOptions): BillingModel;
  creditBillingRowsData(state?:BillingState,options?:BillingOptions): BillingRow[];
  creditBillingCyclesData(state?:BillingState,options?:BillingOptions): BillingCycle[];
  creditForecastRowsData(state?:BillingState,options?:BillingOptions): BillingRow[];
  creditCyclesThroughHorizonRowsData(inputRows?:BillingRow[],account?:string,reference?:string,unassignedRows?:BillingRow[],horizonDate?:string): BillingHorizon;
  creditCyclesThroughHorizonData(state?:BillingState,account?:string,reference?:string): BillingHorizon;
  creditAccountKnownFutureCommitmentData(account?:CreditAccount,asOf?:string): number;
  creditAccountUpcomingChargeData(account?:CreditAccount,provider?:string,asOf?:string): UpcomingCharge|null;
}
