import {bankBaseBalanceData, bankHomeBalanceData, bankAdjustmentsData, bankAdjustmentsTotalData, bankAsOfDateData, bankHomeAsOfDateData, sharedChecksObservedSequenceData, bankCurrentBalanceData, bankNextCycleCommitmentsData, bankHomeNextCycleCommitmentsData, bankLongTermPositionData, bankProjectedThisMonthData, bankHomeProjectedThisMonthData} from './model.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsBankSelectors({model, checksSession}){
function bankBaseBalance(...args){return bankBaseBalanceData(model.state,...args)}

function bankHomeBalance(...args){return bankHomeBalanceData(model.state,...args)}

function bankAdjustments(...args){return bankAdjustmentsData(model.state,...args)}

function bankAdjustmentsTotal(...args){return bankAdjustmentsTotalData(model.state,...args)}

function bankAsOfDate(...args){return bankAsOfDateData(model.state,...args)}

function bankHomeAsOfDate(...args){return bankHomeAsOfDateData(model.state,...args)}

function sharedChecksObservedSequence(...args){return sharedChecksObservedSequenceData(checksSession.sharedChecksBankEvents,model.state,...args)}

function bankCurrentBalance(...args){return bankCurrentBalanceData(model.state,...args)}

function bankNextCycleCommitments(...args){return bankNextCycleCommitmentsData(model.state,...args)}

function bankHomeNextCycleCommitments(...args){return bankHomeNextCycleCommitmentsData(model.state,...args)}

function bankLongTermPosition(...args){return bankLongTermPositionData(model.state,...args)}

function bankProjectedThisMonth(...args){return bankProjectedThisMonthData(model.state,...args)}

function bankHomeProjectedThisMonth(...args){return bankHomeProjectedThisMonthData(model.state,...args)}

return { bankBaseBalance, bankHomeBalance, bankAdjustments, bankAdjustmentsTotal, bankAsOfDate, bankHomeAsOfDate, sharedChecksObservedSequence, bankCurrentBalance, bankNextCycleCommitments, bankHomeNextCycleCommitments, bankLongTermPosition, bankProjectedThisMonth, bankHomeProjectedThisMonth };
}
