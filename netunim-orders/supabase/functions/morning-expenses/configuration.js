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
  return {environment, clientId, clientSecret, valid:['production', 'sandbox'].includes(environment) && !!clientId && !!clientSecret,
    sandboxWrites:environment === 'sandbox' && get('MORNING_EXPENSE_SANDBOX_WRITES') === 'true' && completePProfiles(pSuppliers), pSuppliers:pSuppliers || []};
}
