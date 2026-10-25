export type UnknownRecord = Record<string,unknown>;
export type ProgressKind = 'payment'|'invoice';
// Retained application rows; validation below still accepts unknown-valued fields.
export type Debt = UnknownRecord & {debtProgress?:UnknownRecord[]|undefined};
export type ProgressDomain = {recorded:number,applied:number,remainingMagnitude:number,complete:boolean,partial:boolean};
export type DebtProgress = {
  amount:number,targetMagnitude:number,paymentRecorded:number,paymentApplied:number,
  remainingPaymentMagnitude:number,remainingPayment:number,paymentComplete:boolean,paymentPartial:boolean,
  invoiceRecorded:number,invoiceApplied:number,remainingInvoiceMagnitude:number,remainingInvoice:number,
  invoiceComplete:boolean,invoicePartial:boolean,
};
export interface DebtCalculation {
  finiteNumber(value:unknown):number;
  cents(value:unknown):number;
  amountFromCents(value:unknown):number;
  customerDebtProgressEntries(debt?:Debt|null,kind?:ProgressKind|null):UnknownRecord[];
  progressAction(row?:UnknownRecord|null):'reset'|'add';
  customerDebtActiveProgressEntries(debt:Debt|null|undefined,kind:ProgressKind):UnknownRecord[];
  progressNetCents(debt:Debt|null|undefined,kind:ProgressKind):number;
  domainProgress(targetCents:number,directComplete:boolean,recordedCents:number):ProgressDomain;
  customerDebtProgressData(debt?:Debt|null):DebtProgress;
  customerDebtProgressMode(progress:Partial<DebtProgress>|null|undefined,kind:ProgressKind):'true'|'partial'|'false';
  customerDebtHasPartialProgress(debt?:Debt|null):boolean;
}
