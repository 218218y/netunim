import {markMutationActions} from '../shared/action-registry.js';

export function createLazyMorningExpenses({auth, morningOperationScope, confirmDialog, isActive, notify}) {
  let feature = null, flight = null, active = true;
  const names = 'toggle load field save status next upload file-status files dragover drop keyboard'.split(' ');
  async function ensure() {
    if (!active || feature) return feature;
    if (!flight) flight = Promise.all([import('../domains/finance/morning-expense-intake.js'), import('../integrations/morning-expenses.js'), import('../platform/morning-expense-files.js')]).then(([ui, integration, fileEffects]) => {
      if (!active) return null;
      const request = integration.createExpenseRequest({supaFetch:(...args) => auth.supaFetch(...args)});
      feature = ui.createMorningExpenseIntake({request, captureRead:() => morningOperationScope.captureRead(), captureWrite:() => morningOperationScope.capture(),
        accountId:() => auth.getAccountScope()?.owner, subscribeAccountScope:listener => auth.subscribeAccountScope?.(listener) || (() => {}), confirmDialog,
        files:{validate:fileEffects.validateExpenseFile, upload:fileEffects.uploadExpenseFile}, isActive:() => active && isActive()});
      return feature;
    }).finally(() => { flight = null; });
    return flight;
  }
  const actions = markMutationActions(Object.fromEntries(names.map(name => [`morning-expense-${name}`, (...args) => {
    if (feature) return active ? feature.actions[`morning-expense-${name}`](...args) : false;
    return ensure().then(loaded => active ? loaded?.actions[`morning-expense-${name}`](...args) : false)
      .catch(() => {if (active) notify('מסך קליטת ההוצאות אינו זמין כרגע.'); return false;});
  }])), {finance:['morning-expense-save', 'morning-expense-upload', 'morning-expense-keyboard']});
  return {actions, markup:() => feature ? feature.markup() : '<section class="morning-expense-intake" data-morning-expense-intake><button type="button" class="morning-expense-trigger" data-action="morning-expense-toggle" aria-expanded="false"><b>קליטת הוצאות ב־Morning</b><span>⌄</span></button></section>',
    runtime:{isPending:() => !!flight || feature?.runtime.isPending() === true,
      drain:async () => {await flight?.catch(() => {}); await feature?.runtime.drain();},
      dispose:() => {if (!active) return false; active = false; feature?.runtime.dispose(); return true;}}};
}
