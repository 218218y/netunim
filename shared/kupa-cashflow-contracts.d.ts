import type {AccountRole,BillingState,BillingRow,BillingProjection,CreditAccount,BillingHorizon} from './credit-calculation-contracts.js';
import type {BankState,BankFeed,BankRow,RecurringForecast,RecurringMovement} from './bank-recurring-contracts.js';
import type {Settings,CashflowAlert,CashflowNotification} from './cashflow-contracts.js';
export type {BankRow};
// These are retained application records, never an authorization of raw RPC JSON.
export type RetainedRow = Record<string,unknown> & {id?:unknown,amount?:unknown};
export type CashflowState = BillingState & BankState & {
  bank?: NonNullable<BankState['bank']> & {currentBalance?:unknown,asOfDate?:unknown,updatedAt?:unknown,adjustments?:RetainedRow[]}|null,
  expenses?:RetainedRow[],checks?:RetainedRow[],cashflowSettings?:Partial<Settings>|null,
};
export type ReconciledRow = BillingRow & {
  bankSettlementState?:'awaiting'|'settled'|'expired',bankPendingSettlementDetected?:boolean,settlementShell?:boolean,
  detailCycleBillingDate?:string,detailCycleNominalDay?:number|null|undefined,
  detailCycleAssignmentSource?:BillingProjection['source'],detailCycleAssignmentConfidence?:BillingProjection['confidence'],
  detailCycleUncertain?:boolean,detailDisplayBillingDate?:string,detailDisplayBillingDateSource?:string,detailDisplayBillingDateConfidence?:string,
};
export type SettlementIdentity = {last4s:string[],source:string,cards:{last4:string,card:string}[]};
export type SettlementCandidate = {rows:ReconciledRow[],due:string,cardKey:string,provider:string,suffix:string,card:string,known:boolean,expected:number};
export type SettlementGroup = {key:string,rows:ReconciledRow[],indexes:number[],due:string,card:string,providers:string[],suffix:string,known:boolean,expected:number,proven:boolean,next:string};
export type BankEvidence = {row:BankRow,value:number,eligible:number[],suffixMatches:number[],nativeIdentity:boolean};
export type SettlementWarning = {id:string,kind:'credit_settlement_unmatched',account:AccountRole,dueDate:string,releaseDate:string,provider:string,profileId:string,accountNumber:string,card:string,amount:number,rowCount:number,amountKnown:boolean,missingAmountCount:number};
export type PendingSettlement = {rows:ReconciledRow[],total:number,expiredRows:ReconciledRow[],expiredTotal:number,warnings:SettlementWarning[]};
export type CurrentSettlement = {rows:ReconciledRow[],settledCardKeys:Set<string>};
export type Reconciliation = {role:AccountRole,ref:string,start:string,forecastStart:string,currentSettlement:CurrentSettlement,settlingCredit:PendingSettlement,settlementRows:ReconciledRow[],elapsedIncompleteCreditRows:ReconciledRow[],rows:ReconciledRow[],installments:ReconciledRow[],unassignedRows:ReconciledRow[]};
export type ReconciliationOptions = {retainSettledCompleted?:boolean,includeHidden?:boolean,monthlySettlement?:boolean};
export type DisplayContext = {datesByCard:Map<string,{date:string,source:string,confidence:string}[]>,accountsByCard:Map<string,CreditAccount>};
export type DetailMonth = {key:string,total:number,items:ReconciledRow[],uncertain?:boolean,uncertainCount:number,missingAmountCount:number,coverageGapCount:number,incompleteCount:number,partial:boolean};
export type DetailMonths = {months:DetailMonth[],cutoffMonth:string,historyMonths:number,currentMonth:string,unassigned:ReconciledRow[],unplacedUnassigned:ReconciledRow[]};
export type DatedRetainedRow = RetainedRow & {dueDate:string};
export type ExpenseRow = DatedRetainedRow|RecurringMovement;
export type CheckDeposits = {rows:DatedRetainedRow[],total:number,cutoffDay:number,cutoffDate:string};
export type Contributions = {selected:ReconciledRow[],creditRows:ReconciledRow[],recurring:RecurringForecast,income:RecurringForecast,incomeRows:RecurringMovement[],expenseRows:ExpenseRow[],checkDeposits:CheckDeposits,incompleteCreditRows:ReconciledRow[]};
export type CashflowProjection = {balance:null,projected:null}|{balance:number,projected:number};
export type CashflowResult = CashflowProjection & {
  account:AccountRole,credit:number,expenses:number,incomes:number,checks:number,total:number,expectedChange:number,
  incomeRows:RecurringMovement[],creditRows:ReconciledRow[],expenseRows:ExpenseRow[],checkRows:DatedRetainedRow[],
  start:string,reference:string,end:string,targetDate:string,targetMonth:string,automaticTargetDate:string,customTarget:boolean,awaitingSettlement:boolean,
  nextCreditRows:ReconciledRow[],nextCreditCycles:BillingHorizon['cycles'],nextCreditTotal:number,
  unassignedCreditRows:ReconciledRow[],elapsedIncompleteCreditRows:ReconciledRow[],incompleteCreditRows:ReconciledRow[],forecastIncomplete:boolean,
  recurringExpenseRows:RecurringMovement[],recurringObligations:RecurringForecast['obligations'],recurringExpenseWarnings:RecurringForecast['warnings'],
  recurringIncomeObligations:RecurringForecast['obligations'],recurringIncomeWarnings:RecurringForecast['warnings'],
  settlingCreditRows:ReconciledRow[],settlingCredit:number,expiredSettlementCreditRows:ReconciledRow[],expiredSettlementCredit:number,expiredSettlementWarnings:SettlementWarning[],unmatchedCreditRetained:true,
  elapsedCredit:number,elapsedExpenses:number,targetExpenseRows:ExpenseRow[],targetExpenseTotal:number,
  checkCutoffDay:number,checkCutoffDate:string,alert:CashflowAlert,breach:CashflowNotification,
  warningProjection:{targetDate:string,creditRows:ReconciledRow[],expenseRows:ExpenseRow[],incomeRows:RecurringMovement[],checkRows:DatedRetainedRow[],forecastIncomplete:boolean},
};
export type CashflowOptions = {targetDate?:string};
export interface CashflowCalculation {
  finite(value:unknown):number|null;
  num(value:unknown):number;
  accountRole(value:unknown):AccountRole;
  expenseBelongsTo(row:RetainedRow|null|undefined,account:unknown):boolean;
  kupaExpenseBelongsToAccountData(row:RetainedRow|null|undefined,account?:string):boolean;
  pad2(value:unknown):string;
  isoDay(value:unknown):string;
  monthKey(value:unknown):string;
  daysInMonth(year:number,month:number):number;
  bankObservationDay(value:unknown):string;
  addMonthsISO(value:unknown,delta:number):string;
  addDaysISO(value:unknown,delta:number):string;
  monthCutoffISO(key:string,day:number):string;
  monthKeysBetween(start:string,end:string):string[];
  creditCardKey(row:Partial<ReconciledRow>|null|undefined):string;
  creditRowKey(row:Partial<ReconciledRow>|null|undefined):string;
  bankFeedForAccount(kupa:CashflowState,account:unknown):BankFeed|null;
  bankTransactionDay(row:BankRow):string;
  bankTransactionSearchText(row:BankRow):string;
  providerHintsForRows(rows:ReconciledRow[]):string[];
  bankRowLooksLikeCreditSettlement(row:BankRow,providers?:string[]):boolean;
  bankRowExplicitlyMatchesProvider(row:BankRow,provider:string):boolean;
  moneyCents(value:unknown):number;
  cardSuffixForRows(rows:ReconciledRow[]):string;
  bankTextHasCardSuffix(row:BankRow,suffix:string):boolean;
  explicitBankCardSuffixes(row:BankRow):string[];
  synchronizedProviderCardSuffixes(kupa:CashflowState,provider:string,account:unknown,reference?:string):Set<string>;
  bankCardSuffixHint(row:BankRow):{suffix:string,source:string};
  validatedBankCardSuffixIdentity(kupa:CashflowState,row:BankRow,account:unknown):SettlementIdentity|null;
  bankSettlementAccountCandidates(kupa:CashflowState,row:BankRow,account:unknown,preparedBillingRows?:ReconciledRow[]|null):SettlementCandidate[];
  bankCreditSettlementIdentityFromRows(kupa:CashflowState,row:BankRow,account:unknown,preparedBillingRows?:ReconciledRow[]|null):SettlementIdentity;
  kupaBankCreditSettlementIdentityData(kupa:CashflowState,row:BankRow,account?:string):SettlementIdentity;
  kupaBankCreditSettlementIdentitiesData(kupa:CashflowState,rows?:BankRow[],account?:string):Map<BankRow,SettlementIdentity>;
  settlementRowsForLatestElapsedCycle(installments:ReconciledRow[],start:string,reference:string):ReconciledRow[];
  settlementGroupKey(row:Partial<ReconciledRow>|undefined,level:'card'|'profile'|'provider'|'date'):string;
  pendingBankSettlementGroupKeys(kupa:CashflowState,bankRows:BankRow[],billingRows:ReconciledRow[],account:unknown,reference:string):Set<string>;
  unresolvedSettlementIndexes(bankRows:BankRow[],candidates:ReconciledRow[],reference:string,options?:Pick<ReconciliationOptions,'monthlySettlement'>):Set<number>;
  provenSettlementGroupIndexes(groups:SettlementGroup[],banks:BankEvidence[]):number[];
  settlementWarningId(account:unknown,rows:ReconciledRow[]):string;
  expiredSettlementWarnings(account:unknown,rows:ReconciledRow[]):SettlementWarning[];
  pendingCreditSettlementData(kupa:CashflowState,account:unknown,settlementRows:ReconciledRow[],start:string,reference:string):PendingSettlement;
  rollForwardSettledCycleRows(rows:ReconciledRow[],settlement:CurrentSettlement,reference:string,options?:Pick<ReconciliationOptions,'retainSettledCompleted'>):ReconciledRow[];
  reconciledCreditRowsForAccount(kupa:CashflowState,account:string,reference:string,options?:ReconciliationOptions):Reconciliation;
  calculateReconciledCreditRows(kupa:CashflowState,account:string,reference:string,options:Required<ReconciliationOptions>):Reconciliation;
  kupaReconciledCreditRowsData(kupa:CashflowState,account?:string,reference?:string):ReconciledRow[];
  kupaReconciledCreditDetailRowsData(kupa:CashflowState,account?:string,reference?:string):ReconciledRow[];
  creditDetailRowSort(a:ReconciledRow,b:ReconciledRow):number;
  creditAccountDisplayContext(kupa:CashflowState,rows:ReconciledRow[]):DisplayContext;
  creditUnassignedDisplayTarget(row:ReconciledRow,context:DisplayContext,reference:string):{date:string,source:string,confidence:string}|null;
  kupaReconciledCreditDetailMonthsData(kupa:CashflowState,reference?:string,historyMonths?:number):DetailMonths;
  calculateCreditDetailMonths(kupa:CashflowState,reference:string,historyMonths:number):DetailMonths;
  kupaReconciledCreditUpcomingDetailData(kupa:CashflowState,reference?:string,historyMonths?:number):{items:ReconciledRow[],nextByCard:Map<string,string>,reference:string};
  kupaReconciledCardUpcomingChargeData(kupa:CashflowState,creditAccountKey:string,reference?:string):CardUpcoming|null;
  kupaCardDisplayBillingDateFromRowsData(inputRows:ReconciledRow[],creditAccountKey:string,account?:CreditAccount,reference?:string):{date:string,source:string,confidence:string};
  kupaCardUpcomingChargeFromRowsData(inputRows:ReconciledRow[],creditAccountKey:string,reference?:string):CardUpcoming|null;
  kupaCreditScheduleData(cr:RetainedRow):Array<{creditId:unknown,date:string,amount:number,part:number,totalParts:number,card:unknown,account:AccountRole,ownerLabel:string,hidden:false,description:unknown,source:'manual'}>;
  kupaSyncedInstallmentsData(kupa:CashflowState):BillingRow[];
  kupaAllInstallmentsData(kupa:CashflowState):BillingRow[];
  kupaAccountInstallmentsData(kupa:CashflowState,account?:string):BillingRow[];
  kupaExpenseOccurrencesForMonthData(kupa:CashflowState,key:string):DatedRetainedRow[];
  kupaExpenseRowsBetweenData(kupa:CashflowState,start:string,end:string):DatedRetainedRow[];
  kupaNextAccountCreditCycleData(kupa:CashflowState,account?:string,reference?:string):BillingHorizon;
  kupaAccountBankBalanceData(kupa:CashflowState,account?:string):number|null;
  kupaAccountBankAsOfDateData(kupa:CashflowState,account?:string,reference?:string):string;
  kupaAccountCheckDepositsData(kupa:CashflowState,account?:string,reference?:string,targetMonth?:string,horizonDate?:string):CheckDeposits;
  monthlyCashflowBoundary(key:string):string;
  automaticCashflowHorizon(kupa:CashflowState,role:AccountRole,reconciliation:Reconciliation,creditRows:ReconciledRow[]):{targetMonth:string,targetDate:string,awaitingSettlement:boolean};
  cashflowContributionsThroughDate(kupa:CashflowState,role:AccountRole,reconciliation:Reconciliation,remaining:ReconciledRow[],targetDate:string):Contributions;
  kupaAccountCashflowData(kupa:CashflowState,account?:string,reference?:string,options?:CashflowOptions):CashflowResult;
  calculateAccountCashflow(kupa:CashflowState,account:string,reference:string,options:CashflowOptions):CashflowResult;
}
export type CardUpcoming = {
  amount:number,date:string,source:'transactions',pendingAmount:number,estimated:boolean,awaitingSettlement:boolean,status:'incomplete'|'estimated'|'finalized',
  incompleteCount:number,missingAmountCount:number,coverageGapCount:number,stalePendingCount:number,unconvertedCount:number,unknownAmountCount:number,unassignedCount:number,amountKnown:boolean,complete:boolean,
};
