import {createDomainsBankSelectors} from '../domains/bank/selectors.js';

// Consumers name the account and the read they need, without knowing Bank's
// selector layout. This port reads the authoritative model; it starts no jobs.
export function createKupaBankQueries({model, checksSession}) {
  if (!model || !checksSession) throw new TypeError('bank_queries_context_required');
  const selectors = createDomainsBankSelectors({model, checksSession});
  function home(account) {
    if (account !== 'business' && account !== 'home') throw new TypeError('bank_query_account_required');
    return account === 'home';
  }
  return {
    balance:(account, ...args) => home(account) ? selectors.bankHomeBalance(...args) : selectors.bankCurrentBalance(...args),
    asOfDate:(account, ...args) => home(account) ? selectors.bankHomeAsOfDate(...args) : selectors.bankAsOfDate(...args),
    forecast:(account, ...args) => home(account) ? selectors.bankHomeNextCycleCommitments(...args) : selectors.bankNextCycleCommitments(...args),
    projectedBalance:(account, ...args) => home(account) ? selectors.bankHomeProjectedThisMonth(...args) : selectors.bankProjectedThisMonth(...args),
    longTermPosition:(...args) => selectors.bankLongTermPosition(...args),
    observedCheckSequence:(...args) => selectors.sharedChecksObservedSequence(...args),
  };
}
