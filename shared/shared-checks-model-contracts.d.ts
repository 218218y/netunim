import type {AccountRole} from './credit-calculation-contracts.js';
export type SharedCheck = Record<string,unknown> & {
  id:string,name:string,account:AccountRole,amount:number,dueDate:string,status:string,
  depositDate:unknown,depositedAt:unknown,depositSeq:number|null,clearedDate:unknown,
  checkNumber:string,note:string,createdAt:unknown,
};
export type BankEvent = {seq:number,at:unknown,delta:number,kind:string,checkId:string};
export type DraftBankEvent = Omit<BankEvent,'seq'> & {seq:number|null};
export interface SharedCheckCalculation {
  checkAmount(value:unknown):number;
  checkAccountData(check:unknown):AccountRole;
  checkBelongsToAccountData(check:unknown,account?:string):boolean;
  checkIsClosedStatus(status:unknown):boolean;
  normalizeSharedBankEvents(events:unknown):BankEvent[];
  normalizeSharedChecks(checks:unknown):SharedCheck[];
}
