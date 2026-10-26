// Service-role only. Unique operation and invoice identities arbitrate all workers.
export function createExpenseLedger(admin, environment) {
  const table = () => admin.from('morning_expense_operations');
  const lookup = (owner, operation) => table().select('*').eq('owner_id', owner).eq('environment', environment).eq('operation_id', operation).maybeSingle();
  async function checked(query) { const {data, error} = await query; if (error) throw new Error('morning_expense_storage_failed'); return data; }
  return {
    get:(owner, operation) => checked(lookup(owner, operation)),
    async reserve(row) {
      const {data, error} = await table().insert({...row, environment}).select('*').single();
      if (error?.code === '23505') return null;
      if (error) throw new Error('morning_expense_storage_failed');
      return data;
    },
    transition:(owner, operation, from, patch) => checked(table().update({...patch, updated_at:new Date().toISOString()}).eq('owner_id', owner)
      .eq('environment', environment).eq('operation_id', operation).eq('state', from).select('*').maybeSingle()),
    claimFile:(owner, operation) => checked(table().update({file_state:'ticket_issued', file_requested_at:new Date().toISOString(), updated_at:new Date().toISOString()})
      .eq('owner_id', owner).eq('environment', environment).eq('operation_id', operation).eq('state', 'created').eq('file_state', 'not_started').select('*').maybeSingle()),
  };
}
