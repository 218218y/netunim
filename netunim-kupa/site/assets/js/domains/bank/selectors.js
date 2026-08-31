import {bankBaseBalanceData, bankAdjustmentsData, bankAdjustmentsTotalData, bankAsOfDateData, sharedChecksObservedSequenceData, bankCurrentBalanceData, bankNextCycleCommitmentsData, bankLongTermPositionData, bankProjectedThisMonthData} from './model.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsBankSelectors({model, checksSession}){
function bankBaseBalance(...args){return bankBaseBalanceData(model.state,...args)}

function bankAdjustments(...args){return bankAdjustmentsData(model.state,...args)}

function bankAdjustmentsTotal(...args){return bankAdjustmentsTotalData(model.state,...args)}

function bankAsOfDate(...args){return bankAsOfDateData(model.state,...args)}

function sharedChecksObservedSequence(...args){return sharedChecksObservedSequenceData(checksSession.sharedChecksBankEvents,model.state,...args)}

function bankCurrentBalance(...args){return bankCurrentBalanceData(model.state,...args)}

function bankNextCycleCommitments(...args){return bankNextCycleCommitmentsData(model.state,...args)}

function bankLongTermPosition(...args){return bankLongTermPositionData(model.state,...args)}

function bankProjectedThisMonth(...args){return bankProjectedThisMonthData(model.state,...args)}

return { bankBaseBalance, bankAdjustments, bankAdjustmentsTotal, bankAsOfDate, sharedChecksObservedSequence, bankCurrentBalance, bankNextCycleCommitments, bankLongTermPosition, bankProjectedThisMonth };
}
