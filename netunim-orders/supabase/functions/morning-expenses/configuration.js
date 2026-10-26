import {expenseUuid} from './service.js';
import {completePProfiles} from './p-suppliers.js';

export function expenseConfiguration(get) {
  const ownEnvironment = get('MORNING_EXPENSE_ENV');
  const environment = (ownEnvironment ?? get('MORNING_ENV') ?? 'production').trim().toLowerCase();
  const dedicated = ownEnvironment !== undefined && ownEnvironment !== null || !!(get('MORNING_EXPENSE_CLIENT_ID') || get('MORNING_EXPENSE_CLIENT_SECRET'));
  const clientId = get(dedicated ? 'MORNING_EXPENSE_CLIENT_ID' : 'MORNING_CLIENT_ID') || '';
  const clientSecret = get(dedicated ? 'MORNING_EXPENSE_CLIENT_SECRET' : 'MORNING_CLIENT_SECRET') || '';
  let pSuppliers = null;
  try {
    const raw = get('MORNING_EXPENSE_P_SUPPLIERS');
    const value = raw === undefined || raw === null ? null : JSON.parse(raw);
    if (Array.isArray(value) && value.every(profile => expenseUuid(profile?.id) && typeof profile?.taxId === 'string' && /^\d{9}$/.test(profile.taxId))) {
      pSuppliers = value.map(profile => ({id:profile.id, taxId:profile.taxId}));
    }
  } catch { /* Invalid or missing supplier protection never opens a writer. */ }
  const valid = ['production', 'sandbox'].includes(environment) && !!clientId && !!clientSecret;
  const sandboxWrites = valid && environment === 'sandbox' && get('MORNING_EXPENSE_SANDBOX_WRITES') === 'true' && completePProfiles(pSuppliers);
  const productionUserId = expenseUuid(get('MORNING_EXPENSE_PRODUCTION_USER_ID')) ? get('MORNING_EXPENSE_PRODUCTION_USER_ID') : '';
  // Production opt-in requires an explicit environment and a complete dedicated
  // pair. Reusing either income credential fails closed; never change that pair.
  const independent = ownEnvironment?.trim().toLowerCase() === 'production' && dedicated &&
    clientId !== get('MORNING_CLIENT_ID') && clientSecret !== get('MORNING_CLIENT_SECRET');
  const productionWrites = valid && independent && !!productionUserId && completePProfiles(pSuppliers) && get('MORNING_EXPENSE_PRODUCTION_WRITES') === 'true';
  return {environment, clientId, clientSecret, valid, sandboxWrites, productionWrites, productionUserId,
    writes:sandboxWrites || productionWrites,
    pcnP:(sandboxWrites || productionWrites) && get('MORNING_EXPENSE_PCN_P_WRITES') === 'true',
    uploads:sandboxWrites || productionWrites && get('MORNING_EXPENSE_PRODUCTION_UPLOADS') === 'true', pSuppliers:pSuppliers || []};
}
