// Each capability owns its delegated actions and mutation metadata.
// Dependencies are supplied by the composition root; this module has no startup side effects.
// Only actions explicitly classified with startupMutationDomain are mutations.
// Read-only/navigation actions must remain interactive while cloud/DB safety checks run.
export function wrapMutationActions(actions,guardMutation){
  const guarded=Object.create(null);
  for(const [name,action] of Object.entries(actions)){
    const domain=action?.startupMutationDomain;
    if(!domain){guarded[name]=action;continue}
    const wrapped=(element,event)=>{if(guardMutation(domain,name,element,event))return action(element,event)};
    Object.defineProperty(wrapped,'startupMutationDomain',{value:domain});
    guarded[name]=wrapped;
  }
  return Object.freeze(guarded);
}

export {createAlertsActions} from './action-packs/alerts.js';
export {createFinanceBankActions} from './action-packs/finance-bank.js';
export {createFinanceCreditActions} from './action-packs/finance-credit.js';
export {createChecksActions} from './action-packs/checks.js';
export {createShellActions} from './action-packs/shell.js';
export {createDashboardActions} from './action-packs/dashboard.js';
export {createSuppliersActions} from './action-packs/suppliers.js';
export {createCustomersActions} from './action-packs/customers.js';
export {createMorningActions} from './action-packs/morning.js';
export {createServiceActions} from './action-packs/service.js';
export {createWarehouseActions} from './action-packs/warehouse.js';
export {createBackupActions} from './action-packs/backup.js';
export {createCloudActions} from './action-packs/cloud.js';
export {createNotesActions} from './action-packs/notes.js';
export {createCalendarActions} from './action-packs/calendar.js';
export {createExternalActionPacks} from './action-packs/external.js';
