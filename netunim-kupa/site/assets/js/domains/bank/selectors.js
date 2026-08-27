import {bankBaseBalanceData, bankAdjustmentsData, bankAdjustmentsTotalData, bankAsOfDateData, pendingSharedCheckBankDeltaData, sharedChecksObservedSequenceData, checkDepositedAfterBankSnapshotData, bankDerivedCheckDepositsData, legacyCheckDepositFallbacksData, bankCheckEffectsTotalData, bankCurrentBalanceData, bankNextCycleCommitmentsData, bankLongTermPositionData, bankProjectedThisMonthData} from './model.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsBankSelectors({model, checksSession}){
function bankBaseBalance(...args){return bankBaseBalanceData(model.state,...args)}

function bankAdjustments(...args){return bankAdjustmentsData(model.state,...args)}

function bankAdjustmentsTotal(...args){return bankAdjustmentsTotalData(model.state,...args)}

function bankAsOfDate(...args){return bankAsOfDateData(model.state,...args)}

function pendingSharedCheckBankDelta(...args){return pendingSharedCheckBankDeltaData(checksSession.sharedChecksBase,model.state,...args)}

function sharedChecksObservedSequence(...args){return sharedChecksObservedSequenceData(checksSession.sharedChecksBankEvents,model.state,...args)}

function checkDepositedAfterBankSnapshot(...args){return checkDepositedAfterBankSnapshotData(model.state,...args)}

function bankDerivedCheckDeposits(...args){return bankDerivedCheckDepositsData(model.state,...args)}

function legacyCheckDepositFallbacks(...args){return legacyCheckDepositFallbacksData(model.state,...args)}

function bankCheckEffectsTotal(...args){return bankCheckEffectsTotalData(checksSession.sharedChecksBankEvents,checksSession.sharedChecksBase,model.state,...args)}

function bankCurrentBalance(...args){return bankCurrentBalanceData(checksSession.sharedChecksBankEvents,checksSession.sharedChecksBase,model.state,...args)}

function bankNextCycleCommitments(...args){return bankNextCycleCommitmentsData(checksSession.sharedChecksBankEvents,checksSession.sharedChecksBase,model.state,...args)}

function bankLongTermPosition(...args){return bankLongTermPositionData(checksSession.sharedChecksBankEvents,checksSession.sharedChecksBase,model.state,...args)}

function bankProjectedThisMonth(...args){return bankProjectedThisMonthData(checksSession.sharedChecksBankEvents,checksSession.sharedChecksBase,model.state,...args)}

return { bankBaseBalance, bankAdjustments, bankAdjustmentsTotal, bankAsOfDate, pendingSharedCheckBankDelta, sharedChecksObservedSequence, checkDepositedAfterBankSnapshot, bankDerivedCheckDeposits, legacyCheckDepositFallbacks, bankCheckEffectsTotal, bankCurrentBalance, bankNextCycleCommitments, bankLongTermPosition, bankProjectedThisMonth };
}
