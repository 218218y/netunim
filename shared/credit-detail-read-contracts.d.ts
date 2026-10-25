import type {ReconciledRow} from './kupa-cashflow-contracts.js';

// Display projections of already validated retained rows. These carry no write
// authority and never admit raw issuer/RPC data.
export type DetailRow = Partial<ReconciledRow> & {amount:number};
export type DetailMonth<R extends DetailRow> = {key:string,items:R[],total:number};
export type DetailFocus = {monthKey:string,cardKey:string};
export type DetailQuery = {
  creditDetailMode:string,creditDetailChargeDay:string,creditDetailFocus:DetailFocus|null,
  creditAccountFilter:string,creditProviderFilter:string,creditCardFilter:string,
  creditView:string,creditDateFrom:string,creditDateTo:string,
};
export type KupaDetailInput<R extends DetailRow> = {
  prepared:{detail:{months:DetailMonth<R>[]},upcoming:{items:R[]}},
  query:DetailQuery,reference:string,matches:(row:R)=>boolean,
};
export type OrdersDetailInput<R extends DetailRow> = {
  allMonths:DetailMonth<R>[],upcomingRows:R[],query:DetailQuery,
  reference:string,matches:(row:R)=>boolean,
};
export type KupaDetailReport<R extends DetailRow> = {
  mode:string,chargeDay:string,detailMonths:DetailMonth<R>[],futureMonths:DetailMonth<R>[],
  historyMonths:DetailMonth<R>[],detailFocus:DetailFocus|null,detailItems:R[],
  focusedCount:number,detailFocusLabel:string,upcomingTotal:number,
};
export type OrdersDetailReport<R extends DetailRow> = {
  mode:string,chargeDay:string,months:DetailMonth<R>[],futureMonths:DetailMonth<R>[],
  historyMonths:DetailMonth<R>[],focus:DetailFocus|null,selected:DetailMonth<R>|null,
  items:R[],focusedCount:number,upcomingTotal:number,
};
