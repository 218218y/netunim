import {declaration,tokens} from './bank_policy_ast_fixture.mjs';
export function originalMorningApplicationPolicy(source){
  const node=declaration(source,'applyVerifiedContextOnce');
  return tokens(source.slice(node.start,node.end))
    .replaceAll(',isCurrent=()=>true','').replaceAll('if(isCurrent()===true)','')
    .replaceAll('lifetime.capture()', 'captureScope()')
    .replaceAll('policy.matches(', 'morningDebtRecoveryMatchesVerified(')
    .replaceAll('feedback.toast(', 'toast(').replaceAll('feedback.status(', 'connectionStatus(').replaceAll('feedback.decide(', 'showRecoveryDecision(')
    .replaceAll('debts.refresh()', 'refreshForMorningRecovery?.()')
    .replaceAll('debts.isBlocked()', 'rejectSecondaryMutation?.()===true')
    .replaceAll('recovery.read()', 'loadMorningDebtRecoveryContext()')
    .replaceAll('debts.read(context.debtId)', '(model.state.customerDebts||[]).find(d=>d.id===context.debtId)')
    .replaceAll('policy.snapshot(', 'morningFinancialSnapshot(').replaceAll('policy.changes(', 'morningFinancialChanges(')
    .replaceAll('selected', 'policy')
    .replace('policy={...context,applyPayment:resolution.applyPayment,applyInvoice:resolution.applyInvoice};', 'policy=resolution;')
    .replace('const result=debts.apply(', 'const result=applyVerifiedDebtDocument?.(')
    .replace('applyInvoice:policy.applyInvoice});',"applyInvoice:policy.applyInvoice})||{changed:false,reason:'no-handler'};");
}
