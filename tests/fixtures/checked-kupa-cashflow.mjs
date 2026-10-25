// @ts-check
import {kupaAccountCashflowData,kupaReconciledCreditRowsData,kupaBankCreditSettlementIdentityData,kupaCardUpcomingChargeFromRowsData} from '../../shared/kupa-cashflow.js';
/** @type {import('../../shared/kupa-cashflow-contracts.js').CashflowState} */
const state={bank:{currentBalance:null,homeFeed:{balance:0}},credits:[],expenses:[],checks:[]};
const flow=kupaAccountCashflowData(state,'עסקי','2026-09-15');
if(flow.balance===null){
  /** @type {null} */ const unavailable=flow.projected;void unavailable;
  // @ts-expect-error missing balance never proves a zero projection
  /** @type {number} */ const money=flow.projected;void money;
}else{
  /** @type {number} */ const known=flow.projected;void known;
}
const rows=kupaReconciledCreditRowsData(state,'all','2026-09-15');
// @ts-expect-error raw bank evidence is not an issuer billing row
kupaCardUpcomingChargeFromRowsData([{date:'2026-09-15',amount:-20}],'sync:p:1234');
// @ts-expect-error a numeric revision is not an explicit forecast date
kupaAccountCashflowData(state,'עסקי','2026-09-15',{targetDate:37});
const first=rows[0];if(first){
  // @ts-expect-error invalid inclusion status cannot masquerade as a known ILS amount
  first.amountStatus='converted';
  // @ts-expect-error an inferred display suffix does not imply settled bank authority
  first.bankSettlementState='matched';
  // @ts-expect-error forecast projection does not admit arbitrary charge-date provenance
  first.chargeDateSource='bank_display_suffix';
}
const identity=kupaBankCreditSettlementIdentityData(state,{creditSettlementDetails:{provider:'max'}},'ביתי');
// @ts-expect-error display identity is not the monetary reconciliation
/** @type {typeof flow} */ const forged=identity;void forged;
