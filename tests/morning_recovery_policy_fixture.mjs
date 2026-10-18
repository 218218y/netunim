import {declaration,tokens} from './bank_policy_ast_fixture.mjs';
export function originalMorningRecoveryPolicy(source){
  // Check the historical financial policy with the new cheque follow-up absent.
  source=source.replaceAll('morningCheckRegistrationMessage(data)||','').replaceAll('!!(data.bank_link_pending||data.checks_registration_pending)','!!data.bank_link_pending');
  const node=declaration(source,'recoverPendingMorningOperation');
  return tokens(source.slice(node.start,node.end))
    .replaceAll('lifetime.capture()', 'captureScope()')
    .replaceAll('changed(error)', 'scopeChanged(error)')
    .replaceAll('failureMessage(error)', 'error?.message')
    .replace('const context=recovery.read();if(!context||publish.isBusy())', 'const stored=loadMorningDebtRecoveryContext();if(stored)pendingRecovery=stored;const context=pendingRecovery;if(!context||createBusy)')
    .replaceAll('commands.status(context.operationId,true,assertCurrent)', "backend('status',{operation_id:context.operationId,reconcile:true},assertCurrent)")
    .replaceAll('recovery.abandon(', 'abandonRecoveredReservation(')
    .replaceAll('application.apply(', 'applyVerifiedContext(').replaceAll('application.settle(', 'settleVerifiedRecovery(')
    .replaceAll('publish.notify(', 'notifyBankVerified(')
    .replaceAll('publish.state(false,true);', 'blocked=false;completed=true;')
    .replaceAll('publish.state(true,settlement.durable);', 'blocked=true;completed=settlement.durable;')
    .replaceAll('publish.state(true);', 'blocked=true;')
    .replaceAll('recovery.reset(', 'resetOperationAfterTerminal(')
    .replaceAll('lifetime.scheduleRecovery(', 'scheduleRecoveryCheck(').replaceAll('publish.toast(', 'toast(');
}
