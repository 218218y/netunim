import {expenseUuid, expenseSupplier} from './service.js';

export function completePProfiles(profiles) {
  return Array.isArray(profiles) && profiles.length === 2 && profiles.every(profile => expenseUuid(profile?.id) && typeof profile.taxId === 'string' && /^\d{9}$/.test(profile.taxId)) &&
    new Set(profiles.map(profile => profile.id)).size === 2 && new Set(profiles.map(profile => profile.taxId)).size === 2;
}
export async function verifyPProfiles(request, profiles) {
  if (!completePProfiles(profiles)) throw new Error('morning_expense_p_profiles_unverified');
  const records = await Promise.all(profiles.map(async profile => {
    const record = expenseSupplier(await request('/suppliers/' + profile.id, {method:'GET'}));
    if (record.id !== profile.id || record.taxId !== profile.taxId || !record.active) throw new Error('morning_expense_p_profiles_unverified');
    return record;
  }));
  return records;
}
